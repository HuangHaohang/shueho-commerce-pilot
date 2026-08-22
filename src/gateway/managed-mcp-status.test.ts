import assert from "node:assert/strict";
import test from "node:test";

import { readManagedMcpStatus } from "./managed-mcp-status.js";

test("reads the current App Server MCP tool-map response", () => {
  const status = readManagedMcpStatus(
    {
      data: [
        {
          name: "commerce_web",
          tools: { search: { name: "search" } },
          authStatus: "unsupported",
        },
      ],
    },
    "commerce_web",
  );

  assert.deepEqual(status, {
    available: true,
    serverName: "commerce_web",
    tools: ["search"],
    authStatus: "unsupported",
  });
});

test("keeps compatibility with array-shaped MCP tool catalogs", () => {
  const status = readManagedMcpStatus(
    { data: [{ name: "commerce_web", tools: [{ name: "search" }] }] },
    "commerce_web",
  );

  assert.deepEqual(status.tools, ["search"]);
  assert.equal(status.available, true);
});

test("fails closed when the required server or tool catalog is absent", () => {
  assert.equal(readManagedMcpStatus({ data: [] }, "commerce_web").available, false);
  assert.equal(
    readManagedMcpStatus({ data: [{ name: "commerce_web", tools: {} }] }, "commerce_web").available,
    false,
  );
});
