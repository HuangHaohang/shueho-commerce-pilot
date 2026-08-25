import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const IMAGE_FILENAME_PATTERN = /^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i;
const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

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
  createdAt: string;
};

export type SaveGeneratedImageInput = Omit<GeneratedImageArtifact, "version" | "filename" | "createdAt"> & {
  base64: string;
};

export class GeneratedImageStore {
  private readonly imageDirectory: string;
  private readonly metadataDirectory: string;

  constructor(codexHome: string) {
    this.imageDirectory = join(codexHome, "generated_images");
    this.metadataDirectory = join(codexHome, "generated_image_metadata");
  }

  async save(input: SaveGeneratedImageInput): Promise<GeneratedImageArtifact> {
    assertAgentId(input.threadId, "thread id");
    assertAgentId(input.turnId, "turn id");
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
      createdAt: new Date().toISOString(),
    };
    await this.ensureDirectories();
    await writeFile(this.imagePath(filename), Buffer.from(input.base64, "base64"), { mode: 0o600 });
    await this.writeMetadata(artifact);
    return artifact;
  }

  async registerExisting(
    filename: string,
    input: Omit<GeneratedImageArtifact, "version" | "filename">,
  ): Promise<GeneratedImageArtifact> {
    assertImageFilename(filename);
    assertAgentId(input.threadId, "thread id");
    assertAgentId(input.turnId, "turn id");
    await stat(this.imagePath(filename));
    const artifact: GeneratedImageArtifact = { version: 1, filename, ...input };
    await this.ensureDirectories();
    await this.writeMetadata(artifact);
    return artifact;
  }

  async readImage(filename: string): Promise<Buffer> {
    assertImageFilename(filename);
    return readFile(this.imagePath(filename));
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
    let entries: string[];
    try {
      entries = await readdir(this.metadataDirectory);
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }
      throw error;
    }
    const artifacts = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const filename = entry.slice(0, -".json".length);
          if (!isSafeImageFilename(filename)) {
            return null;
          }
          return this.get(filename);
        }),
    );
    return artifacts
      .filter((artifact): artifact is GeneratedImageArtifact => artifact?.threadId === threadId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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
    await writeFile(this.metadataPath(artifact.filename), `${JSON.stringify(artifact)}\n`, { mode: 0o600 });
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
    createdAt: value.createdAt,
  };
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
