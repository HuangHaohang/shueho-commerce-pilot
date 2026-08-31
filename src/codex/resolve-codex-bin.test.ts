import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { resolveCodexBin } from "./resolve-codex-bin.js";

const FIXTURE_LICENSE = Buffer.from("fixture upstream license\n", "utf8");
const FIXTURE_NOTICE = Buffer.from("fixture upstream notice\n", "utf8");
const UPSTREAM = {
  schemaVersion: 1,
  repository: "https://github.com/openai/codex.git",
  tag: "rust-v0.150.1",
  commit: "90854393966b21e9ebfd21b122334eb09a20c93d",
  version: "0.150.1",
  rustToolchain: "1.95.0",
  licenseSha256: digest(FIXTURE_LICENSE),
  noticeSha256: digest(FIXTURE_NOTICE),
  cargoPackage: "codex-cli",
  cargoBinary: "codex",
  patchRevision: "shueho.1",
};

test("production accepts an exact manifest-verified CODEX_BIN", async () => {
  const fixture = await createManagedRuntimeFixture();
  try {
    assert.equal(
      resolveCodexBin(fixture.root, fixture.binary, {
        nodeEnv: "production",
        readVersion: () => "codex-cli 0.150.1",
      }),
      fixture.binary,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("managed runtime verification rejects a tampered binary", async () => {
  const fixture = await createManagedRuntimeFixture();
  try {
    await writeFile(fixture.binary, "tampered-runtime", "utf8");
    assert.throws(
      () =>
        resolveCodexBin(fixture.root, fixture.binary, {
          nodeEnv: "production",
          readVersion: () => "codex-cli 0.150.1",
        }),
      /size does not match|SHA-256 mismatch/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("managed runtime verification rejects a tampered patch input", async () => {
  const fixture = await createManagedRuntimeFixture();
  try {
    await writeFile(fixture.patch, "tampered-patch", "utf8");
    assert.throws(
      () =>
        resolveCodexBin(fixture.root, fixture.binary, {
          nodeEnv: "production",
          readVersion: () => "codex-cli 0.150.1",
        }),
      /patch SHA-256 mismatch/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("managed runtime verification binds the claimed Rust target to the host platform", async () => {
  const fixture = await createManagedRuntimeFixture();
  try {
    const manifest = JSON.parse(await readFile(fixture.manifest, "utf8"));
    manifest.build.target = "aarch64-unknown-linux-musl";
    await writeFile(fixture.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    assert.throws(
      () =>
        resolveCodexBin(fixture.root, fixture.binary, {
          nodeEnv: "production",
          readVersion: () => "codex-cli 0.150.1",
        }),
      /target mismatch/,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("production never falls back to an npm Codex runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-codex-no-fallback-"));
  try {
    const npmCandidate = join(root, "node_modules", ".bin", process.platform === "win32" ? "codex.cmd" : "codex");
    await mkdir(dirname(npmCandidate), { recursive: true });
    await writeFile(npmCandidate, "not-a-managed-runtime", "utf8");
    assert.throws(
      () =>
        resolveCodexBin(root, undefined, {
          nodeEnv: "production",
          readVersion: () => "codex-cli 0.150.1",
        }),
      /Refusing to fall back/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production rejects an explicit unmanaged CODEX_BIN", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-codex-unmanaged-"));
  const binary = join(root, process.platform === "win32" ? "codex.exe" : "codex");
  try {
    await writeFile(binary, "unmanaged-runtime", "utf8");
    assert.throws(
      () =>
        resolveCodexBin(root, binary, {
          nodeEnv: "production",
          readVersion: () => "codex-cli 0.150.1",
        }),
      /adjacent runtime-manifest\.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows development resolves the native npm binary instead of non-executable wrappers", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-codex-windows-native-"));
  const native = join(
    root,
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "bin",
    "codex.exe",
  );
  try {
    await mkdir(dirname(native), { recursive: true });
    await writeFile(native, "native-codex", "utf8");
    assert.equal(
      resolveCodexBin(root, undefined, {
        arch: "x64",
        nodeEnv: "development",
        platform: "win32",
        readVersion: (candidate) => {
          assert.equal(candidate, native);
          return "codex-cli 0.150.1";
        },
      }),
      native,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createManagedRuntimeFixture() {
  const root = await mkdtemp(join(tmpdir(), "commerce-codex-managed-"));
  const patchesDirectory = join(root, "vendor", "codex", "patches");
  const runtimeDirectory = join(root, "managed-runtime");
  const binary = join(runtimeDirectory, process.platform === "win32" ? "codex.exe" : "codex");
  const patch = join(patchesDirectory, "0001-fixture.patch");
  const patchBytes = Buffer.from("fixture-patch\n", "utf8");
  const patchSha256 = digest(patchBytes);
  const series = `${patchSha256}  0001-fixture.patch\n`;
  const binaryBytes = Buffer.from("fixture-codex-runtime", "utf8");
  await mkdir(patchesDirectory, { recursive: true });
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(join(root, "vendor", "codex", "upstream.json"), `${JSON.stringify(UPSTREAM, null, 2)}\n`, "utf8");
  await writeFile(patch, patchBytes);
  await writeFile(join(patchesDirectory, "series"), series, "utf8");
  await writeFile(binary, binaryBytes);
  if (process.platform !== "win32") await chmod(binary, 0o755);
  const manifest = {
    schemaVersion: 1,
    upstream: {
      repository: UPSTREAM.repository,
      tag: UPSTREAM.tag,
      commit: UPSTREAM.commit,
      version: UPSTREAM.version,
      rustToolchain: UPSTREAM.rustToolchain,
      licenseSha256: UPSTREAM.licenseSha256,
      noticeSha256: UPSTREAM.noticeSha256,
    },
    patchSet: {
      revision: UPSTREAM.patchRevision,
      seriesSha256: digest(series),
      patches: [{ file: "0001-fixture.patch", sha256: patchSha256 }],
    },
    build: {
      cargoPackage: UPSTREAM.cargoPackage,
      cargoBinary: UPSTREAM.cargoBinary,
      profile: "release",
      locked: true,
      target: fixtureTarget(),
    },
    artifact: {
      platform: `${process.platform}-${process.arch}`,
      file: process.platform === "win32" ? "codex.exe" : "codex",
      sha256: digest(binaryBytes),
      size: binaryBytes.length,
      versionOutput: "codex-cli 0.150.1",
    },
  };
  await writeFile(join(runtimeDirectory, "LICENSE.codex"), FIXTURE_LICENSE);
  await writeFile(join(runtimeDirectory, "NOTICE.codex"), FIXTURE_NOTICE);
  const manifestPath = join(runtimeDirectory, "runtime-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { binary, manifest: manifestPath, patch, root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureTarget(): string {
  const targets: Record<string, string> = {
    "win32-x64": "x86_64-pc-windows-msvc",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
  };
  const target = targets[`${process.platform}-${process.arch}`];
  if (!target) throw new Error("Unsupported test platform.");
  return target;
}
