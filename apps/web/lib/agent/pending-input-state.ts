export type QueuedMessage = {
  id: string;
  clientUserMessageId: string;
  content: string;
  pendingSteer: boolean;
};

export function reconcilePendingInputState(
  serverQueue: QueuedMessage[],
  serverPendingSteers: QueuedMessage[],
  localPendingSteers: Iterable<QueuedMessage>,
  committedClientIds: ReadonlySet<string>,
): { queue: QueuedMessage[]; pendingSteers: QueuedMessage[] } {
  const pendingByClientId = new Map<string, QueuedMessage>();
  for (const item of serverPendingSteers) {
    if (!committedClientIds.has(item.clientUserMessageId)) {
      pendingByClientId.set(item.clientUserMessageId, { ...item, pendingSteer: true });
    }
  }
  for (const item of localPendingSteers) {
    if (!committedClientIds.has(item.clientUserMessageId)) {
      pendingByClientId.set(item.clientUserMessageId, { ...item, pendingSteer: true });
    }
  }

  const pendingSteers = [...pendingByClientId.values()];
  const pendingClientIds = new Set(pendingSteers.map((item) => item.clientUserMessageId));
  return {
    queue: serverQueue.filter(
      (item) =>
        !committedClientIds.has(item.clientUserMessageId) &&
        !pendingClientIds.has(item.clientUserMessageId),
    ),
    pendingSteers,
  };
}
