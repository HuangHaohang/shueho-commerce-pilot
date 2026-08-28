import "dotenv/config";

import assert from "node:assert/strict";

const gatewayBaseUrl = process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787";
const gatewayToken = process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN;
const model = process.env.CODEX_DEFAULT_MODEL ?? "gpt-5.6-sol";

const threadPayload = await gatewayJson("/api/threads", {
  method: "POST",
  body: JSON.stringify({ model, title: "steer-fifo-smoke" }),
});
const threadId = readPath(threadPayload, ["result", "thread", "id"]);
assert.ok(threadId, "Gateway did not return a thread id.");

const turnPayload = await gatewayJson(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
  method: "POST",
  body: JSON.stringify({
    message: "请写一份至少 30 段的电商渠道分析，生成期间接受我接下来的调整方向。",
    model,
    effort: "medium",
  }),
});
const turnId = readPath(turnPayload, ["result", "turn", "id"]);
assert.ok(turnId, "Gateway did not return a turn id.");

const inputs = ["调整 A：先说明目标用户。", "调整 B：再说明核心卖点。", "调整 C：最后说明首周指标。"];
const queued = await Promise.all(
  inputs.map((message) =>
    gatewayJson(`/api/threads/${encodeURIComponent(threadId)}/queue`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  ),
);
const submissions = queued.map((payload) => {
  const id = readPath(payload, ["queuedSubmission", "id"]);
  const clientUserMessageId = readPath(payload, ["queuedSubmission", "clientUserMessageId"]);
  assert.ok(id && clientUserMessageId, "Gateway did not return a complete queued submission.");
  return { id, clientUserMessageId };
});

const steerResults = await Promise.all(
  submissions.map(async (submission) => {
    const response = await gatewayFetch(
      `/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(submission.id)}/steer`,
      {
        method: "POST",
        body: JSON.stringify({
          expectedTurnId: turnId,
          clientUserMessageId: submission.clientUserMessageId,
        }),
      },
    );
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      status: response.status,
      error: payload && typeof payload.error === "string" ? payload.error : null,
    };
  }),
);
assert.ok(
  steerResults.some((result) => result.status === 200),
  `No queued submission completed the native interrupt-and-start transition: ${JSON.stringify(steerResults)}`,
);

const deadline = Date.now() + 90_000;
let lastSnapshot: ResolutionSnapshot | null = null;
while (Date.now() < deadline) {
  lastSnapshot = await readResolutionSnapshot(threadId, submissions.map((item) => item.clientUserMessageId));
  if (
    lastSnapshot.committedClientIds.length === submissions.length &&
    lastSnapshot.queuedClientIds.length === 0
  ) {
    break;
  }
  await delay(500);
}

assert.ok(lastSnapshot, "No reconciliation snapshot was produced.");
assert.deepEqual(lastSnapshot.unresolvedClientIds, [], "A rapid steer input was lost.");
assert.deepEqual(lastSnapshot.duplicateClientIds, [], "A rapid steer input was duplicated.");
assert.deepEqual(
  lastSnapshot.committedClientIds,
  submissions.map((item) => item.clientUserMessageId),
  "Committed rapid steers did not preserve FIFO order.",
);

await waitForThreadIdle(threadId, 90_000);
const lateMessage = "迟到调整 D：原 turn 已结束时应自动成为下一轮任务。";
const lateQueuePayload = await gatewayJson(`/api/threads/${encodeURIComponent(threadId)}/queue`, {
  method: "POST",
  body: JSON.stringify({ message: lateMessage }),
});
const lateSubmissionId = readPath(lateQueuePayload, ["queuedSubmission", "id"]);
const lateClientId = readPath(lateQueuePayload, ["queuedSubmission", "clientUserMessageId"]);
assert.ok(lateSubmissionId && lateClientId, "Gateway did not return the late queued submission.");
const lateSteerPayload = await gatewayJson(
  `/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(lateSubmissionId)}/steer`,
  {
    method: "POST",
    body: JSON.stringify({ expectedTurnId: turnId, clientUserMessageId: lateClientId }),
  },
);
assert.ok(
  ["startedAfterTurnEnded", "alreadyStarted"].includes(
    readPath(lateSteerPayload, ["result", "mode"]) ?? "",
  ),
  "A steer submitted after completion did not resolve through the next Harness turn.",
);
const lateDeadline = Date.now() + 30_000;
let lateSnapshot: ResolutionSnapshot | null = null;
while (Date.now() < lateDeadline) {
  lateSnapshot = await readResolutionSnapshot(threadId, [lateClientId]);
  if (lateSnapshot.unresolvedClientIds.length === 0) {
    break;
  }
  await delay(250);
}
assert.ok(lateSnapshot, "No late-steer reconciliation snapshot was produced.");
assert.deepEqual(lateSnapshot.unresolvedClientIds, [], "The late steer was lost.");
assert.deepEqual(lateSnapshot.duplicateClientIds, [], "The late steer was duplicated.");

console.log(
  JSON.stringify({
    ok: true,
    threadId,
    turnId,
    steerStatuses: steerResults.map((result) => result.status),
    committedCount: lastSnapshot.committedClientIds.length,
    lateSteerMode: readPath(lateSteerPayload, ["result", "mode"]),
  }),
);

type ResolutionSnapshot = {
  committedClientIds: string[];
  queuedClientIds: string[];
  unresolvedClientIds: string[];
  duplicateClientIds: string[];
};

async function readResolutionSnapshot(threadId: string, targetClientIds: string[]): Promise<ResolutionSnapshot> {
  const [threadPayload, queuePayload] = await Promise.all([
    gatewayJson(`/api/threads/${encodeURIComponent(threadId)}`),
    gatewayJson(`/api/threads/${encodeURIComponent(threadId)}/queue`),
  ]);
  const targetSet = new Set(targetClientIds);
  const committedClientIds: string[] = [];
  const occurrences = new Map<string, number>();
  const turns = readArrayPath(threadPayload, ["result", "thread", "turns"]);
  for (const turn of turns) {
    if (!isRecord(turn) || !Array.isArray(turn.items)) {
      continue;
    }
    for (const item of turn.items) {
      if (!isRecord(item) || item.type !== "userMessage" || typeof item.clientId !== "string") {
        continue;
      }
      if (!targetSet.has(item.clientId)) {
        continue;
      }
      committedClientIds.push(item.clientId);
      occurrences.set(item.clientId, (occurrences.get(item.clientId) ?? 0) + 1);
    }
  }
  const queuedClientIds = readArrayPath(queuePayload, ["queue"])
    .filter(isRecord)
    .map((item) => item.clientUserMessageId)
    .filter((clientId): clientId is string => typeof clientId === "string" && targetSet.has(clientId));
  for (const clientId of queuedClientIds) {
    occurrences.set(clientId, (occurrences.get(clientId) ?? 0) + 1);
  }
  return {
    committedClientIds,
    queuedClientIds,
    unresolvedClientIds: targetClientIds.filter((clientId) => !occurrences.has(clientId)),
    duplicateClientIds: targetClientIds.filter((clientId) => (occurrences.get(clientId) ?? 0) > 1),
  };
}

async function gatewayJson(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await gatewayFetch(path, init);
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || !isRecord(payload)) {
    throw new Error(
      `Gateway ${path} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (gatewayToken) {
    headers.set("X-Commerce-Gateway-Token", gatewayToken);
  }
  return fetch(new URL(path, gatewayBaseUrl), { ...init, headers, signal: AbortSignal.timeout(90_000) });
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

async function waitForThreadIdle(threadId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await gatewayJson(`/api/threads/${encodeURIComponent(threadId)}`);
    if (readPath(payload, ["result", "thread", "status", "type"]) === "idle") {
      return;
    }
    await delay(500);
  }
  throw new Error("Timed out waiting for the smoke-test thread to become idle.");
}
