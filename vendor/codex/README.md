# Application-owned Codex runtime

Commerce Pilot runs OpenAI's open-source Codex Harness. When a reviewed upstream fix is needed before it is available in the pinned npm release, this directory describes a reproducible, application-owned runtime build without vendoring the upstream repository or committing binaries.

## Pinned inputs

- `upstream.json` fixes the upstream repository, tag, commit, Rust toolchain, Cargo package, patch-set revision, and exact upstream LICENSE/NOTICE digests.
- `patches/series` fixes patch order and the SHA-256 of every patch. Blank lines and lines beginning with `#` are ignored.
- `runtime-manifest.schema.json` defines the manifest emitted beside every built binary.
- `trusted-artifacts.json` is the reviewed allowlist for artifacts built elsewhere. `install.mjs` refuses a self-asserted manifest until its platform, upstream commit, patch revision, version and binary SHA-256 are registered here.

A `series` entry has this exact shape:

```text
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  0001-example.patch
```

Patch paths are basenames only. The build fails before `git apply` when a patch is missing, unlisted, duplicated, or has a different digest. Do not edit an existing published patch; add a new patch and increment `patchRevision`.

The pinned upstream release records workspace packages as `0.0.0` in `Cargo.lock` even though its workspace version is `0.150.1`. The reviewed `0002` patch performs Cargo's exact 142-line lock normalization. The build keeps `--locked`, rejects any remaining `0.0.0` package version, and runs `cargo metadata --locked` before compiling tests or the release binary.

## Local artifact layout

```text
.runtime/bin/<platform>/codex[.exe]
.runtime/bin/<platform>/runtime-manifest.json
.runtime/bin/<platform>/LICENSE.codex
.runtime/bin/<platform>/NOTICE.codex
.runtime/bin/<platform>/source/upstream.json
.runtime/bin/<platform>/source/patches/series
.runtime/bin/<platform>/source/patches/*.patch
```

`<platform>` is `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64`, or `darwin-arm64`. `.runtime` is ignored and must never be committed.

Build from the exact upstream commit with the locally installed Rust toolchain:

```bash
npm run codex:runtime:build
```

The repository build command is intentionally native-only because it executes the produced binary and its focused patched-runtime tests before writing a manifest. Cross-platform artifacts must be built and tested on a runner for that target, then registered by exact digest before installation.

For Windows targets, the build normalizes every `codex-rs/state/**/*.sql` migration to CRLF before compilation. Official Windows Codex artifacts embed those CRLF bytes, and SQLx persists their SHA-384 checksums in runtime databases. This deterministic target-specific step preserves compatibility with state created by the official `@openai/codex` Windows binary; it never rewrites an existing database checksum. Linux and macOS retain the upstream LF bytes.

Verify the installed artifact:

```bash
npm run codex:runtime:verify
```

Install a separately built artifact after extracting it to a temporary directory:

```bash
npm run codex:runtime:install -- --source-dir=/absolute/path/to/extracted/runtime
```

The source directory must contain the binary and `runtime-manifest.json`. Installation verifies the upstream identity, patch series, binary hash, platform and `codex --version` before copying anything into `.runtime/bin`.

An artifact built on another machine must first be reviewed and added to `trusted-artifacts.json`. The build command prints the candidate SHA-256, but it never edits the trust registry automatically; trust changes remain normal code review.

## Production boundary

Production sets `CODEX_BIN` to a root-owned binary baked into the image. The adjacent manifest and the checked-in inputs are verified before the Gateway starts. A missing or altered managed runtime fails closed and never falls back to the npm or a developer-global Codex executable.

The upstream Codex license and the applied patch sources must accompany every distributed binary or container image.
