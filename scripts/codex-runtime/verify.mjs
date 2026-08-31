import { dirname, join } from "node:path";

import {
  currentPlatformKey,
  defaultRuntimeDirectory,
  executableFilename,
  parseArguments,
  resolveInputPath,
  runtimeManifestFilename,
  stringArgument,
  validateRuntimeArtifact,
} from "./common.mjs";

const args = parseArguments(process.argv.slice(2));
const defaultDirectory = defaultRuntimeDirectory(currentPlatformKey());
const binaryPath = resolveInputPath(stringArgument(args, "bin") ?? process.env.CODEX_BIN ?? join(defaultDirectory, executableFilename()));
const manifestPath = resolveInputPath(stringArgument(args, "manifest") ?? join(dirname(binaryPath), runtimeManifestFilename));
const manifest = await validateRuntimeArtifact(binaryPath, manifestPath);

console.log(
  JSON.stringify(
    {
      ok: true,
      binary: binaryPath,
      manifest: manifestPath,
      upstreamCommit: manifest.upstream.commit,
      patchRevision: manifest.patchSet.revision,
      sha256: manifest.artifact.sha256,
      version: manifest.artifact.versionOutput,
    },
    null,
    2,
  ),
);
