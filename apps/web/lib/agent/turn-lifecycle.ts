export type ActiveTurnClock = {
  turnId: string | null;
  startedAt: number | null;
};

export function activateTurnClock(
  current: ActiveTurnClock,
  turnId: string,
  observedAt: number,
): ActiveTurnClock {
  if (current.turnId === turnId && current.startedAt !== null) {
    return current;
  }
  return { turnId, startedAt: observedAt };
}
