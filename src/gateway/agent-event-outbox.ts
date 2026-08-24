import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RuntimeScope = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  rootThreadId: string;
  parentThreadId: string | null;
  model: string | null;
};

type AgentEventBase = Omit<RuntimeScope, "model"> & {
  model: string | null;
  eventId: string;
  threadId: string;
  turnId: string;
  occurredAt: string;
};

export type UsageCompletedEvent = AgentEventBase & {
  kind: "usage.response.completed";
  source?: "codex_harness" | "commerce_web_mcp" | "commerce_web_tool" | "commerce_image_tool" | "title_generation";
  responseId: string;
  providerId: string;
  requestedModel?: string | null;
  usageStatus?: "reported" | "missing";
  usage: {
    totalTokens: number;
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
};

export type TurnCompletedEvent = AgentEventBase & {
  kind: "turn.completed";
  status: "completed" | "interrupted" | "failed";
  durationMs: number | null;
  requestId?: string;
};

export type AgentOutboxEvent = UsageCompletedEvent | TurnCompletedEvent;

type DeadLetterEvent = {
  event: AgentOutboxEvent;
  reason: string;
  failedAt: string;
};

export class AgentEventOutbox {
  private readonly directory: string;
  private readonly path: string;
  private readonly deadLetterPath: string;
  private readonly events = new Map<string, AgentOutboxEvent>();
  private deadLetters: DeadLetterEvent[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(codexHome: string) {
    this.directory = join(codexHome, "commerce-runtime");
    this.path = join(this.directory, "agent-event-outbox.json");
    this.deadLetterPath = join(this.directory, "agent-event-dead-letter.json");
  }

  async load(): Promise<void> {
    const parsed = await readOptionalArray(this.path, "Agent event outbox");
    for (const value of parsed) {
      if (isAgentOutboxEvent(value)) this.events.set(value.eventId, value);
    }
    const deadLetters = await readOptionalArray(this.deadLetterPath, "Agent event dead-letter file");
    this.deadLetters = deadLetters.filter(isDeadLetterEvent);
  }

  async enqueue(event: AgentOutboxEvent): Promise<boolean> {
    if (this.events.has(event.eventId)) return false;
    this.events.set(event.eventId, event);
    await this.persist();
    return true;
  }

  list(): AgentOutboxEvent[] {
    return [...this.events.values()];
  }

  async acknowledge(eventId: string): Promise<void> {
    if (!this.events.delete(eventId)) return;
    await this.persist();
  }

  async acknowledgeMany(eventIds: readonly string[]): Promise<void> {
    let changed = false;
    for (const eventId of eventIds) changed = this.events.delete(eventId) || changed;
    if (changed) await this.persist();
  }

  async quarantine(eventId: string, reason: string): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) return;
    this.events.delete(eventId);
    this.deadLetters.push({ event, reason: reason.slice(0, 300), failedAt: new Date().toISOString() });
    await this.persist();
  }

  deadLetterCount(): number {
    return this.deadLetters.length;
  }

  async requeueDeadLetters(): Promise<number> {
    const deadLetters = this.deadLetters;
    this.deadLetters = [];
    let requeued = 0;
    for (const deadLetter of deadLetters) {
      if (this.events.has(deadLetter.event.eventId)) continue;
      this.events.set(deadLetter.event.eventId, deadLetter.event);
      requeued += 1;
    }
    await this.persist();
    return requeued;
  }

  async flush(): Promise<void> {
    await this.tail;
  }

  private persist(): Promise<void> {
    const payload = `${JSON.stringify(this.list())}\n`;
    const deadLetterPayload = `${JSON.stringify(this.deadLetters)}\n`;
    const operation = this.tail.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await Promise.all([
        writePrivateAtomic(this.path, payload),
        writePrivateAtomic(this.deadLetterPath, deadLetterPayload),
      ]);
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

async function writePrivateAtomic(path: string, payload: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

async function readOptionalArray(path: string, label: string): Promise<unknown[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`${label} must contain an array.`);
    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function isDeadLetterEvent(value: unknown): value is DeadLetterEvent {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      isAgentOutboxEvent((value as Record<string, unknown>).event) &&
      typeof (value as Record<string, unknown>).reason === "string" &&
      typeof (value as Record<string, unknown>).failedAt === "string",
  );
}

function isAgentOutboxEvent(value: unknown): value is AgentOutboxEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    (event.kind === "usage.response.completed" || event.kind === "turn.completed") &&
    typeof event.eventId === "string" &&
    typeof event.tenantId === "string" &&
    typeof event.workspaceId === "string" &&
    typeof event.userId === "string" &&
    typeof event.rootThreadId === "string" &&
    typeof event.threadId === "string" &&
    typeof event.turnId === "string" &&
    typeof event.occurredAt === "string"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
