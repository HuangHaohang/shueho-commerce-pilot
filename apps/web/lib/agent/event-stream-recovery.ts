/** Coalesce transport reconnects into readback; this never retries a Turn or tool. */
export function createEventStreamRecovery(recover: () => Promise<boolean>) {
  let opened = false;
  let revision = 0;
  let recoveredRevision = 0;
  let inFlight: Promise<void> | null = null;

  const reconcile = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (recoveredRevision === revision) return Promise.resolve();
    const requestedRevision = revision;
    inFlight = Promise.resolve()
      .then(recover)
      .then((recovered) => {
        if (recovered) recoveredRevision = requestedRevision;
      })
      .catch(() => {
        // Keep recovery pending for the existing watchdog. A transport failure
        // cannot establish a Harness terminal state.
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  return {
    get pending() { return recoveredRevision !== revision; },
    onOpen(): Promise<void> {
      if (!opened) {
        opened = true;
        return Promise.resolve();
      }
      revision += 1;
      return reconcile();
    },
    reconcile,
  };
}
