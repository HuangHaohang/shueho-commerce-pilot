# Comate MCP client compatibility

Commerce Pilot is built on the open-source Codex Harness. This optional local
stdio client adapter changes only MCP tool-schema representation; it does not
implement an agent loop, approvals, provider dispatch, token rotation or retries.

Comate SDK 1.0.33 / pi-ai 0.82.1 coerces `anyOf` alternatives before checking
whether the original value already matches one. A nullable price schema with a
number/minimum-zero branch first can therefore turn an intentional `null` into
`0`. Reordering branches is unsafe because the opposite order can turn a real
zero into null.

`scripts/commerce-mcp-client-bridge.ts` connects to the public authenticated MCP
using `COMMERCE_MCP_AUTH_HEADER`. It exposes equivalent primitive type-array
schemas, for example `type: ["number", "null"], minimum: 0`, while retaining
titles, descriptions, defaults and constraints. Complex or enum unions remain
unchanged. Tool calls and results pass through without parameter coercion or
automatic retries; no JustOneAPI credential is held by the client.

After `npm run build`, clients with access to the repository dependencies can
run `node dist/scripts/commerce-mcp-client-bridge.js`. A self-contained bundle
may instead be installed in the client's protected support directory. Configure
the existing `shueho-commerce-pilot` entry with that Node entrypoint and retain
its MCP authorization environment and direct-tool list. Back up the existing
client configuration and reconnect the MCP client before using refreshed schemas.

Verification must distinguish `null`, explicit `0`, and positive price bounds;
exercise the installed Comate coercion function and compare JSON-schema acceptance
before and after normalization. A provider-free planning request must retain null
price bounds and produce valid plans for both Taobao and JD. Do not convert zero
prices back to null on the server or disable platform capability checks.
