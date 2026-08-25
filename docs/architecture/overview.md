# Architecture Overview

## Product

SHUEHO Commerce Pilot is an Enterprise, browser-based e-commerce Agent for research, content, catalog, order, inventory, support, reporting, and operational workflows. It is not a generic chat demo and not a local coding-agent UI.

## Non-Negotiable Agent Foundation

The Agent runtime is OpenAI's open-source Codex Harness through Codex App Server. This is an architectural invariant, not an interchangeable provider choice.

Codex App Server owns:

- thread and Turn lifecycle;
- persisted multi-turn history;
- streamed item and Turn events;
- tool-call lifecycle;
- `request_user_input` and approval pauses;
- interruption, steering, queueing, continuation, recovery, and compaction;
- Skill invocation and multi-agent collaboration.

Commerce Pilot must not replace these concerns with a custom agent loop, prompt chain, LangChain/LangGraph-style orchestrator, another generic agent framework, or browser-owned state machine. Product code may adapt App Server protocol details behind narrow modules, but the Harness remains authoritative.

## Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Browser application | Next.js 15 App Router, React 19, TypeScript | Workbench, conversation UI, BFF route handlers, authenticated artifact delivery |
| UI system | Tailwind CSS v4, shadcn/ui, Radix primitives, lucide-react | Accessible controls and the project design system |
| Client server-state | TanStack Query | Models, threads, plugins, Skills, Enterprise state, cache invalidation |
| Agent gateway | Node.js 20.16+, TypeScript, native HTTP/SSE | App Server ownership, policy, scope binding, event sanitization, host tools |
| Agent runtime | `@openai/codex` App Server | Threads, Turns, streaming, tools, Skills, approvals, queue, compaction, multi-agent |
| Agent protocol | JSON-RPC over application-owned stdio | Gateway-to-App Server communication only |
| Authentication | Better Auth | Browser sessions and invitation-only identity |
| Business database | PostgreSQL 16 | Enterprise identity, RBAC, RLS, thread index, quotas, usage, deletion jobs |
| External tools | Application-managed MCP and host tools | Web Search, image generation, future commerce systems |
| Artifact storage | Tenant-dedicated `CODEX_HOME` volumes | Codex state, generated images, uploads, extracted documents, outbox |
| Document parsing | PDF.js, Mammoth, ExcelJS, file-type | Bounded tenant attachment extraction; never arbitrary host-file access |
| Tests | Node test runner, Vitest, Testing Library, Playwright/browser QA | Gateway contracts, web logic, UI and runtime verification |

## Process And Trust Boundaries

```text
Browser
  -> Next.js BFF (session, tenant, workspace, permission checks)
  -> private Gateway HTTP/SSE (service token + server-derived scope)
  -> Codex App Server over stdio
  -> Codex Harness
  -> allowlisted MCP / application host tools
  -> commerce systems or provider APIs
```

The browser never connects directly to App Server and never supplies `cwd`, provider identity, tool definitions, sandbox policy, developer instructions, Skill paths, host paths, Hook commands, or Enterprise scope headers.

## Sources Of Truth

| Concern | Authoritative source |
|---|---|
| Conversation messages and Turn state | Codex App Server thread history |
| Active Turn and queue | App Server read/queue APIs |
| Browser identity and Enterprise access | Better Auth + PostgreSQL RLS context |
| Thread ownership index | PostgreSQL `commerce_agent_thread` |
| Skill catalog | App Server `skills/list` for the application runtime root |
| Plugin availability | Application manifests + live Gateway/MCP/provider evidence |
| Tool permissions | Application runtime registry and server-owned policy |
| Usage | Exact provider/App Server usage events + idempotent PostgreSQL ledger |
| Uploaded/generated media | Tenant artifact metadata + ownership-checked BFF URL |
| External write completion | Downstream write receipt followed by readback evidence |

## Main Request Flows

### Start A Turn

1. Browser submits natural-language text, selected Skill name, and optional files to the BFF.
2. BFF authenticates the user, resolves tenant/workspace scope, checks thread ownership, quota, and rate limits.
3. Files upload first and bind to the same `clientRequestId` as the Turn.
4. Gateway reconciles active Harness state, resolves the Skill path through `skills/list`, and validates artifact ownership.
5. Gateway calls native `turn/start` with text, Skill, `localImage`, and bounded document-context inputs.
6. App Server streams item lifecycle events; Gateway sanitizes and fans out allowlisted events through SSE.
7. BFF records completion/usage and the browser reconciles optimistic messages with authoritative item ids.

### Side-Effecting Commerce Tool

1. Agent proposes a structured action against a named external system and record.
2. Application authorization checks tenant, workspace, user, tool, and object scope.
3. Human approval is requested when required.
4. The application executes an idempotent write.
5. The same integration reads the changed object back.
6. UI distinguishes proposed, approved, written, and verified states.

No external write is complete merely because the model said it succeeded.

## Repository Boundaries

```text
apps/web/                 Next.js browser application and BFF
src/codex/                narrow App Server protocol/runtime adapters
src/gateway/              private Gateway, policy, stores, event handling
src/provider/             Responses-compatible model/provider client
apps/web/migrations/      append-only PostgreSQL migrations
scripts/                  smoke, security, reconciliation, backfill tools
designs/                  mandatory frontend design system
docs/                     architecture, development, deployment contracts
```

New commerce integrations belong in explicit application tools or managed MCP servers. They do not belong in shell commands, browser fetches to vendor APIs, arbitrary filesystem access, or generated Hooks.
