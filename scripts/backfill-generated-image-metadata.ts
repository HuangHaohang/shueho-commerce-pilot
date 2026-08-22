import "dotenv/config";

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { GeneratedImageStore } from "../src/gateway/generated-image-store.js";

type ImageToolCall = {
  threadId: string;
  turnId: string;
  callId: string | null;
  startedAtMs: number;
};

const codexHome = resolve(process.cwd(), process.env.CODEX_HOME || ".runtime/codex");
const imageDirectory = join(codexHome, "generated_images");
const store = new GeneratedImageStore(codexHome);
const imageModel = process.env.COMMERCE_IMAGE_MODEL?.trim() || "gpt-image-2";

const [imageEntries, rolloutFiles] = await Promise.all([
  readDirectoryOrEmpty(imageDirectory),
  listRolloutFiles(codexHome),
]);
const calls = (await Promise.all(rolloutFiles.map(readImageToolCalls))).flat().sort((left, right) => left.startedAtMs - right.startedAtMs);
const unmatchedCalls = new Set(calls);
let backfilled = 0;
let alreadyIndexed = 0;
let unmatchedImages = 0;

for (const filename of imageEntries.filter((entry) => store.isSafeFilename(entry)).sort()) {
  if (await store.get(filename)) {
    alreadyIndexed += 1;
    continue;
  }
  const imageStats = await stat(join(imageDirectory, filename));
  const filenameTimestamp = Number.parseInt(filename.split("-", 1)[0] ?? "", 10);
  const imageCreatedAtMs = Number.isFinite(filenameTimestamp) ? filenameTimestamp : imageStats.mtimeMs;
  const match = [...unmatchedCalls]
    .filter((call) => call.startedAtMs <= imageCreatedAtMs && imageCreatedAtMs - call.startedAtMs <= 10 * 60_000)
    .sort((left, right) => right.startedAtMs - left.startedAtMs)[0];
  if (!match) {
    unmatchedImages += 1;
    continue;
  }
  await store.registerExisting(filename, {
    threadId: match.threadId,
    turnId: match.turnId,
    callId: match.callId,
    model: imageModel,
    mimeType: store.imageContentType(filename),
    quality: null,
    size: null,
    createdAt: new Date(imageCreatedAtMs).toISOString(),
  });
  unmatchedCalls.delete(match);
  backfilled += 1;
}

console.log(JSON.stringify({ ok: unmatchedImages === 0, backfilled, alreadyIndexed, unmatchedImages, discoveredToolCalls: calls.length }, null, 2));
if (unmatchedImages > 0) {
  process.exitCode = 1;
}

async function readImageToolCalls(path: string): Promise<ImageToolCall[]> {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  let threadId = "";
  const calls: ImageToolCall[] = [];
  for (const line of lines) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || !isRecord(entry.payload)) {
      continue;
    }
    const payload = entry.payload;
    if (entry.type === "session_meta") {
      threadId = typeof payload.id === "string" ? payload.id : typeof payload.session_id === "string" ? payload.session_id : "";
      continue;
    }
    if (entry.type !== "response_item" || payload.type !== "custom_tool_call" || !threadId) {
      continue;
    }
    const toolName = typeof payload.name === "string" ? payload.name : "";
    const toolInput = typeof payload.input === "string" ? payload.input : "";
    if (!toolName.includes("commerce_image") && !toolInput.includes("commerce_image__generate")) {
      continue;
    }
    const metadata = isRecord(payload.internal_chat_message_metadata_passthrough)
      ? payload.internal_chat_message_metadata_passthrough
      : null;
    const turnId = metadata && typeof metadata.turn_id === "string" ? metadata.turn_id : "";
    const startedAtMs = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    if (!turnId || !Number.isFinite(startedAtMs)) {
      continue;
    }
    calls.push({
      threadId,
      turnId,
      callId: typeof payload.call_id === "string" ? payload.call_id : null,
      startedAtMs,
    });
  }
  return calls;
}

async function listRolloutFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const directory of [join(root, "sessions"), join(root, "archived_sessions")]) {
    await walk(directory, files);
  }
  return files.filter((path) => path.endsWith(".jsonl"));
}

async function walk(directory: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path, files);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }),
  );
}

async function readDirectoryOrEmpty(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
