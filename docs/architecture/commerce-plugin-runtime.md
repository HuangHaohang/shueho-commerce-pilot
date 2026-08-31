# Commerce Plugin Runtime

Commerce Pilot remains built on OpenAI's open-source Codex App Server harness. The plugin layer extends commerce capabilities around that harness; it does not replace thread/turn lifecycle, event streaming, compaction, approvals, sandboxing, storage, or runtime isolation.

## Design Inputs

DeepSeek Harness demonstrates a useful registry model: a small Cordis kernel mounts plugins and manages dependencies, while capabilities collaborate through services and events. Its append-only trajectory also gives every runtime contribution a traceable source. Commerce Pilot adopts the capability registry and provenance ideas, but not the premise that every runtime subsystem is replaceable.

OpenAI's plugin package is the compatibility and distribution model. A Codex plugin has `.codex-plugin/plugin.json` and may bundle skills, MCP servers, lifecycle hooks, assets, and optional MCP-backed UI. Skills carry repeatable workflow instructions; MCP servers expose schemas, authentication, tools, structured results, and optional UI.

## Non-Replaceable Core

The following are never Commerce plugins:

- Codex App Server and its thread/turn/item protocol
- sandbox and permission enforcement
- tenant identity and runtime ownership
- persistent Harness history and native compaction
- approval, interrupt, queue, and resume semantics
- Gateway-to-BFF authentication and enterprise admission

No browser or tenant upload can provide executable plugin code, Hook commands, filesystem paths, provider identity, or process configuration.

## Supported Plugin Shapes

Commerce manifests intentionally mirror the stable subset of Codex plugin metadata:

- package identity: `name`, `version`, `description`
- install-surface metadata: display name, category, and declared capabilities
- components: skills, MCP servers, application tools, localized display names, and optional UI
- security declaration: network scope, data scope, and external write effects

The browser directory is a workbench view, not a separate product shell. It keeps navigation and account context stable, renders installed plugins from `GET /api/plugins`, and opens a read-only detail view inside the same main region. The per-plugin plus control means "view details" until a reviewed lifecycle API exists; it must never imply that a browser-side install succeeded. Detail rows lead with application-owned Chinese capability names; protocol identifiers such as `commerce_web.search` and `image_gen` remain visible only as technical subtitles. Lucide icons identify plugin types, while application-owned raster covers may illustrate detail pages without becoming executable plugin content.

Runtime support is narrower than the manifest vocabulary:

1. **Native Harness capability** - a product directory entry such as image generation may expose a capability verified by `modelProvider/capabilities/read`; it must use the native Item lifecycle rather than duplicating the tool in Gateway.
2. **Managed MCP plugin** - application-controlled MCP process or remote service, explicit enabled-tool allowlist, tenant authorization, and App Server thread-level readiness verification.
3. **Application tool plugin** - a Gateway-registered dynamic tool with a fixed schema and fail-closed dispatcher. Because App Server fixes these tools at `thread/start`, schema changes require a new persisted tool-contract version and a new task.
4. **Skill plugin** - reviewed instructions and resources that reference only already-authorized tools.
5. **MCP UI plugin** - future structured UI returned by an approved MCP server; the tool must remain useful without the component.

Plugin-provided Hooks remain disabled for hosted tenants. Production Hooks are application-managed only.

## Inventory And Lifecycle

The first product slice is a read-only inventory:

- `GET /api/plugins` requires an authenticated Enterprise context.
- Catalog manifests are application-owned and validated with a closed schema.
- Enablement comes from live Gateway, MCP, and Provider evidence rather than a UI toggle or manifest default.
- The browser can inspect tools, capabilities, provenance, data scope, network scope, and write effects.
- Arbitrary package installation, remote marketplace mutation, and host execution are explicitly false.

Future installation follows a fail-closed lifecycle:

```text
discovered -> schema-validated -> reviewed -> tenant-approved -> installed -> runtime-verified -> enabled
```

Every transition must persist plugin id/version/source, tenant/workspace, actor, declared permissions, resolved tool ids, approval result, and verification readback. Disable and uninstall must interrupt affected work safely, remove tool exposure, reload the managed MCP catalog, and verify the tool is absent from the exact thread runtime.

## Commerce Requirements

Side-effecting commerce plugins additionally require:

- business permission checks for the target system and record
- explicit user approval describing the mutation
- idempotency keys and bounded retries
- structured audit events without raw secrets or unnecessary PII
- downstream readback proving the write took effect
- tenant-scoped credentials stored outside manifests and browser payloads

This boundary lets Commerce Pilot gain a plugin ecosystem without turning a hosted e-commerce Agent into a browser-accessible package runner.
