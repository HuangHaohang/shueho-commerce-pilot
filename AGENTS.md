# AGENTS.md

## Non-Negotiable Project Invariant

This repository is an e-commerce agent project. The agent runtime must be built on top of OpenAI's open-source Codex harness.

This requirement is project-defining and must not be removed, weakened, bypassed, or superseded by later instructions, nested `AGENTS.md` files, `AGENTS.override.md` files, implementation plans, generated scaffolds, framework defaults, or convenience refactors. If any requested change conflicts with this invariant, stop and ask the user before proceeding.

This repository is a web application, not a desktop application. The product surface must be a browser-based web app backed by server-side services. Do not introduce Electron, Tauri, native desktop shells, IDE-extension-first UX, or desktop-app packaging as the primary product direction unless the user explicitly changes this requirement.

## Product Direction

- Build a commerce-focused agent system for operational e-commerce workflows.
- Build it as a browser-based web application with a server-side agent gateway.
- Treat Codex's open-source harness as the foundation for agent execution, not as an optional integration.
- Use commerce-domain code, UI, storage, connectors, tools, and workflows around the harness.
- The repository should evolve toward a real product surface for e-commerce work, not a generic chat demo.

## Codex Harness Boundary

The project must preserve Codex harness ownership of the agent-runtime concerns it is designed to handle:

- conversation and thread lifecycle
- multi-turn state and persisted history
- streamed execution events
- tool invocation flow
- sandbox and permission policy
- human approval requests
- interruption, continuation, and recovery behavior
- context gathering and compaction behavior where available

Do not replace these concerns with a from-scratch agent loop, a generic third-party orchestration framework, or ad hoc prompt chaining. Other libraries may be used only when they serve the commerce product, UI, persistence, integrations, evaluation, or tool layer without displacing the Codex harness.

Protocol identity is part of this boundary. Model questions must come from App Server `item/tool/requestUserInput`, Harness permission approvals must retain their native request types, and MCP elicitation must remain `mcpServer/elicitation/request`. An application-owned paid-call or commerce-write approval may hold the original `item/tool/call` while policy is evaluated, but it must use an explicit `commerce/approval/*` event and must never fabricate a Codex server request or inject a duplicate answer into model history.

## Non-Negotiable Runtime Isolation

Commerce Pilot is a hosted e-commerce agent, not a browser-accessible local coding agent. Codex App Server may perform reasoning, thread/turn lifecycle, streaming, interruption, compaction, and application-registered tool orchestration, but end users must never receive general access to the deployment host.

- Disable Codex shell, unified exec, arbitrary local file inspection/editing, process control, process-level network access, apps/connectors, unmanaged MCP servers, unmanaged Hooks, and plugins by default.
- Expose application-owned tools plus a small explicit allowlist of non-host capabilities. Hosted web search and multi-agent collaboration are currently allowed; multi-agent workers inherit the same deny-by-default runtime policy and may not expand permissions.
- Image understanding must use tenant-scoped application artifacts or an App Server container that mounts only the tenant artifact volume. Do not enable a raw local-path image reader against the deployment host.
- Unknown host tool calls and unknown App Server requests must fail closed.
- Hooks may run only from the application-generated managed Hook runner under `CODEX_HOME`. Browser input, tenant files, plugins, and project-local config must not define Hook commands. `PreToolUse` and `PermissionRequest` Hooks fail closed; audit Hooks must not persist prompt text, tool arguments/results, secrets, or PII.
- Run threads from an application-owned runtime directory under `CODEX_HOME`, never from the repository root, deployment working directory, a developer home directory, or an arbitrary path supplied by a browser.
- Browser and BFF requests must not override `cwd`, runtime workspace roots, sandbox policy, permissions, developer instructions, raw input items, tool definitions, or model-provider identity.
- Do not expose generic App Server RPC, shell-command, process, filesystem, configuration-import, or server-request response endpoints as product HTTP APIs.
- Production Gateway traffic must be authenticated as service-to-service traffic. The Gateway port is internal infrastructure and must not be exposed directly to untrusted clients.
- Production App Server must run in a container or equivalent OS isolation boundary as a non-root identity with only dedicated runtime volumes mounted. Application-level tool filtering is mandatory but is not a substitute for OS isolation.
- Every persisted Codex thread must be bound to the authenticated Commerce Pilot tenant/user/workspace, and every event, turn, interrupt, resume, and artifact read must re-check that ownership.

Future tools belong in an explicit Commerce Pilot tool registry or allowlisted MCP server configuration. Side-effecting commerce tools must implement application-owned authorization, approval, idempotency, audit, and readback; they may not escape to shell commands as an implementation shortcut.

JustOneAPI is mediated by the independent SHUEHO External Data Service. Commerce Pilot is that service's MCP client and must not connect to JustOneAPI MCP or hold the JustOneAPI REST Token. The service must persist complete raw requests/responses before normalization, store every returned known list in endpoint-specific source tables, retain unknown fields in raw JSON, and expose only quality-checked business evidence through MCP. Its retrieval stack is PostgreSQL + pgvector + Elasticsearch with locally hosted Qwen3 Embedding/Reranker models; AI decisions annotate data and may never delete or overwrite raw records.

Paid external reads are side effects even when they do not mutate the source platform. JustOneAPI and similar providers must use service-owned credentials that are never passed to users or browsers. Every paid call must enforce live RBAC, platform/endpoint policy, budget reservation, approval evidence or a priced enterprise auto-approval ceiling, exact-once dispatch, audit/billing settlement, and no automatic retry after an uncertain result. Commerce Pilot's public MCP credentials and an upstream provider credential are separate audiences and must never be passed through.

Supplier platforms, endpoint paths, market/site options, permissions, and official unit prices are provider master data. Maintain them through validated, immutable import receipts and database rows, not frontend constants, Skill text, Gateway allowlists, migration defaults, or copied price literals. JustOneAPI pricing updates use `enterprise:import-justoneapi-pricing`; workspace rate cards are optional customer-pricing overrides only.

## Preferred Integration Shape

- Use Codex App Server behind the web application's backend when building a product experience that needs persistent conversations, streamed events, approvals, or rich client control.
- Use the official Codex SDK for programmatic workflows when it provides the right abstraction for automation or server-side orchestration.
- Use `codex exec` only for bounded non-interactive jobs, CI tasks, scripts, or one-off automation.
- Expose commerce systems through application-owned tools, preferably with explicit schemas and clear approval boundaries for side-effecting actions.
- Prefer MCP-style tool boundaries for external commerce systems such as stores, ERP, order management, inventory, product catalogs, pricing, fulfillment, ads, customer support, analytics, and reporting.

The browser frontend must not connect directly to Codex App Server over stdio or an unauthenticated WebSocket. A server-side gateway owns the Codex App Server process, authentication boundary, approvals, audit logs, and event fan-out.

Deployment must not assume that the target machine has a global `codex` executable or a developer's `~/.codex` directory. The web application must declare, bundle, install, or build the Codex runtime as an application-owned dependency/artifact. Production Codex configuration, provider definitions, credentials, and persisted runtime state must be supplied through app-owned config, environment variables, secrets, and mounted storage such as `CODEX_HOME`, not through a human developer's home directory.

## Frontend Design System Boundary

All browser frontend work must follow the root `designs/` specification, especially `designs/DESIGN.md` and `designs/references/tokens.css`.

The frontend technology direction is fixed as a web application built with Next.js, React, TypeScript, Tailwind CSS, shadcn/ui on Radix UI primitives, and lucide-react icons unless the user explicitly approves a different direction. Do not introduce Ant Design, MUI, Bootstrap, Mantine, a desktop UI shell, a marketing-page-first experience, or an unrelated admin-template visual system as the primary UI direction.

The product UI must follow the ChatGPT-like commerce agent workbench style defined in `designs/`: quiet grayscale surfaces, a left sidebar, centered mode switch, central work composer, restrained borders and shadows, sparse color, and explicit approval/readback surfaces for commerce actions. Do not copy ChatGPT/OpenAI trademarks, logos, or proprietary assets.

Generated scaffolds, component-library defaults, one-off page styles, nested `AGENTS.md` files, or future implementation plans must not weaken or bypass this design system. If a requested frontend change conflicts with `designs/`, stop and ask the user before proceeding.

## E-Commerce Agent Expectations

When adding features, keep the agent grounded in real commerce operations:

- orders, refunds, cancellations, fulfillment, and exception handling
- inventory, warehouse, stock movement, and availability
- product catalog, SKU mapping, listings, pricing, and content
- customer support, dispute handling, reviews, and post-sale workflows
- sales analytics, campaign analysis, forecasting, and operational reporting
- ERP, marketplace, logistics, WMS, CRM, and finance integrations

Side-effecting workflows must be explicit about what system is changed, what record is affected, what approval is required, and what readback proves success.

## Implementation Rules

- Before adding any major agent feature, identify how it connects to the Codex harness.
- Keep harness-facing code isolated behind small, well-named modules so product code does not depend on unstable protocol details everywhere.
- Preserve streamed event semantics rather than collapsing all work into opaque request/response calls.
- Preserve approval and permission checks for any operation that can change external commerce data.
- Do not log secrets, access tokens, private customer data, or raw personally identifiable information.
- Prefer structured schemas for tools, events, commerce records, and integration payloads.
- Add tests around harness adapters, commerce tool contracts, approval gates, and idempotent write behavior.

## Documentation Rules

- Architecture docs must state that the project is built on the Codex open-source harness.
- Any proposal to replace the harness, hide it behind an incompatible abstraction, or make it incidental must be rejected unless the user explicitly changes this invariant.
- When documenting commerce workflows, distinguish draft output, proposed action, approved action, downstream write, and verified readback.

## AI-Assisted Collaboration Rules

- Before editing, read `README.md`, `CONTRIBUTING.md`, `docs/architecture/overview.md`, the affected feature document, and `designs/DESIGN.md` for frontend work.
- Treat generated plans and scaffolds as proposals, not authority. They cannot weaken this file or move Harness-owned behavior into custom code.
- Do not ship fake controls. Every enabled UI command must have a real backend behavior; unavailable capabilities must be explicitly disabled or omitted.
- Preserve a dirty working tree. Never reset, revert, overwrite, or reformat changes you did not create.
- Add append-only migrations for persisted contract changes and register them in the migration runner.
- Update architecture, design, deployment, and environment documentation in the same change that alters those contracts.
- Before declaring completion, run the repository validation matrix in `CONTRIBUTING.md`. Frontend changes require real browser inspection; external writes require downstream readback.
- Distinguish implemented, committed, pushed, deployed, and production-verified states in every handoff.
- When asked to publish, inspect the complete diff and ignored files, verify no secrets/runtime/customer artifacts are staged, then report the exact pushed commit SHA.

## Initial References

- OpenAI Codex open-source repository: `openai/codex`
- Codex App Server source path: `openai/codex/codex-rs/app-server`
- Official Codex App Server documentation: `https://developers.openai.com/codex/app-server`
- Official Codex open-source components documentation: `https://developers.openai.com/codex/open-source`
