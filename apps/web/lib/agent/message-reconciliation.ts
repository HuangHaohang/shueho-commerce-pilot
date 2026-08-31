import type { ConversationMessage } from "./use-agent-thread";

export function mergeAuthoritativeMessages(
  current: ConversationMessage[],
  authoritative: ConversationMessage[],
): ConversationMessage[] {
  let next = current;
  for (const message of authoritative) {
    const existing = findMatchingConversationMessage(next, message);
    if (!existing) {
      next = [...next, message];
      continue;
    }
    next = next.map((candidate) =>
      candidate.id === existing.id
        ? candidate.role === "assistant" &&
          message.role === "assistant" &&
          candidate.status === "streaming" &&
          message.status === "streaming"
          ? {
              ...candidate,
              ...message,
              content:
                candidate.content.length > message.content.length
                  ? candidate.content
                  : message.content,
              status: "streaming",
            }
          : {
              ...candidate,
              ...message,
              ...((message.products ?? candidate.products)
                ? { products: message.products ?? candidate.products }
                : {}),
            }
        : candidate,
    );
  }
  const seenUserClientIds = new Set<string>();
  return next.filter((message) => {
    if (message.role !== "user" || !message.clientId) return true;
    if (seenUserClientIds.has(message.clientId)) return false;
    seenUserClientIds.add(message.clientId);
    return true;
  });
}

export function findMatchingConversationMessage(
  messages: ConversationMessage[],
  incoming: ConversationMessage,
): ConversationMessage | undefined {
  return messages.find((candidate) => {
    if (candidate.id === incoming.id) return true;
    if (incoming.clientId && candidate.clientId === incoming.clientId) return true;
    if (
      candidate.role !== "assistant" ||
      incoming.role !== "assistant" ||
      candidate.turnId !== incoming.turnId ||
      (candidate.phase !== incoming.phase && candidate.phase != null && incoming.phase != null)
    ) {
      return false;
    }
    if (candidate.content === incoming.content) return true;
    return (
      candidate.status === "streaming" &&
      candidate.content.length > 0 &&
      incoming.content.startsWith(candidate.content)
    );
  });
}
