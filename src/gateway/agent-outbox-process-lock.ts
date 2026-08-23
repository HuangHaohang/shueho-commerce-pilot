import { chmod, mkdir, open, readFile, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

export class AgentOutboxProcessLock {
  private readonly path: string;
  private handle: FileHandle | null = null;

  constructor(codexHome: string) {
    this.path = join(codexHome, "commerce-runtime", "agent-event-outbox.lock");
  }

  async acquire(purpose: "gateway" | "maintenance"): Promise<void> {
    if (this.handle) throw new Error("Agent outbox process lock is already held.");
    await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.path, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, purpose, acquiredAt: new Date().toISOString() })}\n`);
        await chmod(this.path, 0o600);
        this.handle = handle;
        return;
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        const owner = await readOwner(this.path);
        if (!owner || isProcessAlive(owner.pid)) {
          throw new Error(
            `Agent outbox is owned by an active or unverifiable process${owner ? ` (${owner.pid}, ${owner.purpose})` : ""}.`,
          );
        }
        await unlink(this.path).catch((unlinkError) => {
          if (!isNodeError(unlinkError) || unlinkError.code !== "ENOENT") throw unlinkError;
        });
      }
    }
    throw new Error("Could not acquire the Agent outbox process lock.");
  }

  async release(): Promise<void> {
    if (!this.handle) return;
    await this.handle.close();
    this.handle = null;
    const owner = await readOwner(this.path);
    if (owner?.pid === process.pid) {
      await unlink(this.path).catch((error) => {
        if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      });
    }
  }
}

async function readOwner(path: string): Promise<{ pid: number; purpose: string } | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).pid === "number" &&
      typeof (parsed as Record<string, unknown>).purpose === "string"
    ) {
      return {
        pid: (parsed as Record<string, unknown>).pid as number,
        purpose: (parsed as Record<string, unknown>).purpose as string,
      };
    }
    return null;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
