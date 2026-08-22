import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PendingSteerState } from "./pending-steer-state.js";

export class PendingSteerStore {
  private readonly directory: string;
  private readonly path: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(codexHome: string) {
    this.directory = join(codexHome, "commerce-runtime");
    this.path = join(this.directory, "pending-steers.json");
  }

  async load(): Promise<PendingSteerState[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isPendingSteerState) : [];
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  save(states: PendingSteerState[]): Promise<void> {
    const payload = `${JSON.stringify(states)}\n`;
    const operation = this.tail.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

function isPendingSteerState(value: unknown): value is PendingSteerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const state = value as Record<string, unknown>;
  return (
    typeof state.threadId === "string" &&
    typeof state.turnId === "string" &&
    typeof state.queuedSubmissionId === "string" &&
    typeof state.clientUserMessageId === "string" &&
    typeof state.content === "string" &&
    typeof state.sequence === "number" &&
    Number.isSafeInteger(state.sequence) &&
    state.sequence > 0
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
