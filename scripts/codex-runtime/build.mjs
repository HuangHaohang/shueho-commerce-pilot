import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  currentPlatformKey,
  currentRustTarget,
  executableFilename,
  normalizeSqlMigrationsForTarget,
  parseArguments,
  patchSeriesPath,
  readPatchSeries,
  readUpstreamDefinition,
  repositoryRoot,
  resolveInputPath,
  run,
  stringArgument,
  writeRuntimeArtifact,
} from "./common.mjs";

const args = parseArguments(process.argv.slice(2));
const platformKey = currentPlatformKey();
const target = currentRustTarget();
const requestedPlatform = stringArgument(args, "platform");
const requestedTarget = stringArgument(args, "target");
if (requestedPlatform && requestedPlatform !== platformKey) {
  throw new Error(`codex:runtime:build is native-only; requested ${requestedPlatform} from ${platformKey}.`);
}
if (requestedTarget && requestedTarget !== target) {
  throw new Error(`codex:runtime:build is native-only; requested ${requestedTarget} from ${target}.`);
}
const outputDirectory = stringArgument(args, "output-dir")
  ? resolveInputPath(stringArgument(args, "output-dir"))
  : join(repositoryRoot, ".runtime", "bin", platformKey);

const upstream = await readUpstreamDefinition();
const patchSet = await readPatchSeries();
const rustVersion = run("rustc", ["--version"], { capture: true, timeout: 10_000 });
if (!rustVersion.startsWith(`rustc ${upstream.rustToolchain} `)) {
  throw new Error(`Codex runtime requires rustc ${upstream.rustToolchain}; received ${rustVersion}.`);
}

const requestedBuildRoot = stringArgument(args, "build-root");
const buildRoot = requestedBuildRoot ? resolveInputPath(requestedBuildRoot) : join(repositoryRoot, ".runtime", "build");
await mkdir(buildRoot, { recursive: true });
const sourceRoot = await mkdtemp(join(buildRoot, "codex-"));
let succeeded = false;
try {
  run("git", ["init", "--quiet"], { cwd: sourceRoot });
  run("git", ["config", "core.autocrlf", "false"], { cwd: sourceRoot });
  run("git", ["config", "core.eol", "lf"], { cwd: sourceRoot });
  run("git", ["remote", "add", "origin", upstream.repository], { cwd: sourceRoot });
  run("git", ["fetch", "--quiet", "--depth=1", "origin", `refs/tags/${upstream.tag}:refs/tags/${upstream.tag}`], {
    cwd: sourceRoot,
  });
  const tagCommit = run("git", ["rev-list", "-n", "1", upstream.tag], { cwd: sourceRoot, capture: true });
  if (tagCommit !== upstream.commit) {
    throw new Error(`Codex tag ${upstream.tag} resolved to ${tagCommit}, expected ${upstream.commit}.`);
  }
  run("git", ["checkout", "--quiet", "--detach", upstream.commit], { cwd: sourceRoot });
  const checkedOutCommit = run("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, capture: true });
  if (checkedOutCommit !== upstream.commit) throw new Error(`Codex checkout mismatch: ${checkedOutCommit}.`);

  for (const patch of patchSet.patches) {
    run("git", ["apply", "--check", patch.path], { cwd: sourceRoot });
    run("git", ["apply", patch.path], { cwd: sourceRoot });
  }
  run("git", ["diff", "--check"], { cwd: sourceRoot });
  const normalizedSqlMigrations = await normalizeSqlMigrationsForTarget(sourceRoot, target);

  const cargoDirectory = join(sourceRoot, "codex-rs");
  const cargoLock = await readFile(join(cargoDirectory, "Cargo.lock"), "utf8");
  const staleWorkspaceVersions = cargoLock.match(/^version = "0\.0\.0"$/gm)?.length ?? 0;
  if (staleWorkspaceVersions !== 0) {
    throw new Error(
      `Patched Codex Cargo.lock still contains ${staleWorkspaceVersions} stale workspace package versions; refusing a non-reproducible build.`,
    );
  }
  const cargoEnvironment = {
    ...process.env,
    CARGO_INCREMENTAL: "0",
    ...(process.platform === "win32" ? { LIBSQLITE3_FLAGS: "SQLITE_DISABLE_INTRINSIC" } : {}),
  };
  run("cargo", ["metadata", "--locked", "--format-version", "1", "--no-deps"], {
    capture: true,
    cwd: cargoDirectory,
    env: cargoEnvironment,
  });
  for (const [packageName, testName] of [
    ["codex-core", "hosted_image_generation_is_projected_without_dispatching_a_tool"],
    ["codex-core", "generated_image_is_replayed_for_image_capable_models"],
    ["codex-app-server-protocol", "rebuilds_hosted_image_generation_from_raw_response_item"],
    ["codex-app-server-protocol", "raw_hosted_image_does_not_replace_an_existing_materialized_item"],
  ]) {
    const listedTests = run("cargo", ["test", "--locked", "-p", packageName, testName, "--", "--list"], {
      capture: true,
      cwd: cargoDirectory,
      env: cargoEnvironment,
    });
    if (!listedTests.split(/\r?\n/).some((line) => line.includes(testName))) {
      throw new Error(`Required patched Codex test was not discovered: ${packageName} ${testName}.`);
    }
    run("cargo", ["test", "--locked", "-p", packageName, testName], {
      cwd: cargoDirectory,
      env: cargoEnvironment,
    });
  }

  const cargoArguments = ["build", "--locked", "--release", "-p", upstream.cargoPackage, "--bin", upstream.cargoBinary];
  const explicitTarget = requestedTarget;
  if (explicitTarget) cargoArguments.push("--target", explicitTarget);
  run("cargo", cargoArguments, {
    cwd: cargoDirectory,
    env: cargoEnvironment,
  });

  const cargoTargetDirectory = explicitTarget
    ? join(sourceRoot, "codex-rs", "target", explicitTarget, "release")
    : join(sourceRoot, "codex-rs", "target", "release");
  const result = await writeRuntimeArtifact({
    sourceBinaryPath: join(cargoTargetDirectory, executableFilename()),
    sourceLicensePath: join(sourceRoot, "LICENSE"),
    sourceNoticePath: join(sourceRoot, "NOTICE"),
    outputDirectory,
    platformKey,
    target,
  });
  succeeded = true;
  console.log(
    JSON.stringify(
      {
        binary: result.binaryPath,
        manifest: result.manifestPath,
        upstreamCommit: upstream.commit,
        patchSeries: patchSeriesPath,
        patchCount: patchSet.patches.length,
        windowsSqlMigrationFilesNormalized: normalizedSqlMigrations.length,
        sha256: result.manifest.artifact.sha256,
        trustedArtifactCandidate: {
          platform: result.manifest.artifact.platform,
          sha256: result.manifest.artifact.sha256,
          upstreamCommit: result.manifest.upstream.commit,
          patchRevision: result.manifest.patchSet.revision,
          versionOutput: result.manifest.artifact.versionOutput,
        },
      },
      null,
      2,
    ),
  );
} finally {
  if (!args.has("keep-source")) {
    await rm(sourceRoot, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 10 : 2, retryDelay: 100 });
  } else if (!succeeded) {
    console.error(`Codex source retained for diagnosis: ${sourceRoot}`);
  }
}
