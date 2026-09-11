import { chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** A kernel-backed lock: process death releases it even when container PIDs repeat. */
export class AgentOutboxProcessLock {
  private readonly path: string;
  private database: DatabaseSync | null = null;

  constructor(codexHome: string) {
    this.path = join(codexHome, "commerce-runtime", "agent-event-outbox.lock");
  }

  async acquire(_purpose: "gateway" | "maintenance"): Promise<void> {
    if (this.database) throw new Error("Agent outbox process lock is already held.");
    await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
    const existing = await readFile(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    // Never steal an old PID lock, whose process may live in another namespace.
    if (existing && existing.subarray(0, 16).toString() !== "SQLite format 3\0") {
      throw new Error("Agent outbox is owned by an active or unverifiable legacy process. Stop all writers before removing the legacy lock.");
    }
    let database: DatabaseSync | null = null;
    try {
      database = new DatabaseSync(this.path);
      await chmod(this.path, 0o600);
      database.exec("PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS lock_format (version INTEGER); BEGIN EXCLUSIVE;");
      this.database = database;
    } catch (error) {
      database?.close();
      throw new Error("Agent outbox is owned by an active or unverifiable process.", { cause: error });
    }
  }

  async release(): Promise<void> {
    const database = this.database;
    if (!database) return;
    this.database = null;
    try {
      database.exec("ROLLBACK;");
    } finally {
      database.close();
    }
    // Keep the SQLite file: older PID-lock writers must also fail closed.
  }
}
