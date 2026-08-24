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

export function shouldExpireActiveTurn(
  current: ActiveTurnClock,
  expectedTurnId: string,
  expectedStartedAt: number,
  now: number,
  maxDurationMs: number,
): boolean {
  return (
    current.turnId === expectedTurnId &&
    current.startedAt === expectedStartedAt &&
    now - expectedStartedAt >= maxDurationMs
  );
}

export function shouldIgnoreTerminalSnapshotWhileConnecting(
  localStatus: string,
  snapshotStatus: string,
): boolean {
  return localStatus === "connecting" && snapshotStatus !== "running";
}
