export function isMissingCodexThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /(?:no rollout found for thread id|thread(?: id)? .* not found|thread not found)/i.test(message);
}

/** Harness explicitly reports this only before a thread's first user message. */
export function isUnmaterializedCodexThreadError(error: unknown): boolean {
  return error instanceof Error && /^thread [A-Za-z0-9_-]+ is not materialized yet; thread\/turns\/list is unavailable before first user message$/.test(error.message);
}
