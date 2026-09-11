import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("production search MCP starts with provider-only environment and no Gateway credentials", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-web-startup-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "gpt-5.6-luna" }, { id: "gpt-image-2" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./commerce-web-server.js", import.meta.url))],
    cwd: root,
    env: {
      NODE_ENV: "production",
      COMMERCE_PROVIDER_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      COMMERCE_PROVIDER_API_KEY: "fixture-only",
    },
    stderr: "inherit",
  });
  const client = new Client({ name: "startup-test", version: "1" });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["search"]);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
