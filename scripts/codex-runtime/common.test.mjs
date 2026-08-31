import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertTrustedRuntimeArtifact,
  codexVendorRoot,
  currentRustTarget,
  executableFilename,
  normalizeSqlMigrationsForTarget,
  readPatchSeries,
  readUpstreamDefinition,
  renamePathWithRetry,
  runtimeManifestFilename,
  sha256,
  sha256File,
  validateTrustedRuntimeCandidate,
} from "./common.mjs";

const manifest = {
  upstream: { commit: "90854393966b21e9ebfd21b122334eb09a20c93d" },
  patchSet: { revision: "shueho.1" },
  artifact: {
    platform: `${process.platform}-${process.arch}`,
    sha256: "a".repeat(64),
    versionOutput: "codex-cli 0.150.1",
  },
};

test("external runtime installation rejects an unlisted self-asserted digest", async () => {
  const fixture = await createRegistry([]);
  try {
    await assert.rejects(
      assertTrustedRuntimeArtifact(manifest, fixture.path),
      /is not present in vendor\/codex\/trusted-artifacts\.json/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("external runtime installation accepts only the exact reviewed identity", async () => {
  const fixture = await createRegistry([
    {
      platform: manifest.artifact.platform,
      sha256: manifest.artifact.sha256,
      upstreamCommit: manifest.upstream.commit,
      patchRevision: manifest.patchSet.revision,
      versionOutput: manifest.artifact.versionOutput,
    },
  ]);
  try {
    await assert.doesNotReject(assertTrustedRuntimeArtifact(manifest, fixture.path));
    await assert.rejects(
      assertTrustedRuntimeArtifact(
        { ...manifest, patchSet: { revision: "shueho.2" } },
        fixture.path,
      ),
      /is not present/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("an untrusted candidate is rejected before its executable is invoked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-codex-untrusted-execution-"));
  const registry = await createRegistry([]);
  const binaryPath = join(directory, executableFilename());
  const manifestPath = join(directory, runtimeManifestFilename);
  const binary = Buffer.from("untrusted-codex-runtime", "utf8");
  let executionCount = 0;
  try {
    const [upstream, patchSet] = await Promise.all([readUpstreamDefinition(), readPatchSeries()]);
    const runtimeManifest = {
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
        target: currentRustTarget(),
      },
      artifact: {
        platform: `${process.platform}-${process.arch}`,
        file: executableFilename(),
        sha256: sha256(binary),
        size: binary.length,
        versionOutput: `codex-cli ${upstream.version}`,
      },
    };
    await writeFile(join(directory, "LICENSE.codex"), await readFile(join(codexVendorRoot, "LICENSE.upstream")));
    await writeFile(join(directory, "NOTICE.codex"), await readFile(join(codexVendorRoot, "NOTICE.upstream")));
    await writeFile(binaryPath, binary);
    await writeFile(manifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`, "utf8");
    await assert.rejects(
      validateTrustedRuntimeCandidate(binaryPath, manifestPath, {
        registryPath: registry.path,
        readVersion: () => {
          executionCount += 1;
          return `codex-cli ${upstream.version}`;
        },
      }),
      /is not present/,
    );
    assert.equal(executionCount, 0);
  } finally {
    await Promise.all([rm(directory, { recursive: true, force: true }), registry.cleanup()]);
  }
});

test("streaming artifact hashing matches the in-memory SHA-256", async () => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-codex-streaming-hash-"));
  const path = join(directory, "large-artifact.bin");
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 17, 0x5a);
  try {
    await writeFile(path, bytes);
    assert.equal(await sha256File(path), sha256(bytes));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime artifact rotation retries transient Windows file locks only", async () => {
  const attempts = [];
  const delays = [];
  await renamePathWithRetry("source", "destination", {
    attempts: 4,
    baseDelayMs: 10,
    renameOperation: async () => {
      attempts.push(attempts.length + 1);
      if (attempts.length < 3) throw Object.assign(new Error("locked"), { code: "EBUSY" });
    },
    waitOperation: async (delayMs) => {
      delays.push(delayMs);
    },
  });
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(delays, [10, 20]);

  await assert.rejects(
    renamePathWithRetry("source", "destination", {
      renameOperation: async () => {
        throw Object.assign(new Error("invalid path"), { code: "ENOENT" });
      },
      waitOperation: async () => {
        throw new Error("non-retryable failures must not wait");
      },
    }),
    /invalid path/,
  );
});

test("Windows runtime builds reproduce the official CRLF SQL migration checksums", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "commerce-codex-sql-migrations-"));
  const migrations = join(sourceRoot, "codex-rs", "state", "migrations");
  const nested = join(sourceRoot, "codex-rs", "state", "logs_migrations");
  try {
    await Promise.all([mkdir(migrations, { recursive: true }), mkdir(nested, { recursive: true })]);
    const first = join(migrations, "0001_threads.sql");
    const second = join(nested, "0001_logs.sql");
    const ignored = join(migrations, "README.md");
    await Promise.all([
      writeFile(first, "CREATE TABLE threads (id TEXT);\n", "utf8"),
      writeFile(second, "CREATE TABLE logs (id TEXT);\r\n", "utf8"),
      writeFile(ignored, "leave me alone\n", "utf8"),
    ]);

    const normalized = await normalizeSqlMigrationsForTarget(sourceRoot, "x86_64-pc-windows-msvc");
    assert.equal(normalized.length, 2);
    assert.equal(await readFile(first, "utf8"), "CREATE TABLE threads (id TEXT);\r\n");
    assert.equal(await readFile(second, "utf8"), "CREATE TABLE logs (id TEXT);\r\n");
    assert.equal(await readFile(ignored, "utf8"), "leave me alone\n");

    await writeFile(first, "CREATE TABLE threads (id TEXT);\n", "utf8");
    assert.deepEqual(await normalizeSqlMigrationsForTarget(sourceRoot, "x86_64-unknown-linux-gnu"), []);
    assert.equal(await readFile(first, "utf8"), "CREATE TABLE threads (id TEXT);\n");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("Cargo.lock normalization is an ordered, mechanical locked-build patch", async () => {
  const patchSet = await readPatchSeries();
  assert.equal(patchSet.patches[1]?.file, "0002-normalize-cargo-lock-workspace-version.patch");
  const patch = await readFile(patchSet.patches[1].path, "utf8");
  assert.equal((patch.match(/^-version = "0\.0\.0"$/gm) ?? []).length, 142);
  assert.equal((patch.match(/^\+version = "0\.150\.1"$/gm) ?? []).length, 142);
  const unexpectedRemovals = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith("-") && !line.startsWith("--- ") && line !== '-version = "0.0.0"');
  const unexpectedAdditions = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++ ") && line !== '+version = "0.150.1"');
  assert.deepEqual(unexpectedRemovals, []);
  assert.deepEqual(unexpectedAdditions, []);
});

async function createRegistry(artifacts) {
  const directory = await mkdtemp(join(tmpdir(), "commerce-codex-trust-"));
  const path = join(directory, "trusted-artifacts.json");
  await writeFile(path, `${JSON.stringify({ schemaVersion: 1, artifacts }, null, 2)}\n`, "utf8");
  return { path, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
