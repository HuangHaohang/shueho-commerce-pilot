import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPublicHttpTransport } from "./public-http-transport.js";

test("long public MCP calls emit keepalive frames and dispatch exactly once", async () => {
  let calls = 0;
  const pending = new Set<ReturnType<typeof createPublicHttpTransport>>();
  const http = createServer(async (request, response) => {
    const server = new McpServer({ name: "transport-test", version: "1.0.0" });
    server.registerTool("delayed_probe", { inputSchema: {} }, async () => {
      calls += 1;
      await delay(120);
      return { content: [{ type: "text", text: "complete" }] };
    });
    const transport = createPublicHttpTransport(15);
    pending.add(transport);
    response.on("close", () => {
      pending.delete(transport);
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response);
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "delayed_probe", arguments: {} } }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(response.headers.get("mcp-session-id"), null);
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /: keepalive/);
    let output = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += new TextDecoder().decode(chunk.value);
    }
    assert.match(output, /"id":7/);
    assert.match(output, /complete/);
    assert.equal(calls, 1);
  } finally {
    await Promise.all([...pending].map((transport) => transport.close()));
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
  }
});
