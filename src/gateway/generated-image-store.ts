import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const IMAGE_FILENAME_PATTERN = /^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i;
const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_IMAGE_EDIT_SOURCES = 4;
const MAX_IMAGE_EDIT_SOURCE_BYTES = 25 * 1024 * 1024;

export type GeneratedImageArtifact = {
  version: 1;
  filename: string;
  threadId: string;
  turnId: string;
  callId: string | null;
  model: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  quality: string | null;
  size: string | null;
  sourceFilenames: string[];
  createdAt: string;
  copyOf?: string;
  copyRequestId?: string;
};

export type SaveGeneratedImageInput = Omit<
  GeneratedImageArtifact,
  "version" | "filename" | "sourceFilenames" | "createdAt"
> & {
  base64: string;
  sourceFilenames?: string[];
};

export class GeneratedImageStore {
  private readonly imageDirectory: string;
  private readonly metadataDirectory: string;
  private readonly pendingCallSaves = new Map<string, Promise<GeneratedImageArtifact>>();

  private inventory: { stamp: string; byThread: Map<string, GeneratedImageArtifact[]> } | null = null;
  private inventoryRead: Promise<Map<string, GeneratedImageArtifact[]>> | null = null;

  constructor(codexHome: string) {
    this.imageDirectory = join(codexHome, "generated_images");
    this.metadataDirectory = join(codexHome, "generated_image_metadata");
  }

  async save(input: SaveGeneratedImageInput): Promise<GeneratedImageArtifact> {
    assertAgentId(input.threadId, "thread id");
    assertAgentId(input.turnId, "turn id");
    const sourceFilenames = normalizeSourceFilenames(input.sourceFilenames);
    const extension = extensionForMimeType(input.mimeType);
    const filename = `${Date.now()}-${randomUUID()}.${extension}`;
    const artifact: GeneratedImageArtifact = {
      version: 1,
      filename,
      threadId: input.threadId,
      turnId: input.turnId,
      callId: input.callId,
      model: input.model,
      mimeType: input.mimeType,
      quality: input.quality,
      size: input.size,
      sourceFilenames,
      createdAt: new Date().toISOString(),
      ...(input.copyOf ? { copyOf: input.copyOf } : {}),
      ...(input.copyRequestId ? { copyRequestId: input.copyRequestId } : {}),
    };
    await this.ensureDirectories();
    await writeFile(this.imagePath(filename), Buffer.from(input.base64, "base64"), { mode: 0o600 });
    await this.writeMetadata(artifact);
    return artifact;
  }

  async saveOnceForCall(input: SaveGeneratedImageInput): Promise<GeneratedImageArtifact> {
    if (!input.callId) return this.save(input);
    const key = `${input.threadId}:${input.turnId}:${input.callId}`;
    const pending = this.pendingCallSaves.get(key);
    if (pending) return pending;
    const operation = (async () =>
      (await this.findByCallId(input.threadId, input.turnId, input.callId as string)) ?? this.save(input)
    )().finally(() => this.pendingCallSaves.delete(key));
    this.pendingCallSaves.set(key, operation);
    return operation;
  }

  async registerExisting(
    filename: string,
    input: Omit<GeneratedImageArtifact, "version" | "filename" | "sourceFilenames"> & {
      sourceFilenames?: string[];
    },
  ): Promise<GeneratedImageArtifact> {
    assertImageFilename(filename);
    assertAgentId(input.threadId, "thread id");
    assertAgentId(input.turnId, "turn id");
    await stat(this.imagePath(filename));
    const artifact: GeneratedImageArtifact = {
      version: 1,
      filename,
      ...input,
      sourceFilenames: normalizeSourceFilenames(input.sourceFilenames),
    };
    await this.ensureDirectories();
    await this.writeMetadata(artifact);
    return artifact;
  }

  async readImage(filename: string): Promise<Buffer> {
    assertImageFilename(filename);
    return readFile(this.imagePath(filename));
  }

  async copyImage(filename: string, expectedThreadId: string, requestId: string): Promise<GeneratedImageArtifact> {
    assertAgentId(requestId, "copy request id");
    const key = `copy:${expectedThreadId}:${requestId}`;
    const pending = this.pendingCallSaves.get(key);
    if (pending) {
      const artifact = await pending;
      if (artifact.copyOf !== filename) throw new Error("Image copy request conflicts with its original source.");
      return artifact;
    }
    const operation = (async () => {
      const source = await this.get(filename);
      if (!source || source.threadId !== expectedThreadId) throw new Error("Image copy source unavailable.");
      const existing = (await this.listForThread(expectedThreadId)).find((image) => image.copyRequestId === requestId);
      if (existing) {
        if (existing.copyOf !== filename) throw new Error("Image copy request conflicts with its original source.");
        return existing;
      }
      return this.save({ ...source, base64: (await this.readImage(filename)).toString("base64"), callId: null, sourceFilenames: [], copyOf: filename, copyRequestId: requestId });
    })().finally(() => this.pendingCallSaves.delete(key));
    this.pendingCallSaves.set(key, operation);
    return operation;
  }

  async get(filename: string): Promise<GeneratedImageArtifact | null> {
    assertImageFilename(filename);
    try {
      const parsed = JSON.parse(await readFile(this.metadataPath(filename), "utf8")) as unknown;
      return parseArtifact(parsed, filename);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async listForThread(threadId: string): Promise<GeneratedImageArtifact[]> {
    assertAgentId(threadId, "thread id");
    const byThread = await this.readInventory();
    // Callers must not mutate the shared metadata cache.
    return (byThread.get(threadId) ?? []).map((artifact) => ({ ...artifact, sourceFilenames: [...artifact.sourceFilenames] }));
  }

  private async readInventory(): Promise<Map<string, GeneratedImageArtifact[]>> {
    if (this.inventoryRead) return this.inventoryRead;
    const operation = (async () => {
      let directory;
      try { directory = await stat(this.metadataDirectory, { bigint: true }); }
      catch (error) { if (isNotFoundError(error)) return new Map<string, GeneratedImageArtifact[]>(); throw error; }
      const stamp = `${directory.mtimeNs}:${directory.ctimeNs}`;
      if (this.inventory?.stamp === stamp) return this.inventory.byThread;
      const entries = (await readdir(this.metadataDirectory)).filter((entry) => entry.endsWith(".json") && isSafeImageFilename(entry.slice(0, -5)));
      const byThread = new Map<string, GeneratedImageArtifact[]>();
      // Bound file descriptors during cold starts and coalesce concurrent inventory reads.
      for (let offset = 0; offset < entries.length; offset += 32) {
        const batch = await Promise.all(entries.slice(offset, offset + 32).map((entry) => this.get(entry.slice(0, -5))));
        for (const artifact of batch) {
          if (!artifact) continue;
          const items = byThread.get(artifact.threadId) ?? [];
          items.push(artifact); byThread.set(artifact.threadId, items);
        }
      }
      for (const items of byThread.values()) items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      this.inventory = { stamp, byThread };
      return byThread;
    })().finally(() => { this.inventoryRead = null; });
    this.inventoryRead = operation;
    return operation;
  }

  async recordEditSources(threadId: string, turnId: string, filenames: string[]): Promise<void> {
    assertAgentId(threadId, "thread id"); assertAgentId(turnId, "turn id");
    await this.ensureDirectories();
    await writeFile(join(this.metadataDirectory, `${threadId}-${turnId}.sources`), JSON.stringify({ threadId, filenames: normalizeSourceFilenames(filenames) }), { mode: 0o600 });
  }
  async readEditSources(threadId: string, turnId: string): Promise<string[]> {
    assertAgentId(threadId, "thread id"); assertAgentId(turnId, "turn id");
    try {
      const value = JSON.parse(await readFile(join(this.metadataDirectory, `${threadId}-${turnId}.sources`), "utf8"));
      return value.threadId === threadId ? normalizeSourceFilenames(value.filenames) : [];
    } catch (error) { if (isNotFoundError(error)) return []; throw error; }
  }

  async authorizeSources(threadId: string, sources: Array<{ filename: string; threadId: string }>): Promise<void> {
    assertAgentId(threadId, "thread id");
    for (const source of sources) {
      const artifact = await this.get(source.filename);
      if (!artifact || artifact.threadId !== source.threadId) throw new Error("Image source ownership changed.");
      await this.ensureDirectories();
      await writeFile(join(this.metadataDirectory, `${threadId}-${source.filename}.grant`), JSON.stringify({ threadId, sourceThreadId: source.threadId, filename: source.filename }), { mode: 0o600 });
    }
  }

  async buildTurnInputs(
    threadId: string,
    filenames: string[],
  ): Promise<Array<{ type: "image"; url: string }>> {
    assertAgentId(threadId, "thread id");
    const normalized = normalizeSourceFilenames(filenames);
    const inputs: Array<{ type: "image"; url: string }> = [];
    for (const filename of normalized) {
      const artifact = await this.get(filename);
      if (!artifact) throw new Error("Generated image source is unavailable.");
      if (artifact.threadId !== threadId) {
        const grant = await readFile(join(this.metadataDirectory, `${threadId}-${filename}.grant`), "utf8")
          .then((value) => JSON.parse(value))
          .catch(() => { throw new Error("Generated image source does not belong to this thread."); });
        if (grant.threadId !== threadId || grant.sourceThreadId !== artifact.threadId || grant.filename !== filename) throw new Error("Generated image source does not belong to this thread.");
      }
      const bytes = await this.readImage(filename);
      if (!bytes.length || bytes.length > MAX_IMAGE_EDIT_SOURCE_BYTES) {
        throw new Error("Generated image source exceeds the native image input bound.");
      }
      inputs.push({ type: "image", url: `data:${artifact.mimeType};base64,${bytes.toString("base64")}` });
    }
    return inputs;
  }

  async findByCallId(
    threadId: string,
    turnId: string,
    callId: string,
  ): Promise<GeneratedImageArtifact | null> {
    return (await this.listForThread(threadId)).find(
      (artifact) => artifact.turnId === turnId && artifact.callId === callId,
    ) ?? null;
  }

  async deleteForThreads(threadIds: Iterable<string>): Promise<{ files: number; metadata: number }> {
    const targets = new Set(threadIds);
    for (const threadId of targets) assertAgentId(threadId, "thread id");
    let entries: string[];
    try {
      entries = await readdir(this.metadataDirectory);
    } catch (error) {
      if (isNotFoundError(error)) return { files: 0, metadata: 0 };
      throw error;
    }
    let files = 0;
    let metadata = 0;
    for (const entry of entries) {
      if (entry.endsWith(".grant") || entry.endsWith(".sources")) {
        const grant = JSON.parse(await readFile(join(this.metadataDirectory, entry), "utf8"));
        if (targets.has(grant.threadId) || targets.has(grant.sourceThreadId)) await removeIfPresent(join(this.metadataDirectory, entry));
        continue;
      }
      if (!entry.endsWith(".json")) continue;
      const filename = entry.slice(0, -".json".length);
      if (!isSafeImageFilename(filename)) continue;
      const artifact = await this.get(filename);
      if (!artifact || !targets.has(artifact.threadId)) continue;
      if (await removeIfPresent(this.imagePath(filename))) files += 1;
      if (await removeIfPresent(this.metadataPath(filename))) metadata += 1;
    }
    return { files, metadata };
  }

  imageContentType(filename: string): GeneratedImageArtifact["mimeType"] {
    assertImageFilename(filename);
    const extension = extname(filename).toLowerCase();
    return extension === ".jpg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
  }

  isSafeFilename(filename: string): boolean {
    return isSafeImageFilename(filename);
  }

  private async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.imageDirectory, { recursive: true, mode: 0o700 }),
      mkdir(this.metadataDirectory, { recursive: true, mode: 0o700 }),
    ]);
  }

  private async writeMetadata(artifact: GeneratedImageArtifact): Promise<void> {
    const target = this.metadataPath(artifact.filename);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(artifact)}\n`, { mode: 0o600 });
      await rename(temporary, target);
      this.inventory = null;
    } finally { await rm(temporary, { force: true }); }
  }

  private imagePath(filename: string): string {
    return join(this.imageDirectory, filename);
  }

  private metadataPath(filename: string): string {
    return join(this.metadataDirectory, `${filename}.json`);
  }
}

function parseArtifact(value: unknown, expectedFilename: string): GeneratedImageArtifact | null {
  if (!isRecord(value) || value.version !== 1 || value.filename !== expectedFilename) {
    return null;
  }
  if (
    typeof value.threadId !== "string" ||
    !AGENT_ID_PATTERN.test(value.threadId) ||
    typeof value.turnId !== "string" ||
    !AGENT_ID_PATTERN.test(value.turnId) ||
    typeof value.model !== "string" ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !isImageMimeType(value.mimeType)
  ) {
    return null;
  }
  return {
    version: 1,
    filename: expectedFilename,
    threadId: value.threadId,
    turnId: value.turnId,
    callId: typeof value.callId === "string" ? value.callId : null,
    model: value.model,
    mimeType: value.mimeType,
    quality: typeof value.quality === "string" ? value.quality : null,
    size: typeof value.size === "string" ? value.size : null,
    sourceFilenames: normalizeSourceFilenames(value.sourceFilenames),
    createdAt: value.createdAt,
    ...(typeof value.copyRequestId === "string" && AGENT_ID_PATTERN.test(value.copyRequestId) ? { copyRequestId: value.copyRequestId } : {}),
    ...(typeof value.copyOf === "string" && isSafeImageFilename(value.copyOf) ? { copyOf: value.copyOf } : {}),
  };
}

function normalizeSourceFilenames(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGE_EDIT_SOURCES) {
    throw new Error("Invalid generated image source list.");
  }
  const filenames = value.filter((entry): entry is string =>
    typeof entry === "string" && isSafeImageFilename(entry));
  if (filenames.length !== value.length || new Set(filenames).size !== filenames.length) {
    throw new Error("Invalid or duplicate generated image source.");
  }
  return filenames;
}

function extensionForMimeType(mimeType: GeneratedImageArtifact["mimeType"]): "png" | "jpg" | "webp" {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
}

function assertImageFilename(filename: string): void {
  if (!isSafeImageFilename(filename)) {
    throw new Error("Invalid generated image filename.");
  }
}

function isSafeImageFilename(filename: string): boolean {
  return filename === basename(filename) && IMAGE_FILENAME_PATTERN.test(filename);
}

function assertAgentId(value: string, label: string): void {
  if (!AGENT_ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
}

function isImageMimeType(value: unknown): value is GeneratedImageArtifact["mimeType"] {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

async function removeIfPresent(path: string): Promise<boolean> {
  try {
    await rm(path, { force: false });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}
