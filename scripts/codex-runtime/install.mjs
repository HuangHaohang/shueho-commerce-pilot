import { chmod, copyFile, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  codexVendorRoot,
  currentPlatformKey,
  defaultRuntimeDirectory,
  executableFilename,
  parseArguments,
  renamePathWithRetry,
  resolveInputPath,
  runtimeManifestFilename,
  stringArgument,
  validateRuntimeArtifact,
  validateTrustedRuntimeCandidate,
  writeRuntimeSourceBundle,
} from "./common.mjs";

const args = parseArguments(process.argv.slice(2));
const sourceDirectoryValue = stringArgument(args, "source-dir");
if (!sourceDirectoryValue) throw new Error("codex:runtime:install requires --source-dir=/absolute/or/repository-relative/path.");

const sourceDirectory = resolveInputPath(sourceDirectoryValue);
const sourceBinary = join(sourceDirectory, executableFilename());
const sourceManifest = join(sourceDirectory, runtimeManifestFilename);
for (const [label, path] of [
  ["binary", sourceBinary],
  ["manifest", sourceManifest],
]) {
  let sourceStats;
  try {
    sourceStats = await stat(path);
  } catch {
    throw new Error(`Codex runtime ${label} is missing from the source artifact: ${path}`);
  }
  if (!sourceStats.isFile()) {
    throw new Error(`Codex runtime ${label} has the wrong filesystem type: ${path}`);
  }
}

const expectedPlatform = currentPlatformKey();
const targetDirectory = stringArgument(args, "output-dir")
  ? resolveInputPath(stringArgument(args, "output-dir"))
  : defaultRuntimeDirectory(expectedPlatform);
const targetParent = dirname(targetDirectory);
const targetName = basename(targetDirectory);
const stagingDirectory = join(targetParent, `.${targetName}.staging-${process.pid}`);
const backupDirectory = join(targetParent, `.${targetName}.backup`);
await mkdir(targetParent, { recursive: true });
if (existsSync(backupDirectory) && !existsSync(targetDirectory)) {
  await renamePathWithRetry(backupDirectory, targetDirectory);
}
if (existsSync(backupDirectory)) {
  throw new Error(`A previous Codex runtime backup still exists and requires operator review: ${backupDirectory}`);
}
await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });

const stagingBinary = join(stagingDirectory, executableFilename());
const stagingManifest = join(stagingDirectory, runtimeManifestFilename);
try {
  await copyFile(sourceBinary, stagingBinary);
  if (process.platform !== "win32") await chmod(stagingBinary, 0o755);
  await copyFile(sourceManifest, stagingManifest);
  await copyFile(join(codexVendorRoot, "LICENSE.upstream"), join(stagingDirectory, "LICENSE.codex"));
  await copyFile(join(codexVendorRoot, "NOTICE.upstream"), join(stagingDirectory, "NOTICE.codex"));
  await writeRuntimeSourceBundle(stagingDirectory);

  const candidate = await validateTrustedRuntimeCandidate(stagingBinary, stagingManifest);
  if (candidate.artifact.platform !== expectedPlatform) {
    throw new Error(`Cannot install ${candidate.artifact.platform} Codex runtime on ${expectedPlatform}.`);
  }

  const hadPreviousRuntime = existsSync(targetDirectory);
  if (hadPreviousRuntime) await renamePathWithRetry(targetDirectory, backupDirectory);
  try {
    await renamePathWithRetry(stagingDirectory, targetDirectory);
    const installed = await validateRuntimeArtifact(
      join(targetDirectory, executableFilename()),
      join(targetDirectory, runtimeManifestFilename),
    );
    if (hadPreviousRuntime) await rm(backupDirectory, { recursive: true, force: true });
    console.log(
      JSON.stringify(
        {
          installed: join(targetDirectory, executableFilename()),
          manifest: join(targetDirectory, runtimeManifestFilename),
          patchRevision: installed.patchSet.revision,
          sha256: installed.artifact.sha256,
          replacedPreviousRuntime: hadPreviousRuntime,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await rm(targetDirectory, { recursive: true, force: true });
    if (hadPreviousRuntime && existsSync(backupDirectory)) {
      await renamePathWithRetry(backupDirectory, targetDirectory);
    }
    throw error;
  }
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
