export const AGENT_READ_TIMEOUT_MS = 15_000;

/** Bounded GET/readback only. Mutations must retain their own uncertain-result policy. */
export async function readAgentJson<T>(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; payload: T | null }> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Agent read deadline exceeded.", "TimeoutError")),
    options.timeoutMs ?? AGENT_READ_TIMEOUT_MS,
  );
  let rejectAborted!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  try {
    controller.signal.throwIfAborted();
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch((error: unknown) => {
          controller.signal.throwIfAborted();
          if (error instanceof SyntaxError) return null;
          throw error;
        });
        return { ok: response.ok, status: response.status, payload: payload as T | null };
      })(),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
    controller.signal.removeEventListener("abort", rejectAborted);
  }
}
