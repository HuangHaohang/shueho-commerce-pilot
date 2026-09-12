import type { LocalModelClient } from "./local-model-client.js";

type WarmupClient = Pick<LocalModelClient, "warmup">;
type WarmupEvent = { event: "local_model_warmup_ready" | "local_model_warmup_unavailable" };

export class LocalModelWarmupRecovery {
  private attempted = false;
  private ready = false;
  private inFlight: Promise<boolean> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly models: WarmupClient,
    private readonly log: (event: WarmupEvent) => void,
    private readonly retryIntervalMs = 30_000,
  ) {}

  isReady(): boolean {
    return this.ready;
  }

  attempt(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    const attempt = this.runAttempt();
    this.inFlight = attempt;
    void attempt.finally(() => {
      if (this.inFlight === attempt) this.inFlight = null;
    });
    return attempt;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.attempt();
    }, this.retryIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async runAttempt(): Promise<boolean> {
    const firstAttempt = !this.attempted;
    const wasReady = this.ready;
    this.attempted = true;
    try {
      await this.models.warmup();
      this.ready = true;
      if (!wasReady) this.log({ event: "local_model_warmup_ready" });
      return true;
    } catch {
      this.ready = false;
      if (firstAttempt || wasReady) this.log({ event: "local_model_warmup_unavailable" });
      return false;
    }
  }
}
