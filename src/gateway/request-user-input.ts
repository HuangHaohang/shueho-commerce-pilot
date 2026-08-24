import type { AppServerEvent, JsonRpcId } from "../codex/protocol.js";

export type PendingRequestUserInput = {
  id: JsonRpcId;
  requestId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: unknown[];
  isBlocking: boolean;
  receivedAt: string;
};

export function readPendingRequestUserInput(
  event: Extract<AppServerEvent, { type: "server_request" }>,
): PendingRequestUserInput | null {
  if (!isRecord(event.params)) return null;
  const threadId = typeof event.params.threadId === "string" ? event.params.threadId : "";
  const turnId = typeof event.params.turnId === "string" ? event.params.turnId : "";
  const itemId = typeof event.params.itemId === "string" ? event.params.itemId : "";
  const questions = Array.isArray(event.params.questions) ? event.params.questions : [];
  if (!isSafeAgentId(threadId) || !isSafeAgentId(turnId) || !itemId || questions.length < 1 || questions.length > 3) {
    return null;
  }
  return {
    id: event.id,
    requestId: String(event.id),
    threadId,
    turnId,
    itemId,
    questions,
    isBlocking: event.params.isBlocking !== false,
    receivedAt: event.at,
  };
}

export function serializePendingRequestUserInput(request: PendingRequestUserInput): Record<string, unknown> {
  return {
    requestId: request.requestId,
    threadId: request.threadId,
    turnId: request.turnId,
    itemId: request.itemId,
    questions: request.questions,
    isBlocking: request.isBlocking,
    receivedAt: request.receivedAt,
  };
}

export function normalizeRequestUserInputAnswers(
  value: unknown,
  questions: unknown[],
): Record<string, { answers: string[] }> | null {
  if (!isRecord(value)) return null;
  const normalized: Record<string, { answers: string[] }> = {};
  for (const question of questions) {
    if (!isRecord(question) || typeof question.id !== "string" || !/^[a-z0-9_]{1,64}$/.test(question.id)) {
      return null;
    }
    const answer = value[question.id];
    if (!isRecord(answer) || !Array.isArray(answer.answers)) return null;
    const answers = answer.answers
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (answers.length < 1 || answers.length > 4 || answers.some((item) => item.length > 2_000)) {
      return null;
    }
    normalized[question.id] = { answers };
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeAgentId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}
