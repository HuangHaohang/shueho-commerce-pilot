import type { ConversationMessage } from "./use-agent-thread";

export function mergeAuthoritativeMessages(
  current: ConversationMessage[],
  authoritative: ConversationMessage[],
): ConversationMessage[] {
  let next = current;
  for (const message of authoritative) {
    const existing = next.find(
      (candidate) =>
        candidate.id === message.id ||
        Boolean(message.clientId && candidate.clientId === message.clientId),
    );
    if (!existing) {
      next = [...next, message];
      continue;
    }
    next = next.map((candidate) =>
      candidate.id === existing.id
        ? candidate.role === "assistant" &&
          message.role === "assistant" &&
          candidate.status === "streaming"
          ? {
              ...candidate,
              ...message,
              content:
                candidate.content.length > message.content.length
                  ? candidate.content
                  : message.content,
              status: "streaming",
            }
          : { ...candidate, ...message }
        : candidate,
    );
  }
  return next;
}
