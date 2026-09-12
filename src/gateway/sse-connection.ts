import type { ServerResponse } from "node:http";

type SseResponse = Pick<ServerResponse,
  "destroyed" | "writableEnded" | "writableLength" | "write" | "end" | "destroy" | "on" | "removeListener"
>;

type SseConnectionOptions = {
  onClose: () => void;
  maxBufferedBytes?: number;
  maxBlockedMs?: number;
  heartbeatIntervalMs?: number;
};

/** Bounds one subscriber's transport buffer without blocking Harness event fan-out. */
export class SseConnection {
  private closed = false;
  private blockedTimer?: NodeJS.Timeout;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly maxBufferedBytes: number;
  private readonly maxBlockedMs: number;

  constructor(private readonly response: SseResponse, private readonly options: SseConnectionOptions) {
    this.maxBufferedBytes = options.maxBufferedBytes ?? 1024 * 1024;
    this.maxBlockedMs = options.maxBlockedMs ?? 30_000;
    response.on("close", this.cleanup);
    response.on("finish", this.cleanup);
    response.on("error", this.disconnect);
    response.on("drain", this.onDrain);
    this.heartbeat = setInterval(() => this.send(`: keepalive ${Date.now()}\n\n`), options.heartbeatIntervalMs ?? 20_000);
    this.heartbeat.unref();
  }

  send(frame: string): boolean {
    if (this.closed) return false;
    if (this.response.destroyed || this.response.writableEnded) {
      this.cleanup();
      return false;
    }
    if (this.response.writableLength + Buffer.byteLength(frame) > this.maxBufferedBytes) {
      this.disconnect();
      return false;
    }
    try {
      if (!this.response.write(frame) && !this.blockedTimer) {
        this.blockedTimer = setTimeout(this.disconnect, this.maxBlockedMs);
        this.blockedTimer.unref();
      }
      return true;
    } catch {
      this.disconnect();
      return false;
    }
  }

  close(): void {
    if (this.closed) return;
    if (this.response.writableLength > 0) {
      this.disconnect();
      return;
    }
    this.cleanup();
    this.response.end();
  }

  private readonly onDrain = (): void => {
    clearTimeout(this.blockedTimer);
    this.blockedTimer = undefined;
  };

  private readonly disconnect = (): void => {
    if (this.closed) return;
    this.cleanup();
    // Reconnect reconciles native state; a subscriber failure never interrupts its Turn.
    this.response.destroy();
  };

  private readonly cleanup = (): void => {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.onDrain();
    this.response.removeListener("close", this.cleanup);
    this.response.removeListener("finish", this.cleanup);
    this.response.removeListener("error", this.disconnect);
    this.response.removeListener("drain", this.onDrain);
    this.options.onClose();
  };
}
