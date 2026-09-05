# Public MCP image reachability review — 2026-09-05

Review expires **2026-09-19**. Owner: Commerce Pilot deployment operator. This record applies only to the public MCP deployment in [the server244 runbook](public-mcp-server244.md), with Node base digest `83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5` and the package versions in the retained Trivy report. It does not cover a Gateway/App Server deployment, interactive shell access, additional HTTP routes, new tools or changed container permissions. Any such change requires a new reachability review.

## Removed findings

The application dependency lock updates `fast-uri` to 3.1.7 and `qs` to 6.16.0. Production `npm audit --omit=dev` reports zero advisories after that update. The application tests and real MCP readback pass with those versions.

Trivy also identified vulnerable `brace-expansion`, `ip-address`, `pacote`, `picomatch`, `sigstore` and `tar` copies under `/usr/local/lib/node_modules/npm/`. Runtime services invoke Node directly; the Dockerfile removes the bundled npm, npx, Yarn and Corepack tools. Package managers remain only in the trusted, non-listening build/operator-job target. The runtime scan must confirm those paths are absent; do not suppress their findings with this exception.

## Time-limited system-package exceptions

The Debian 12.15 base currently reports the following HIGH advisories without a fixed package version in the scanner data. They remain recorded in the scan; no global ignore file is used.

| Component / findings | Trigger and current exposure assessment |
|---|---|
| util-linux family: CVE-2026-53613, CVE-2026-76642, CVE-2026-78408, CVE-2026-78409, CVE-2026-78410 | Mount, mount-helper, namespace or cgroup operations. Application services run as UID 1000, drop every capability, use `no-new-privileges` and a read-only root, and have no host device/cgroup/Docker-socket mounts. The MCP registry has no process, shell, mount or namespace tool. |
| gzip: CVE-2026-41992 | External gzip LZH decompression. The business API does not execute gzip or accept LZH archives. HTTP compression uses the Node runtime, not this command-line binary. |
| libacl1: CVE-2026-54369 | Privileged ACL/filesystem operations. Business MCP requests cannot select local paths or execute ACL tools; runtime capabilities and writable volumes are restricted. |
| libudev1: CVE-2026-16742 | `systemd-homed` home-record processing. The application container runs Node directly and has no systemd-homed service, host home directory or device mount. |
| ncurses-bin: CVE-2025-69720 | Terminal utility processing. This deployment has no terminal/PTY product surface or handler that invokes ncurses tools. |
| perl-base: CVE-2026-13221, CVE-2026-42496, CVE-2026-8376, CVE-2026-42497, CVE-2026-48962, CVE-2026-57432, CVE-2026-57433, CVE-2026-9538 | Perl regular-expression, archive, serialization or IO processing. The business request path does not invoke Perl or its modules; the deployment is also 64-bit. This is a reachability assessment, not a claim that the installed source package is patched. |

The public ingress accepts only `/mcp` and bounded `/health`; internal BFF routes return `404` at the public boundary. MCP authenticates before parsing tool requests and exposes only its seven business tools. Unknown calls do not provide generic OS execution. The internal model proxies allow only health, embedding and reranking; model weights are local, hash-verified and not selected by request input. These restrictions are necessary compensating controls, not a substitute for the next base-image refresh.

## Source-package attribution

Trivy attributes CRITICAL CVE-2023-45853 to `zlib1g` 1:1.2.13.dfsg-1. Debian's [security tracker](https://security-tracker.debian.org/tracker/CVE-2023-45853) identifies the vulnerable MiniZip code and explains that the relevant Bookworm zlib source does not build that component into affected binary packages. This attribution is tracked separately from genuinely unpatched reachable runtime code; it is not used to excuse a MiniZip dependency if one is later added.

## Acceptance evidence and renewal

Retain the exact image revision/digest, scanner version/database timestamp, full image scan and package inventory in the protected deployment receipt. Confirm runtime UID/capabilities/read-only mounts, absence of migration/vendor credentials from public MCP, authenticated external SDK readback, `401` without a token, `404` for private callbacks, and no paid provider execution during smoke tests. Re-review or replace this base before the expiry date; newly reachable findings block rollout immediately. Do not describe this image as having zero scanner findings.
