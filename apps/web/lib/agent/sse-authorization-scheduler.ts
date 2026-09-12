export const SSE_AUTHORIZATION_INTERVAL_MS = 15_000;

/** Stagger connection-local checks without caching or extending the check cadence. */
export function scheduleSseAuthorizationChecks({
  check,
  revoke,
  random = Math.random,
}: {
  check: () => Promise<boolean>;
  revoke: () => void;
  random?: () => number;
}): () => void {
  let closed = false;
  let checking = false;
  let initial: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    closed = true;
    clearTimeout(initial);
    clearInterval(interval);
    clearTimeout(deadline);
    initial = interval = deadline = undefined;
  };
  const failClosed = () => {
    if (closed) return;
    stop();
    revoke();
  };
  const run = () => {
    if (closed || checking) return;
    checking = true;
    // A database/authorization outage must not leave a stream authorized forever.
    // Abort the SSE even when an underlying database operation has not returned.
    deadline = setTimeout(failClosed, SSE_AUTHORIZATION_INTERVAL_MS);
    deadline.unref?.();
    void Promise.resolve().then(() => closed ? true : check()).then((allowed) => {
      if (!allowed) failClosed();
    }, failClosed).finally(() => {
      checking = false;
      clearTimeout(deadline);
      deadline = undefined;
    });
  };

  const sample = random();
  const fraction = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
  initial = setTimeout(() => {
    initial = undefined;
    if (closed) return;
    interval = setInterval(run, SSE_AUTHORIZATION_INTERVAL_MS);
    interval.unref?.();
    run();
  }, Math.floor(fraction * SSE_AUTHORIZATION_INTERVAL_MS));
  initial.unref?.();
  return stop;
}
