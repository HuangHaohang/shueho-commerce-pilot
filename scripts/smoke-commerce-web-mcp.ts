import "dotenv/config";

import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const mcpClient = new Client({ name: "commerce-web-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("dist/src/mcp/commerce-web-server.js")],
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  ),
});

await mcpClient.connect(transport);
try {
  const catalog = await mcpClient.listTools();
  assert.ok(catalog.tools.some((tool) => tool.name === "search"), "MCP server did not expose search.");
} finally {
  await mcpClient.close();
}

const gatewayBaseUrl = process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787";
const gatewayToken = process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN;
const model = process.env.CODEX_DEFAULT_MODEL ?? "gpt-5.6-sol";
const smokeTenantId = process.env.COMMERCE_SMOKE_TENANT_ID ?? "00000000-0000-4000-8000-000000000101";
const smokeWorkspaceId = process.env.COMMERCE_SMOKE_WORKSPACE_ID ?? "00000000-0000-4000-8000-000000000102";
const smokeUserId = process.env.COMMERCE_SMOKE_USER_ID ?? "commerce-web-smoke";
const health = await gatewayJson("/health");
assert.equal(readPath(health, ["managedMcp", "state"]), "ready", "Gateway MCP readiness is not ready.");
const managedTools = readArrayPath(health, ["managedMcp", "tools"]);
assert.ok(managedTools.includes("search"), "Gateway App Server did not discover commerce_web.search.");

let threadId: string | null = null;
try {
  const created = await gatewayJson("/api/threads", {
    method: "POST",
    body: JSON.stringify({ model, title: "commerce-web-harness-smoke" }),
  });
  threadId = readPath(created, ["result", "thread", "id"]);
  assert.ok(threadId, "Gateway did not return a thread id.");

  const started = await gatewayJson(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
    method: "POST",
    body: JSON.stringify({
      message:
        "必须调用 commerce_web MCP 的 search 工具搜索 OpenAI Codex MCP 官方配置文档，并返回至少一个来源 URL。不要仅凭记忆回答。",
      model,
      effort: "medium",
    }),
  });
  const turnId = readPath(started, ["result", "turn", "id"]);
  assert.ok(turnId, "Gateway did not return a turn id.");

  const deadline = Date.now() + 210_000;
  let turn: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const history = await gatewayJson(`/api/threads/${encodeURIComponent(threadId)}`);
    turn =
      readArrayPath(history, ["result", "thread", "turns"])
        .filter(isRecord)
        .find((candidate) => candidate.id === turnId) ?? null;
    if (turn && turn.status !== "inProgress" && turn.status !== "running") {
      break;
    }
    await delay(1_000);
  }

  assert.ok(turn, "Harness Web Search turn was not found.");
  assert.equal(turn.status, "completed", "Harness Web Search turn did not complete.");
  const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
  const mcpCalls = items.filter((item) => item.type === "mcpToolCall");
  assert.ok(
    mcpCalls.some(
      (item) => item.server === "commerce_web" && item.tool === "search" && item.status === "completed",
    ),
    "Harness never completed commerce_web.search.",
  );
  const finalText =
    items
      .filter((item) => item.type === "agentMessage" && typeof item.text === "string")
      .map((item) => item.text as string)
      .at(-1) ?? "";
  assert.match(finalText, /https?:\/\//, "Harness Web Search final answer contains no source URL.");
  assert.doesNotMatch(finalText, /(没有|无|未).{0,8}(Web Search|网页搜索|搜索工具)/i);

  console.log(
    JSON.stringify(
      {
        ok: true,
        tool: "commerce_web.search",
        gatewayMcpState: readPath(health, ["managedMcp", "state"]),
        threadId,
        turnId,
        callStatuses: mcpCalls.map((item) => item.status),
        hasSource: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (threadId) {
    await gatewayJson(`/api/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" }).catch(() => undefined);
  }
}

async function gatewayJson(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const headers = new Headers(init?.headers);
  if (init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (gatewayToken) {
    headers.set("X-Commerce-Gateway-Token", gatewayToken);
  }
  headers.set("X-Commerce-Tenant-Id", smokeTenantId);
  headers.set("X-Commerce-Workspace-Id", smokeWorkspaceId);
  headers.set("X-Commerce-User-Id", smokeUserId);
  const response = await fetch(new URL(path, gatewayBaseUrl), {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Gateway ${path} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function readPath(value: unknown, path: string[]): string | null {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }
  return typeof current === "string" ? current : null;
}

function readArrayPath(value: unknown, path: string[]): unknown[] {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return [];
    }
    current = current[segment];
  }
  return Array.isArray(current) ? current : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
