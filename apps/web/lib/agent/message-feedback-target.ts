export type RateableAgentMessageTarget = {
  turnId: string;
  text: string;
};

export function readRateableAgentMessageTarget(
  payload: unknown,
  messageItemId: string,
): RateableAgentMessageTarget | null {
  if (!isRecord(payload) || !isRecord(payload.result)) return null;
  const thread = isRecord(payload.result.thread) ? payload.result.thread : null;
  const turns = thread && Array.isArray(thread.turns) ? thread.turns.filter(isRecord) : [];

  for (const turn of turns) {
    const turnId = typeof turn.id === "string" ? turn.id : "";
    if (!turnId || !isTerminalTurnStatus(turn.status)) continue;
    const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
    const item = items.find((candidate) => candidate.id === messageItemId);
    if (!item) continue;
    if (
      item.type !== "agentMessage" ||
      item.phase === "commentary" ||
      typeof item.text !== "string" ||
      !item.text.trim()
    ) {
      return null;
    }
    return { turnId, text: item.text };
  }
  return null;
}

function isTerminalTurnStatus(value: unknown): boolean {
  return value === "completed" || value === "interrupted" || value === "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
