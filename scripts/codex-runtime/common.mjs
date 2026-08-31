import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const codexVendorRoot = join(repositoryRoot, "vendor", "codex");
export const upstreamPath = join(codexVendorRoot, "upstream.json");
export const patchDirectory = join(codexVendorRoot, "patches");
export const patchSeriesPath = join(patchDirectory, "series");
export const trustedArtifactsPath = join(codexVendorRoot, "trusted-artifacts.json");
export const runtimeManifestFilename = "runtime-manifest.json";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PATCH_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.patch$/;
const PLATFORM_PATTERN = /^(win32|linux|darwin)-(x64|arm64)$/;

export function parseArguments(values) {
  const args = new Map();
  for (const value of values) {
    if (!value.startsWith("--")) throw new Error(`Unexpected positional argument: ${value}`);
    const separator = value.indexOf("=");
    if (separator === -1) {
      args.set(value.slice(2), true);
    } else {
      args.set(value.slice(2, separator), value.slice(separator + 1));
    }
  }
  return args;
}

export function stringArgument(args, name) {
  const value = args.get(name);
  if (value === undefined) return undefined;
  if (value === true || value.trim().length === 0) throw new Error(`--${name} requires a value.`);
  return value.trim();
}

export async function readUpstreamDefinition() {
  const parsed = JSON.parse(await readFile(upstreamPath, "utf8"));
  assertRecord(parsed, "upstream.json");
  assertExactKeys(
    parsed,
    [
      "schemaVersion",
      "repository",
      "tag",
      "commit",
      "version",
      "rustToolchain",
      "licenseSha256",
      "noticeSha256",
      "cargoPackage",
      "cargoBinary",
      "patchRevision",
    ],
    "upstream.json",
  );
  if (parsed.schemaVersion !== 1) throw new Error("Unsupported upstream.json schemaVersion.");
  for (const key of ["repository", "tag", "version", "rustToolchain", "cargoPackage", "cargoBinary", "patchRevision"]) {
    if (typeof parsed[key] !== "string" || parsed[key].trim().length === 0) {
      throw new Error(`upstream.json.${key} must be a non-empty string.`);
    }
  }
  if (!COMMIT_PATTERN.test(parsed.commit)) throw new Error("upstream.json.commit must be a lowercase 40-character Git SHA.");
  if (!SHA256_PATTERN.test(parsed.licenseSha256) || !SHA256_PATTERN.test(parsed.noticeSha256)) {
    throw new Error("upstream.json must contain lowercase SHA-256 values for LICENSE and NOTICE.");
  }
  const repository = new URL(parsed.repository);
  if (repository.protocol !== "https:") throw new Error("upstream.json.repository must use HTTPS.");
  return parsed;
}

export async function readPatchSeries() {
  const raw = normalizeLineEndings(await readFile(patchSeriesPath, "utf8"));
  const patches = [];
  const seen = new Set();
  for (const [index, originalLine] of raw.split(/\r?\n/).entries()) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._-]*\.patch)$/);
    if (!match) {
      throw new Error(`Invalid patches/series line ${index + 1}; expected <sha256><two spaces><basename.patch>.`);
    }
    const [, expectedSha256, file] = match;
    if (seen.has(file)) throw new Error(`Duplicate patch in patches/series: ${file}`);
    seen.add(file);
    const path = join(patchDirectory, file);
    if (!existsSync(path)) throw new Error(`Listed Codex patch does not exist: ${file}`);
    const actualSha256 = await sha256File(path);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`Codex patch digest mismatch for ${file}: expected ${expectedSha256}, received ${actualSha256}.`);
    }
    patches.push({ file, path, sha256: actualSha256 });
  }

  const unlisted = (await readdir(patchDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".patch") && !seen.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (unlisted.length > 0) throw new Error(`Unlisted Codex patch files: ${unlisted.join(", ")}.`);

  return {
    patches,
    seriesSha256: sha256(raw),
  };
}

export function currentPlatformKey(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  if (!PLATFORM_PATTERN.test(key)) throw new Error(`Unsupported Codex runtime platform: ${key}`);
  return key;
}

export function currentRustTarget(platform = process.platform, arch = process.arch) {
  const key = currentPlatformKey(platform, arch);
  const targets = {
    "win32-x64": "x86_64-pc-windows-msvc",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
  };
  return targets[key];
}

export function executableFilename(platform = process.platform) {
  return platform === "win32" ? "codex.exe" : "codex";
}

export function defaultRuntimeDirectory(platformKey = currentPlatformKey()) {
  return join(repositoryRoot, ".runtime", "bin", platformKey);
}

export async function createRuntimeManifest({ binaryPath, platformKey, target }) {
  const [upstream, patchSet, binaryStats] = await Promise.all([
    readUpstreamDefinition(),
    readPatchSeries(),
    stat(binaryPath),
  ]);
  if (!binaryStats.isFile() || binaryStats.size <= 0) throw new Error(`Codex runtime binary is empty: ${binaryPath}`);
  const versionOutput = readCodexVersion(binaryPath);
  const expectedVersionOutput = `codex-cli ${upstream.version}`;
  if (versionOutput !== expectedVersionOutput) {
    throw new Error(`Unexpected Codex runtime version: expected ${expectedVersionOutput}, received ${versionOutput}.`);
  }
  return {
    schemaVersion: 1,
    upstream: {
      repository: upstream.repository,
      tag: upstream.tag,
      commit: upstream.commit,
      version: upstream.version,
      rustToolchain: upstream.rustToolchain,
      licenseSha256: upstream.licenseSha256,
      noticeSha256: upstream.noticeSha256,
    },
    patchSet: {
      revision: upstream.patchRevision,
      seriesSha256: patchSet.seriesSha256,
      patches: patchSet.patches.map(({ file, sha256: patchSha256 }) => ({ file, sha256: patchSha256 })),
    },
    build: {
      cargoPackage: upstream.cargoPackage,
      cargoBinary: upstream.cargoBinary,
      profile: "release",
      locked: true,
      target,
    },
    artifact: {
      platform: platformKey,
      file: basename(binaryPath),
      sha256: await sha256File(binaryPath),
      size: binaryStats.size,
      versionOutput,
    },
  };
}

export async function validateRuntimeArtifact(
  binaryPath,
  manifestPath = join(dirname(binaryPath), runtimeManifestFilename),
  options = {},
) {
  const [upstream, patchSet, parsed, binaryStats] = await Promise.all([
    readUpstreamDefinition(),
    readPatchSeries(),
    readJson(manifestPath, "Codex runtime manifest"),
    stat(binaryPath),
  ]);
  validateManifestShape(parsed);
  const manifest = parsed;
  const expectedUpstream = {
    repository: upstream.repository,
    tag: upstream.tag,
    commit: upstream.commit,
    version: upstream.version,
    rustToolchain: upstream.rustToolchain,
    licenseSha256: upstream.licenseSha256,
    noticeSha256: upstream.noticeSha256,
  };
  if (JSON.stringify(manifest.upstream) !== JSON.stringify(expectedUpstream)) {
    throw new Error("Codex runtime manifest upstream identity does not match vendor/codex/upstream.json.");
  }
  if (manifest.patchSet.revision !== upstream.patchRevision) {
    throw new Error(`Codex runtime patch revision mismatch: expected ${upstream.patchRevision}.`);
  }
  if (manifest.patchSet.seriesSha256 !== patchSet.seriesSha256) {
    throw new Error("Codex runtime patch series digest does not match the checked-in series.");
  }
  const expectedPatches = patchSet.patches.map(({ file, sha256: patchSha256 }) => ({ file, sha256: patchSha256 }));
  if (JSON.stringify(manifest.patchSet.patches) !== JSON.stringify(expectedPatches)) {
    throw new Error("Codex runtime manifest patch list does not match the checked-in patch series.");
  }
  if (manifest.build.cargoPackage !== upstream.cargoPackage || manifest.build.cargoBinary !== upstream.cargoBinary) {
    throw new Error("Codex runtime Cargo identity does not match vendor/codex/upstream.json.");
  }
  const expectedTarget = currentRustTarget();
  if (manifest.build.target !== expectedTarget) {
    throw new Error(`Codex runtime target mismatch: expected ${expectedTarget}, received ${manifest.build.target}.`);
  }
  const expectedPlatform = currentPlatformKey();
  if (manifest.artifact.platform !== expectedPlatform) {
    throw new Error(`Codex runtime platform mismatch: expected ${expectedPlatform}, received ${manifest.artifact.platform}.`);
  }
  if (manifest.artifact.file !== basename(binaryPath)) {
    throw new Error("Codex runtime manifest filename does not match the selected binary.");
  }
  if (!binaryStats.isFile() || binaryStats.size !== manifest.artifact.size) {
    throw new Error("Codex runtime binary size does not match its manifest.");
  }
  const actualSha256 = await sha256File(binaryPath);
  if (actualSha256 !== manifest.artifact.sha256) {
    throw new Error(`Codex runtime SHA-256 mismatch: expected ${manifest.artifact.sha256}, received ${actualSha256}.`);
  }
  if (manifest.artifact.versionOutput !== `codex-cli ${upstream.version}`) {
    throw new Error(`Codex runtime manifest version mismatch: received ${manifest.artifact.versionOutput}.`);
  }
  const licenseSha256 = await sha256File(join(dirname(binaryPath), "LICENSE.codex"));
  const noticeSha256 = await sha256File(join(dirname(binaryPath), "NOTICE.codex"));
  if (licenseSha256 !== manifest.upstream.licenseSha256 || noticeSha256 !== manifest.upstream.noticeSha256) {
    throw new Error("Codex runtime LICENSE or NOTICE digest does not match its pinned upstream source.");
  }
  if (options.verifyExecutable !== false) {
    verifyRuntimeExecutable(binaryPath, manifest, options.readVersion);
  }
  return manifest;
}

export function verifyRuntimeExecutable(binaryPath, manifest, readVersion = readCodexVersion) {
  const versionOutput = readVersion(binaryPath);
  if (versionOutput !== manifest.artifact.versionOutput) {
    throw new Error(`Codex runtime executable version mismatch: received ${versionOutput}.`);
  }
}

export async function assertTrustedRuntimeArtifact(manifest, registryPath = trustedArtifactsPath) {
  const parsed = await readJson(registryPath, "Codex trusted artifact registry");
  assertRecord(parsed, "trusted-artifacts.json");
  assertExactKeys(parsed, ["schemaVersion", "artifacts"], "trusted-artifacts.json");
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.artifacts)) {
    throw new Error("Unsupported trusted-artifacts.json contract.");
  }
  const seen = new Set();
  for (const entry of parsed.artifacts) {
    assertRecord(entry, "trusted Codex artifact");
    assertExactKeys(
      entry,
      ["platform", "sha256", "upstreamCommit", "patchRevision", "versionOutput"],
      "trusted Codex artifact",
    );
    if (
      !PLATFORM_PATTERN.test(entry.platform) ||
      !SHA256_PATTERN.test(entry.sha256) ||
      !COMMIT_PATTERN.test(entry.upstreamCommit) ||
      typeof entry.patchRevision !== "string" ||
      entry.patchRevision.length === 0 ||
      typeof entry.versionOutput !== "string" ||
      entry.versionOutput.length === 0
    ) {
      throw new Error("Invalid trusted Codex artifact entry.");
    }
    const identity = `${entry.platform}:${entry.sha256}`;
    if (seen.has(identity)) throw new Error(`Duplicate trusted Codex artifact: ${identity}.`);
    seen.add(identity);
  }
  const trusted = parsed.artifacts.some(
    (entry) =>
      entry.platform === manifest.artifact.platform &&
      entry.sha256 === manifest.artifact.sha256 &&
      entry.upstreamCommit === manifest.upstream.commit &&
      entry.patchRevision === manifest.patchSet.revision &&
      entry.versionOutput === manifest.artifact.versionOutput,
  );
  if (!trusted) {
    throw new Error(
      `Codex runtime artifact ${manifest.artifact.platform}:${manifest.artifact.sha256} is not present in vendor/codex/trusted-artifacts.json.`,
    );
  }
}

export async function validateTrustedRuntimeCandidate(
  binaryPath,
  manifestPath = join(dirname(binaryPath), runtimeManifestFilename),
  options = {},
) {
  const manifest = await validateRuntimeArtifact(binaryPath, manifestPath, { verifyExecutable: false });
  await assertTrustedRuntimeArtifact(manifest, options.registryPath ?? trustedArtifactsPath);
  verifyRuntimeExecutable(binaryPath, manifest, options.readVersion);
  return manifest;
}

export async function writeRuntimeArtifact({
  sourceBinaryPath,
  outputDirectory,
  platformKey,
  target,
  sourceLicensePath,
  sourceNoticePath,
}) {
  if (!sourceLicensePath || !existsSync(sourceLicensePath)) {
    throw new Error("The upstream Codex LICENSE must accompany the built runtime.");
  }
  if (!sourceNoticePath || !existsSync(sourceNoticePath)) {
    throw new Error("The upstream Codex NOTICE must accompany the built runtime.");
  }
  const upstream = await readUpstreamDefinition();
  if ((await sha256File(sourceLicensePath)) !== upstream.licenseSha256) {
    throw new Error("The upstream Codex LICENSE digest does not match vendor/codex/upstream.json.");
  }
  if ((await sha256File(sourceNoticePath)) !== upstream.noticeSha256) {
    throw new Error("The upstream Codex NOTICE digest does not match vendor/codex/upstream.json.");
  }
  await mkdir(outputDirectory, { recursive: true });
  const binaryPath = join(outputDirectory, executableFilename(platformKey.split("-")[0]));
  const manifestPath = join(outputDirectory, runtimeManifestFilename);
  const temporaryDirectory = join(outputDirectory, `.package-${process.pid}`);
  const temporaryBinaryPath = join(temporaryDirectory, basename(binaryPath));
  const temporaryManifestPath = join(temporaryDirectory, runtimeManifestFilename);
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: true });
  await copyFile(sourceBinaryPath, temporaryBinaryPath);
  if (process.platform !== "win32") await chmod(temporaryBinaryPath, 0o755);
  await copyFile(sourceLicensePath, join(temporaryDirectory, "LICENSE.codex"));
  await copyFile(sourceNoticePath, join(temporaryDirectory, "NOTICE.codex"));
  const manifest = await createRuntimeManifest({ binaryPath: temporaryBinaryPath, platformKey, target });
  await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await validateRuntimeArtifact(temporaryBinaryPath, temporaryManifestPath);
  await rm(binaryPath, { force: true });
  await rm(manifestPath, { force: true });
  await renamePathWithRetry(temporaryBinaryPath, binaryPath);
  await renamePathWithRetry(temporaryManifestPath, manifestPath);
  await rm(temporaryDirectory, { recursive: true, force: true });
  await copyFile(sourceLicensePath, join(outputDirectory, "LICENSE.codex"));
  await copyFile(sourceNoticePath, join(outputDirectory, "NOTICE.codex"));
  await writeRuntimeSourceBundle(outputDirectory);
  await validateRuntimeArtifact(binaryPath, manifestPath);
  return { binaryPath, manifestPath, manifest };
}

export async function renamePathWithRetry(
  source,
  destination,
  {
    attempts = 20,
    baseDelayMs = 100,
    renameOperation = rename,
    waitOperation = (delayMs) => new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)),
  } = {},
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await renameOperation(source, destination);
      return;
    } catch (error) {
      const retryable =
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["EBUSY", "EACCES", "EPERM"].includes(error.code);
      if (!retryable || attempt === attempts) throw error;
      await waitOperation(baseDelayMs * attempt);
    }
  }
}

export async function normalizeSqlMigrationsForTarget(sourceRoot, target) {
  if (!target.includes("windows")) return [];
  const stateRoot = join(sourceRoot, "codex-rs", "state");
  const migrationFiles = (await listFilesRecursively(stateRoot))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  if (migrationFiles.length === 0) {
    throw new Error(`No Codex state SQL migrations were found under ${stateRoot}.`);
  }
  for (const path of migrationFiles) {
    const source = await readFile(path, "utf8");
    const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
    if (normalized !== source) await writeFile(path, normalized, "utf8");
  }
  return migrationFiles;
}

async function listFilesRecursively(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

export async function writeRuntimeSourceBundle(outputDirectory) {
  const sourceBundleDirectory = join(outputDirectory, "source");
  await rm(sourceBundleDirectory, { recursive: true, force: true });
  await mkdir(join(sourceBundleDirectory, "patches"), { recursive: true });
  for (const filename of [
    "upstream.json",
    "runtime-manifest.schema.json",
    "README.md",
    "LICENSE.upstream",
    "NOTICE.upstream",
  ]) {
    await copyFile(join(codexVendorRoot, filename), join(sourceBundleDirectory, filename));
  }
  await copyFile(patchSeriesPath, join(sourceBundleDirectory, "patches", "series"));
  const patchSet = await readPatchSeries();
  for (const patch of patchSet.patches) {
    await copyFile(patch.path, join(sourceBundleDirectory, "patches", patch.file));
  }
}

export function readCodexVersion(binaryPath) {
  const result = spawnSync(binaryPath, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const reason = result.stderr?.trim() || result.stdout?.trim() || result.error?.message || `exit status ${result.status ?? "unknown"}`;
    throw new Error(`Codex runtime is not executable: ${binaryPath}: ${reason}`);
  }
  return result.stdout.trim();
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.capture ? "utf8" : undefined,
    maxBuffer: options.capture ? 64 * 1024 * 1024 : undefined,
    stdio: options.capture ? "pipe" : "inherit",
    timeout: options.timeout,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = options.capture
      ? result.stderr?.trim() || result.stdout?.trim() || result.error?.message
      : result.error?.message;
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ` with status ${result.status ?? "unknown"}`}.`);
  }
  return options.capture ? result.stdout.trim() : "";
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveInputPath(value) {
  return isAbsolute(value) ? resolve(value) : resolve(repositoryRoot, value);
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateManifestShape(value) {
  assertRecord(value, "runtime manifest");
  assertExactKeys(value, ["schemaVersion", "upstream", "patchSet", "build", "artifact"], "runtime manifest");
  if (value.schemaVersion !== 1) throw new Error("Unsupported Codex runtime manifest schemaVersion.");
  for (const key of ["upstream", "patchSet", "build", "artifact"]) assertRecord(value[key], `runtime manifest.${key}`);
  assertExactKeys(
    value.upstream,
    ["repository", "tag", "commit", "version", "rustToolchain", "licenseSha256", "noticeSha256"],
    "runtime manifest.upstream",
  );
  assertExactKeys(value.patchSet, ["revision", "seriesSha256", "patches"], "runtime manifest.patchSet");
  assertExactKeys(value.build, ["cargoPackage", "cargoBinary", "profile", "locked", "target"], "runtime manifest.build");
  assertExactKeys(value.artifact, ["platform", "file", "sha256", "size", "versionOutput"], "runtime manifest.artifact");
  if (!COMMIT_PATTERN.test(value.upstream.commit)) throw new Error("Invalid runtime manifest upstream commit.");
  if (!SHA256_PATTERN.test(value.upstream.licenseSha256) || !SHA256_PATTERN.test(value.upstream.noticeSha256)) {
    throw new Error("Invalid runtime manifest license metadata.");
  }
  if (!SHA256_PATTERN.test(value.patchSet.seriesSha256)) throw new Error("Invalid runtime manifest series digest.");
  if (!Array.isArray(value.patchSet.patches)) throw new Error("runtime manifest.patchSet.patches must be an array.");
  for (const patch of value.patchSet.patches) {
    assertRecord(patch, "runtime manifest patch");
    assertExactKeys(patch, ["file", "sha256"], "runtime manifest patch");
    if (!PATCH_FILENAME_PATTERN.test(patch.file) || !SHA256_PATTERN.test(patch.sha256)) {
      throw new Error("Invalid runtime manifest patch entry.");
    }
  }
  if (value.build.profile !== "release" || value.build.locked !== true) {
    throw new Error("Codex runtime manifest must describe a locked release build.");
  }
  if (!PLATFORM_PATTERN.test(value.artifact.platform)) throw new Error("Invalid runtime manifest artifact platform.");
  if (value.artifact.file !== "codex" && value.artifact.file !== "codex.exe") {
    throw new Error("Invalid runtime manifest artifact filename.");
  }
  if (!SHA256_PATTERN.test(value.artifact.sha256) || !Number.isSafeInteger(value.artifact.size) || value.artifact.size <= 0) {
    throw new Error("Invalid runtime manifest artifact integrity fields.");
  }
  for (const key of ["repository", "tag", "version", "rustToolchain"]) {
    if (typeof value.upstream[key] !== "string" || value.upstream[key].length === 0) {
      throw new Error(`Invalid runtime manifest upstream field: ${key}.`);
    }
  }
  if (typeof value.patchSet.revision !== "string" || value.patchSet.revision.length === 0) {
    throw new Error("Invalid runtime manifest patch revision.");
  }
  for (const key of ["cargoPackage", "cargoBinary", "target"]) {
    if (typeof value.build[key] !== "string" || value.build[key].length === 0) {
      throw new Error(`Invalid runtime manifest build field: ${key}.`);
    }
  }
  if (typeof value.artifact.versionOutput !== "string" || value.artifact.versionOutput.length === 0) {
    throw new Error("Invalid runtime manifest version output.");
  }
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, "\n");
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has unexpected fields: ${actual.join(", ")}.`);
  }
}
