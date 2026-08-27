export function isMissingCodexThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /(?:no rollout found for thread id|thread(?: id)? .* not found|thread not found)/i.test(message);
}
