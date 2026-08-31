import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type ResolveCodexBinOptions = {
  arch?: NodeJS.Architecture;
  nodeEnv?: string;
  platform?: NodeJS.Platform;
  readVersion?: (candidate: string) => string;
};

type CodexUpstreamDefinition = {
  schemaVersion: 1;
  repository: string;
  tag: string;
  commit: string;
  version: string;
  rustToolchain: string;
  licenseSha256: string;
  noticeSha256: string;
  cargoPackage: string;
  cargoBinary: string;
  patchRevision: string;
};

type CodexRuntimeManifest = {
  schemaVersion: 1;
  upstream: {
    repository: string;
    tag: string;
    commit: string;
    version: string;
    rustToolchain: string;
    licenseSha256: string;
    noticeSha256: string;
  };
  patchSet: {
    revision: string;
    seriesSha256: string;
    patches: Array<{ file: string; sha256: string }>;
  };
  build: {
    cargoPackage: string;
    cargoBinary: string;
    profile: "release";
    locked: true;
    target: string;
  };
  artifact: {
    platform: string;
    file: "codex" | "codex.exe";
    sha256: string;
    size: number;
    versionOutput: string;
  };
};

const RUNTIME_MANIFEST_FILENAME = "runtime-manifest.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PATCH_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.patch$/;

export function resolveCodexBin(
  appRoot: string,
  override?: string,
  options: ResolveCodexBinOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const readVersion = options.readVersion ?? readCodexVersion;
  const explicit = override?.trim();

  if (explicit) {
    const candidate = isAbsolute(explicit) ? resolve(explicit) : resolve(appRoot, explicit);
    const manifestPath = join(dirname(candidate), RUNTIME_MANIFEST_FILENAME);
    if (existsSync(manifestPath)) {
      verifyManagedCodexRuntime(appRoot, candidate, { arch, platform, readVersion });
      return candidate;
    }
    if (nodeEnv === "production") {
      throw new Error(
        `Production CODEX_BIN must reference an application-owned runtime with an adjacent ${RUNTIME_MANIFEST_FILENAME}: ${candidate}`,
      );
    }
    const result = checkCandidate(candidate, readVersion);
    if (result.startsWith("ok:")) return candidate;
    throw new Error(`Explicit CODEX_BIN is not runnable: ${result}`);
  }

  const managedCandidate = join(
    appRoot,
    ".runtime",
    "bin",
    `${platform}-${arch}`,
    platform === "win32" ? "codex.exe" : "codex",
  );
  if (existsSync(managedCandidate) || existsSync(join(dirname(managedCandidate), RUNTIME_MANIFEST_FILENAME))) {
    verifyManagedCodexRuntime(appRoot, managedCandidate, { arch, platform, readVersion });
    return managedCandidate;
  }

  if (nodeEnv === "production") {
    throw new Error(
      [
        "Production requires the application-owned, manifest-verified Codex runtime.",
        "Set CODEX_BIN to the image-baked runtime or install the matching artifact under .runtime/bin/<platform>.",
        "Refusing to fall back to the npm or a global Codex executable.",
      ].join(" "),
    );
  }

  const vendorCandidate = resolveCodexVendorBin(appRoot, platform, arch);
  const dependencyCandidates = (
    platform === "win32"
      ? [vendorCandidate]
      : [
          join(appRoot, "node_modules", ".bin", "codex"),
          join(appRoot, "node_modules", "@openai", "codex", "bin", "codex.js"),
          vendorCandidate,
        ]
  ).filter((candidate): candidate is string => Boolean(candidate));

  const checked: string[] = [];
  for (const candidate of dependencyCandidates) {
    const result = checkCandidate(candidate, readVersion);
    checked.push(result);
    if (result.startsWith("ok:")) return candidate;
  }

  const globalCodex = checkCandidate("codex", readVersion);
  checked.push(globalCodex);
  if (globalCodex.startsWith("ok:")) return "codex";

  throw new Error(
    [
      "Unable to resolve a runnable Codex runtime for the web application.",
      "Build/install the application-owned runtime, install @openai/codex for local fallback, or set CODEX_BIN explicitly.",
      "Production never relies on a developer-global or npm fallback.",
      "Checked candidates:",
      ...checked.map((line) => `- ${line}`),
    ].join("\n"),
  );
}

export function verifyManagedCodexRuntime(
  appRoot: string,
  candidate: string,
  options: Pick<ResolveCodexBinOptions, "arch" | "platform" | "readVersion"> = {},
): CodexRuntimeManifest {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const readVersion = options.readVersion ?? readCodexVersion;
  if (!isAbsolute(candidate)) throw new Error("Managed CODEX_BIN must be an absolute path.");
  const binaryStats = existsSync(candidate) ? statSync(candidate) : null;
  if (!binaryStats?.isFile()) {
    throw new Error(`Managed Codex runtime binary is missing: ${candidate}`);
  }
  if (lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`Managed Codex runtime binary must not be a symbolic link: ${candidate}`);
  }

  const manifestPath = join(dirname(candidate), RUNTIME_MANIFEST_FILENAME);
  const upstreamPath = join(appRoot, "vendor", "codex", "upstream.json");
  const patchesDirectory = join(appRoot, "vendor", "codex", "patches");
  const seriesPath = join(patchesDirectory, "series");
  const upstream = readJsonFile(upstreamPath, "Codex upstream definition") as CodexUpstreamDefinition;
  const manifest = readJsonFile(manifestPath, "Codex runtime manifest") as CodexRuntimeManifest;
  validateUpstreamDefinition(upstream);
  validateRuntimeManifest(manifest);

  const seriesRaw = normalizeLineEndings(readFileSync(seriesPath, "utf8"));
  const patches = parseAndVerifyPatchSeries(seriesRaw, patchesDirectory);
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
    throw new Error("Codex runtime upstream identity does not match vendor/codex/upstream.json.");
  }
  if (manifest.patchSet.revision !== upstream.patchRevision) {
    throw new Error(`Codex runtime patch revision mismatch: expected ${upstream.patchRevision}.`);
  }
  if (manifest.patchSet.seriesSha256 !== sha256(seriesRaw)) {
    throw new Error("Codex runtime patch series digest does not match the checked-in series.");
  }
  if (JSON.stringify(manifest.patchSet.patches) !== JSON.stringify(patches)) {
    throw new Error("Codex runtime patch list does not match the checked-in patch series.");
  }
  if (manifest.build.cargoPackage !== upstream.cargoPackage || manifest.build.cargoBinary !== upstream.cargoBinary) {
    throw new Error("Codex runtime Cargo identity does not match vendor/codex/upstream.json.");
  }
  const expectedTarget = managedRustTarget(platform, arch);
  if (manifest.build.target !== expectedTarget) {
    throw new Error(`Codex runtime target mismatch: expected ${expectedTarget}, received ${manifest.build.target}.`);
  }
  const expectedPlatform = `${platform}-${arch}`;
  if (manifest.artifact.platform !== expectedPlatform) {
    throw new Error(`Codex runtime platform mismatch: expected ${expectedPlatform}, received ${manifest.artifact.platform}.`);
  }
  if (manifest.artifact.file !== basename(candidate)) {
    throw new Error("Codex runtime manifest filename does not match CODEX_BIN.");
  }
  if (binaryStats.size !== manifest.artifact.size) throw new Error("Codex runtime binary size does not match its manifest.");
  const binarySha256 = sha256File(candidate);
  if (binarySha256 !== manifest.artifact.sha256) {
    throw new Error(`Codex runtime SHA-256 mismatch: expected ${manifest.artifact.sha256}, received ${binarySha256}.`);
  }
  if (
    sha256File(join(dirname(candidate), "LICENSE.codex")) !== manifest.upstream.licenseSha256 ||
    sha256File(join(dirname(candidate), "NOTICE.codex")) !== manifest.upstream.noticeSha256
  ) {
    throw new Error("Codex runtime LICENSE or NOTICE digest does not match its pinned upstream source.");
  }
  const versionOutput = readVersion(candidate).trim();
  if (versionOutput !== manifest.artifact.versionOutput || versionOutput !== `codex-cli ${upstream.version}`) {
    throw new Error(`Codex runtime version mismatch: received ${versionOutput || "<empty>"}.`);
  }
  return manifest;
}

function resolveCodexVendorBin(appRoot: string, platform: NodeJS.Platform, arch: NodeJS.Architecture): string | undefined {
  const target = getCodexPlatformTarget(platform, arch);
  if (!target) return undefined;
  return join(
    appRoot,
    "node_modules",
    "@openai",
    target.packageDirectory,
    "vendor",
    target.triple,
    "bin",
    platform === "win32" ? "codex.exe" : "codex",
  );
}

function getCodexPlatformTarget(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): { packageDirectory: string; triple: string } | undefined {
  if (platform === "darwin" && arch === "arm64") return { packageDirectory: "codex-darwin-arm64", triple: "aarch64-apple-darwin" };
  if (platform === "darwin" && arch === "x64") return { packageDirectory: "codex-darwin-x64", triple: "x86_64-apple-darwin" };
  if (platform === "linux" && arch === "arm64") return { packageDirectory: "codex-linux-arm64", triple: "aarch64-unknown-linux-musl" };
  if (platform === "linux" && arch === "x64") return { packageDirectory: "codex-linux-x64", triple: "x86_64-unknown-linux-musl" };
  if (platform === "win32" && arch === "arm64") return { packageDirectory: "codex-win32-arm64", triple: "aarch64-pc-windows-msvc" };
  if (platform === "win32" && arch === "x64") return { packageDirectory: "codex-win32-x64", triple: "x86_64-pc-windows-msvc" };
  return undefined;
}

function managedRustTarget(platform: NodeJS.Platform, arch: NodeJS.Architecture): string {
  const key = `${platform}-${arch}`;
  const targets: Record<string, string> = {
    "win32-x64": "x86_64-pc-windows-msvc",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
  };
  const target = targets[key];
  if (!target) throw new Error(`Unsupported managed Codex runtime platform: ${key}.`);
  return target;
}

function checkCandidate(candidate: string, readVersion: (candidate: string) => string): string {
  if (candidate !== "codex" && !existsSync(candidate)) return `missing: ${candidate}`;
  try {
    const version = readVersion(candidate);
    return `ok: ${candidate}: ${version}`;
  } catch (error) {
    return `failed: ${candidate}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function readCodexVersion(candidate: string): string {
  const result = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  if (result.status === 0) return result.stdout.trim();
  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  const reason = stderr || stdout || result.error?.message || `exit status ${result.status ?? "unknown"}`;
  throw new Error(reason);
}

function readJsonFile(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateUpstreamDefinition(value: CodexUpstreamDefinition): void {
  assertRecord(value, "Codex upstream definition");
  assertExactKeys(
    value,
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
    "Codex upstream definition",
  );
  if (value.schemaVersion !== 1 || !COMMIT_PATTERN.test(value.commit)) throw new Error("Invalid Codex upstream definition identity.");
  if (!SHA256_PATTERN.test(value.licenseSha256) || !SHA256_PATTERN.test(value.noticeSha256)) {
    throw new Error("Invalid Codex upstream license metadata.");
  }
  for (const field of ["repository", "tag", "version", "rustToolchain", "cargoPackage", "cargoBinary", "patchRevision"] as const) {
    if (typeof value[field] !== "string" || value[field].length === 0) throw new Error(`Invalid Codex upstream field: ${field}.`);
  }
}

function validateRuntimeManifest(value: CodexRuntimeManifest): void {
  assertRecord(value, "Codex runtime manifest");
  assertExactKeys(value, ["schemaVersion", "upstream", "patchSet", "build", "artifact"], "Codex runtime manifest");
  if (value.schemaVersion !== 1) throw new Error("Unsupported Codex runtime manifest schemaVersion.");
  for (const field of ["upstream", "patchSet", "build", "artifact"] as const) assertRecord(value[field], `manifest.${field}`);
  assertExactKeys(
    value.upstream,
    ["repository", "tag", "commit", "version", "rustToolchain", "licenseSha256", "noticeSha256"],
    "manifest.upstream",
  );
  assertExactKeys(value.patchSet, ["revision", "seriesSha256", "patches"], "manifest.patchSet");
  assertExactKeys(value.build, ["cargoPackage", "cargoBinary", "profile", "locked", "target"], "manifest.build");
  assertExactKeys(value.artifact, ["platform", "file", "sha256", "size", "versionOutput"], "manifest.artifact");
  if (!COMMIT_PATTERN.test(value.upstream.commit) || !SHA256_PATTERN.test(value.patchSet.seriesSha256)) {
    throw new Error("Invalid Codex runtime manifest source identity.");
  }
  if (!SHA256_PATTERN.test(value.upstream.licenseSha256) || !SHA256_PATTERN.test(value.upstream.noticeSha256)) {
    throw new Error("Invalid Codex runtime manifest license metadata.");
  }
  if (!Array.isArray(value.patchSet.patches)) throw new Error("manifest.patchSet.patches must be an array.");
  for (const patch of value.patchSet.patches) {
    assertRecord(patch, "manifest patch");
    assertExactKeys(patch, ["file", "sha256"], "manifest patch");
    if (!PATCH_FILENAME_PATTERN.test(patch.file) || !SHA256_PATTERN.test(patch.sha256)) throw new Error("Invalid manifest patch entry.");
  }
  if (value.build.profile !== "release" || value.build.locked !== true || typeof value.build.target !== "string") {
    throw new Error("Codex runtime must be a locked release build.");
  }
  if (!/^(win32|linux|darwin)-(x64|arm64)$/.test(value.artifact.platform)) throw new Error("Invalid Codex artifact platform.");
  if (!SHA256_PATTERN.test(value.artifact.sha256) || !Number.isSafeInteger(value.artifact.size) || value.artifact.size <= 0) {
    throw new Error("Invalid Codex artifact integrity fields.");
  }
  for (const field of ["repository", "tag", "version", "rustToolchain"] as const) {
    if (typeof value.upstream[field] !== "string" || value.upstream[field].length === 0) throw new Error(`Invalid manifest upstream field: ${field}.`);
  }
  if (typeof value.patchSet.revision !== "string" || value.patchSet.revision.length === 0) {
    throw new Error("Invalid manifest patch revision.");
  }
  for (const field of ["cargoPackage", "cargoBinary", "target"] as const) {
    if (typeof value.build[field] !== "string" || value.build[field].length === 0) throw new Error(`Invalid manifest build field: ${field}.`);
  }
  if (typeof value.artifact.versionOutput !== "string" || value.artifact.versionOutput.length === 0) {
    throw new Error("Invalid manifest artifact version output.");
  }
}

function parseAndVerifyPatchSeries(series: string, patchesDirectory: string): Array<{ file: string; sha256: string }> {
  const patches: Array<{ file: string; sha256: string }> = [];
  const seen = new Set<string>();
  for (const [index, originalLine] of series.split("\n").entries()) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._-]*\.patch)$/);
    if (!match) throw new Error(`Invalid Codex patch series line ${index + 1}.`);
    const [, expectedSha256, file] = match;
    if (seen.has(file)) throw new Error(`Duplicate Codex patch series entry: ${file}.`);
    seen.add(file);
    const patchPath = join(patchesDirectory, file);
    if (!existsSync(patchPath)) throw new Error(`Listed Codex patch is missing: ${file}.`);
    const actualSha256 = sha256(readFileSync(patchPath));
    if (actualSha256 !== expectedSha256) throw new Error(`Codex patch SHA-256 mismatch: ${file}.`);
    patches.push({ file, sha256: actualSha256 });
  }
  const unlisted = readdirSync(patchesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".patch") && !seen.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (unlisted.length > 0) throw new Error(`Unlisted Codex patch files: ${unlisted.join(", ")}.`);
  return patches;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(path, "r");
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function assertExactKeys(value: object, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} has unexpected fields: ${actual.join(", ")}.`);
}
