# Dependency Advisory Register

Last reviewed: 2026-08-26

## Open Findings

`npm audit --omit=dev` reports three high-severity findings through the pinned Next.js 15 dependency tree:

| Dependency | Advisories | Current reachability assessment | Compensating controls | Resolution gate |
|---|---|---|---|---|
| `postcss <=8.5.22` under Next.js | `GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-fxqj-rqcc-2cmp`, `GHSA-r28c-9q8g-f849` | Build-time CSS stringify/source-map paths. Commerce Pilot does not accept tenant CSS, source maps, Tailwind configuration, or build input at runtime. | Reproducible lockfile build in an isolated CI job; no customer-controlled source tree; production container does not expose a build API or compiler. | Re-evaluate on every supported Next.js 15 patch and no later than 2026-09-15. Upgrade only after full Web/Harness regression testing. |
| `sharp <0.35.0` under Next.js | `GHSA-f88m-g3jw-g9cj` and listed libvips CVEs | Next image optimization is disabled. Tenant images are served by the authenticated artifact route and are not passed to Next's sharp optimizer. | `images.unoptimized=true`; file signature/size validation; no public Next image optimizer route for tenant media. | Upgrade with a compatible Next release or an audited dependency override after image, upload and production-build regression tests. Review no later than 2026-09-15. |

## Decision

Do not run `npm audit fix --force`. The currently proposed automatic remediation installs Next.js 16.3.3, a breaking framework change that conflicts with the project's fixed Next.js 15 architecture and requires an explicit migration project.

This register is a time-bounded reachability assessment, not a statement that the vulnerabilities do not matter. Repository maintainers must refresh the audit, verify upstream patched releases, and close or renew each entry with evidence before the review date.
