# Documentation Map

Read documents in this order when joining the project or starting an AI-assisted task.

## Required First

1. [`../AGENTS.md`](../AGENTS.md) - non-negotiable product, Codex Harness, security, and frontend invariants. AI coding agents must read this before changing code.
2. [`../README.md`](../README.md) - product status, local startup, scripts, and current capabilities.
3. [`../CONTRIBUTING.md`](../CONTRIBUTING.md) - branch, migration, validation, commit, and pull-request workflow.

## Architecture

- [`architecture/overview.md`](architecture/overview.md) - system map, technology stack, ownership boundaries, and request flows.
- [`architecture/codex-app-server-gateway.md`](architecture/codex-app-server-gateway.md) - App Server process, protocol adapter, event fan-out, and runtime policy.
- [`architecture/enterprise-tenancy.md`](architecture/enterprise-tenancy.md) - organization, tenant, workspace, RBAC, quota, RLS, and production isolation.
- [`architecture/authentication.md`](architecture/authentication.md) - Better Auth and invitation-only access.
- [`architecture/commerce-plugin-runtime.md`](architecture/commerce-plugin-runtime.md) - application-managed plugin catalog.
- [`architecture/commerce-skill-runtime.md`](architecture/commerce-skill-runtime.md) - Codex Skills, explicit invocation, and managed Skill publication.
- [`architecture/commerce-copywriting-workflow.md`](architecture/commerce-copywriting-workflow.md) - conversational copywriting Task Recipe.
- [`architecture/external-data-mcp.md`](architecture/external-data-mcp.md) - Harness-to-SHUEHO MCP boundary, approval, audit, billing and customer MCP access.
- [`architecture/external-data-service.md`](architecture/external-data-service.md) - independent JustOneAPI REST collector, raw/normalized/business warehouse, pgvector, local Qwen3 models and Elasticsearch.
- [`architecture/commerce-thread-titles.md`](architecture/commerce-thread-titles.md) - Spark-generated titles and deterministic category correction.
- [`architecture/thread-attachments.md`](architecture/thread-attachments.md) - tenant-owned photos and document inputs.
- [`architecture/thread-deletion.md`](architecture/thread-deletion.md) - durable permanent deletion and artifact cleanup.

## Development And Operations

- [`development/ai-collaboration.md`](development/ai-collaboration.md) - shared vibe-coding workflow for humans and coding agents.
- [`development/agent-bootstrap-prompt.md`](development/agent-bootstrap-prompt.md) - copyable prompt that tells a coding agent how to clone, read rules, branch, implement, verify, and hand off.
- [`deployment/runtime.md`](deployment/runtime.md) - production runtime, secrets, volumes, workers, callbacks, and deployment gates.
- [`security/dependency-advisories.md`](security/dependency-advisories.md) - open npm advisory reachability, compensating controls, and review deadlines.
- [`config/custom-model-provider.md`](config/custom-model-provider.md) - custom Responses-compatible provider configuration.
- [`../designs/DESIGN.md`](../designs/DESIGN.md) - frontend visual system and UX rules.

When implementation changes one of these contracts, update the corresponding document in the same pull request.
