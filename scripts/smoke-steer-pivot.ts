import "dotenv/config";

import assert from "node:assert/strict";

const gatewayBaseUrl = process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787";
const gatewayToken = process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN;
const model = process.env.CODEX_DEFAULT_MODEL ?? "gpt-5.6-sol";
const oldMarker = "OLD_DIRECTION_SHOULD_NOT_APPEAR";
const pivotMarker = "PIVOT_OK";

const thread = await gatewayJson("/api/threads", {
  method: "POST",
  body: JSON.stringify({ model, title: "steer-pivot-smoke" }),
});
const threadId = readString(thread, "result", "thread", "id");
assert.ok(threadId, "Gateway did not return a thread id.");

const turn = await gatewayJson(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
  method: "POST",
  body: JSON.stringify({
    message: `写一篇很长的电商分析，每一段都必须包含 ${oldMarker}，至少写 30 段。`,
    model,
    effort: "medium",
  }),
});
const expectedTurnId = readString(turn, "result", "turn", "id");
assert.ok(expectedTurnId, "Gateway did not return a turn id.");

const queued = await gatewayJson(`/api/threads/${encodeURIComponent(threadId)}/queue`, {
  method: "POST",
  body: JSON.stringify({
    message: `立即停止刚才的长文任务，不要输出旧标记，只回复 ${pivotMarker}。`,
  }),
});
const queuedSubmissionId = readString(queued, "queuedSubmission", "id");
const clientUserMessageId = readString(queued, "queuedSubmission", "clientUserMessageId");
assert.ok(queuedSubmissionId && clientUserMessageId, "Gateway did not return a queued steer.");

const steer = await gatewayJson(
  `/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(queuedSubmissionId)}/steer`,
  {
    method: "POST",
    body: JSON.stringify({ expectedTurnId, clientUserMessageId }),
  },
);
assert.equal(
  readString(steer, "result", "mode"),
  "interruptedAndStarted",
  "Pivot input did not interrupt and start the queued Harness turn.",
);

const deadline = Date.now() + 60_000;
let finalText = "";
let finalStatus = "";
while (Date.now() < deadline) {
  const history = await gatewayJson(`/api/threads/${encodeURIComponent(threadId)}`);
  const turns = readArray(history, "result", "thread", "turns");
  const lastTurn = turns.at(-1);
  if (isRecord(lastTurn)) {
    finalStatus = typeof lastTurn.status === "string" ? lastTurn.status : "";
    finalText = (Array.isArray(lastTurn.items) ? lastTurn.items : [])
      .filter(isRecord)
      .filter((item) => item.type === "agentMessage" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("\n");
  }
  if (
    turns.length >= 2 &&
    finalStatus !== "inProgress" &&
    finalStatus !== "running"
  ) {
    break;
  }
  await delay(250);
}

assert.equal(finalStatus, "completed", "Steered pivot turn did not complete.");
assert.ok(finalText.includes(pivotMarker), "The model did not follow the pivot instruction.");
assert.ok(!finalText.includes(oldMarker), "The model completed content from the superseded direction.");

console.log(
  JSON.stringify({
    ok: true,
    threadId,
    expectedTurnId,
    mode: "interruptedAndStarted",
    pivotMarker,
  }),
);

async function gatewayJson(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (gatewayToken) {
    headers.set("X-Commerce-Gateway-Token", gatewayToken);
  }
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

function readString(value: unknown, ...path: string[]): string | null {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }
  return typeof current === "string" ? current : null;
}

function readArray(value: unknown, ...path: string[]): unknown[] {
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
