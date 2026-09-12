import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  createSseParser,
  drainAbortableBody,
  safeError,
  stopSubscription,
} from "./mixed-ai-protocol.mjs";
import { percentile } from "./read-load.mjs";

const AUTHORIZATION = "server244-image-model-comparison-2026-09-12";
const MODELS = new Set(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
const QUALITIES = new Set(["low", "medium", "high", "xhigh", "max", "auto"]);
const PUBLIC_HOST = "commerce.shueho.com";
const USERS_PER_ROUND = 10;
const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));

export function readImageComparisonConfig(environment) {
  if (environment.IMAGE_COMPARISON_AUTHORIZATION !== AUTHORIZATION) throw new Error("Explicit production image comparison authorization is required.");
  if (!MODELS.has(environment.IMAGE_COMPARISON_MODEL)) throw new Error("Compare only GPT Image 2, Flare, or Sunburst.");
  if (!QUALITIES.has(environment.IMAGE_COMPARISON_QUALITY)) throw new Error("Invalid image comparison quality.");
  const base = new URL(environment.IMAGE_COMPARISON_BASE_URL ?? `https://${PUBLIC_HOST}`);
  if (base.protocol !== "https:" || base.hostname !== PUBLIC_HOST || base.pathname !== "/" || base.search || base.hash) {
    throw new Error(`Image comparison must use https://${PUBLIC_HOST}.`);
  }
  const userOffset = Number(environment.IMAGE_COMPARISON_USER_OFFSET);
  if (!Number.isInteger(userOffset) || userOffset < 0 || userOffset + USERS_PER_ROUND > 100) throw new Error("Image comparison user offset must select ten fixture users.");
  const outputDirectory = resolve(environment.IMAGE_COMPARISON_OUTPUT_DIR ?? "");
  const usersFile = resolve(environment.IMAGE_COMPARISON_USERS_FILE ?? "");
  if (!environment.IMAGE_COMPARISON_OUTPUT_DIR || !outputDirectory.includes("production-load") ||
      !environment.IMAGE_COMPARISON_USERS_FILE || !usersFile.includes("production-load")) {
    throw new Error("Image comparison files must stay in the protected production-load directory.");
  }
  return {
    baseUrl: base.origin,
    model: environment.IMAGE_COMPARISON_MODEL,
    quality: environment.IMAGE_COMPARISON_QUALITY,
    agentModel: environment.IMAGE_COMPARISON_AGENT_MODEL?.trim() || "gpt-5.6-luna",
    outputDirectory,
    usersFile,
    userOffset,
    requestTimeoutMs: 40_000,
    turnTimeoutMs: 12 * 60_000,
    pollMs: 2_000,
  };
}

async function boundedBytes(response, maximumBytes) {
  if (!response.body) throw new Error("Missing response body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("Response exceeded the comparison bound.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function json(config, user, path, body) {
  const response = await fetch(config.baseUrl + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: user.cookie, origin: config.baseUrl, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    redirect: "error",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const bytes = await boundedBytes(response, 4 * 1024 * 1024);
  const payload = JSON.parse(bytes.toString("utf8"));
  return { status: response.status, payload };
}

function subscribe(config, user, entry, startedAt) {
  const stop = new AbortController();
  let resolveReady;
  let rejectReady;
  let connected = false;
  const ready = new Promise((resolveReadyPromise, rejectReadyPromise) => {
    resolveReady = resolveReadyPromise;
    rejectReady = rejectReadyPromise;
  });
  void ready.catch(() => undefined);
  const timeout = setTimeout(() => {
    rejectReady(new Error("SSE readiness timed out."));
    stop.abort();
  }, config.requestTimeoutMs);
  const done = (async () => {
    try {
      const response = await fetch(`${config.baseUrl}/api/agent/events?threadId=${encodeURIComponent(user.threadId)}`, {
        headers: { cookie: user.cookie },
        redirect: "error",
        signal: stop.signal,
      });
      if (response.status !== 200 || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        throw new Error("SSE connection failed.");
      }
      const parser = createSseParser((frame) => {
        if (frame.event === "gateway/connected") {
          connected = true;
          clearTimeout(timeout);
          resolveReady();
          return;
        }
        let event;
        try { event = JSON.parse(frame.data); } catch { return; }
        if (event.params?.threadId && event.params.threadId !== user.threadId) return;
        if (event.method === "commerce/imageGeneration/completed" && event.params?.turnId) {
          entry.firstImageByTurn ??= {};
          entry.firstImageByTurn[event.params.turnId] ??= Date.now() - startedAt;
        }
        if (event.method === "turn/completed" && event.params?.turn?.id) {
          entry.terminalByTurn ??= {};
          entry.terminalByTurn[event.params.turn.id] = { status: event.params.turn.status, ms: Date.now() - startedAt };
        }
      });
      const complete = await drainAbortableBody(response.body, stop.signal, (chunk) => parser.push(chunk));
      if (complete) parser.finish();
    } catch (error) {
      if (!connected) rejectReady(error);
      if (!stop.signal.aborted) entry.streamError = safeError(error);
    } finally {
      clearTimeout(timeout);
      if (!connected) rejectReady(new Error("SSE ended before readiness."));
    }
  })();
  return { ready, done, stop };
}

async function readHistory(config, user) {
  const messages = [];
  let cursor = null;
  for (let page = 0; page < 8; page++) {
    const result = await json(config, user, `/api/agent/threads/${encodeURIComponent(user.threadId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (result.status !== 200 || !Array.isArray(result.payload.messages)) throw new Error("Native history read failed.");
    messages.push(...result.payload.messages);
    cursor = result.payload.nextCursor;
    if (!cursor) return { thread: result.payload.thread, messages };
  }
  throw new Error("Comparison history exceeded the bounded window.");
}

async function waitForTurn(config, user, clientRequestId, startedAt) {
  let turnId = null;
  while (Date.now() - startedAt < config.turnTimeoutMs) {
    const history = await readHistory(config, user);
    const matching = history.messages.filter((message) => message.role === "user" && message.clientId === clientRequestId);
    const turnIds = [...new Set(matching.map((message) => message.turnId).filter(Boolean))];
    if (matching.length > 1 || turnIds.length > 1) throw new Error("Comparison request was duplicated.");
    turnId ??= turnIds[0] ?? null;
    const status = await json(config, user, `/api/agent/threads/${encodeURIComponent(user.threadId)}/status`);
    if (turnId && status.status === 200 && status.payload.thread?.lastTurnId === turnId &&
        ["completed", "failed", "interrupted"].includes(status.payload.thread?.status)) {
      return { turnId, status: status.payload.thread.status, history };
    }
    await delay(config.pollMs);
  }
  throw new Error("Comparison Turn deadline exceeded; reconcile without submitting again.");
}

async function downloadImage(config, user, image, outputPath) {
  if (!/^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(image.filename)) throw new Error("Invalid generated artifact identity.");
  const response = await fetch(`${config.baseUrl}/api/provider/generated-images/${encodeURIComponent(image.filename)}`, {
    headers: { cookie: user.cookie }, redirect: "error", signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (response.status !== 200) throw new Error("Generated artifact readback failed.");
  const bytes = await boundedBytes(response, 64 * 1024 * 1024);
  const sharp = requireWeb("sharp");
  const decoder = sharp(bytes, { failOn: "warning", limitInputPixels: 16_777_216 });
  const metadata = await decoder.metadata();
  await decoder.stats();
  if (!metadata.width || !metadata.height) throw new Error("Generated artifact did not decode.");
  await writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
  return { filename: basename(outputPath), sourceFilename: image.filename, bytes: bytes.length, width: metadata.width, height: metadata.height,
    mimeType: response.headers.get("content-type")?.split(";")[0] ?? null, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function runTurn(config, user, entry, turn, save) {
  const startedAt = Date.now();
  const subscription = subscribe(config, user, entry, startedAt);
  await subscription.ready;
  turn.dispatchAttempted = true;
  turn.outcome = "uncertain";
  await save();
  try {
    const response = await json(config, user, `/api/agent/threads/${encodeURIComponent(user.threadId)}/turns`, {
      model: config.agentModel,
      effort: "low",
      workflow: "commerce-creative-project",
      productContextMode: "none",
      clientRequestId: turn.clientRequestId,
      ...(turn.sourceFilename ? { imageEditSourceFilenames: [turn.sourceFilename] } : {}),
      message: turn.sourceFilename
        ? "使用命名空间 image_gen 编辑本任务上一张图片：保持音箱外形、材质、视角和比例完全不变，仅将纯白背景改为浅暖灰，并增加柔和自然投影。只编辑一张，完成后结束。"
        : "使用命名空间 image_gen 生成一张真实影棚商品图：哑光深灰色便携蓝牙音箱，45度视角，织物网面与圆角矩形轮廓，纯白背景，柔和阴影，无文字、无商标、无其他物体。只生成一张，完成后结束。",
    });
    turn.submitStatus = response.status;
    turn.acceptMs = Date.now() - startedAt;
    if (response.status !== 200 || typeof response.payload.result?.turn?.id !== "string") {
      if ([400, 401, 403, 404, 409, 422, 429].includes(response.status)) turn.outcome = "rejected";
      else turn.submitUncertain = true;
    } else turn.turnId = response.payload.result.turn.id;
    await save();
    if (turn.outcome === "rejected") return;
    const result = await waitForTurn(config, user, turn.clientRequestId, startedAt);
    turn.turnId ??= result.turnId;
    turn.nativeStatus = result.status;
    let images = [];
    let inventoryObservedMs = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const inventory = await json(config, user, `/api/agent/threads/${encodeURIComponent(user.threadId)}/images`);
      images = inventory.payload.images?.filter((image) => image.turnId === turn.turnId) ?? [];
      if (images.length) {
        inventoryObservedMs = Date.now() - startedAt;
        break;
      }
      await delay(config.pollMs);
    }
    if (result.status !== "completed" || images.length !== 1 || images[0].model !== config.model || images[0].quality !== config.quality) {
      turn.outcome = "quality_or_readback_failed";
      return;
    }
    const outputPath = join(config.outputDirectory, `${config.model}-${config.quality}-${entry.user}-${turn.kind}.${images[0].filename.split(".").at(-1)}`);
    turn.artifact = await downloadImage(config, user, images[0], outputPath);
    turn.firstImageMs = entry.firstImageByTurn?.[turn.turnId] ?? inventoryObservedMs;
    turn.firstImageSource = entry.firstImageByTurn?.[turn.turnId] ? "sse" : "inventory_readback";
    turn.terminalMs = entry.terminalByTurn?.[turn.turnId]?.ms ?? Date.now() - startedAt;
    turn.outcome = "completed_verified";
  } finally {
    if (!await stopSubscription(subscription)) entry.streamError = "stream_shutdown_timeout";
    turn.elapsedMs = Date.now() - startedAt;
    await save();
  }
}

export async function main(mode = process.argv[2], environment = process.env) {
  if (!['run', 'reconcile'].includes(mode)) throw new Error("Use image-model-comparison.mjs run|reconcile.");
  const config = readImageComparisonConfig(environment);
  await mkdir(config.outputDirectory, { recursive: true, mode: 0o700 });
  const allUsers = JSON.parse(await readFile(config.usersFile, "utf8"));
  if (!Array.isArray(allUsers) || allUsers.length !== 100 || allUsers.some((user) => !user.cookie || !user.threadId)) {
    throw new Error("The comparison requires 100 bound production fixture users.");
  }
  const users = allUsers.slice(config.userOffset, config.userOffset + USERS_PER_ROUND);
  const receiptPath = join(config.outputDirectory, `${config.model}-${config.quality}-comparison.json`);
  if (mode === "reconcile") {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    console.log(JSON.stringify({ model: receipt.model, quality: receipt.quality, status: receipt.status, readOnly: true }));
    return receipt;
  }
  const health = await json(config, users[0], "/api/gateway/health");
  if (health.status !== 200 || health.payload.provider?.imageModel !== config.model || health.payload.provider?.imageQuality !== config.quality) {
    throw new Error("Gateway image model/quality does not match this comparison round.");
  }
  const receipt = {
    schemaVersion: 1,
    authorization: AUTHORIZATION,
    model: config.model,
    quality: config.quality,
    agentModel: config.agentModel,
    userOffset: config.userOffset,
    createdAt: new Date().toISOString(),
    status: "started",
    entries: users.map((user, index) => ({
      user: config.userOffset + index,
      threadId: user.threadId,
      generate: { kind: "generate", clientRequestId: randomUUID(), dispatchAttempted: false, outcome: "not_submitted" },
      edit: { kind: "edit", clientRequestId: randomUUID(), dispatchAttempted: false, outcome: "not_submitted", sourceFilename: null },
    })),
  };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
  let writes = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify(receipt, null, 2);
    writes = writes.then(async () => {
      const temporary = `${receiptPath}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, { flag: "wx", mode: 0o600 });
      await rename(temporary, receiptPath);
    });
    return writes;
  };
  await Promise.all(receipt.entries.map((entry, index) => runTurn(config, users[index], entry, entry.generate, save)));
  if (!receipt.entries.every((entry) => entry.generate.outcome === "completed_verified")) {
    receipt.status = "generation_failed_or_uncertain";
    await save();
    throw new Error("Generation phase did not complete; do not start editing or repeat uncertain requests.");
  }
  for (const entry of receipt.entries) entry.edit.sourceFilename = entry.generate.artifact.sourceFilename;
  await save();
  await Promise.all(receipt.entries.map((entry, index) => runTurn(config, users[index], entry, entry.edit, save)));
  const turns = receipt.entries.flatMap((entry) => [entry.generate, entry.edit]);
  const metric = (kind, key) => percentile(receipt.entries.map((entry) => entry[kind][key]).filter(Number.isFinite), 0.95);
  receipt.summary = {
    logicalTurns: turns.length,
    generationCompleted: receipt.entries.filter((entry) => entry.generate.outcome === "completed_verified").length,
    editsCompleted: receipt.entries.filter((entry) => entry.edit.outcome === "completed_verified").length,
    generationAcceptP95Ms: metric("generate", "acceptMs"),
    generationFirstImageP95Ms: metric("generate", "firstImageMs"),
    generationTotalP95Ms: metric("generate", "elapsedMs"),
    editAcceptP95Ms: metric("edit", "acceptMs"),
    editFirstImageP95Ms: metric("edit", "firstImageMs"),
    editTotalP95Ms: metric("edit", "elapsedMs"),
    streamErrors: receipt.entries.filter((entry) => entry.streamError).length,
  };
  receipt.status = turns.every((turn) => turn.outcome === "completed_verified") && receipt.summary.streamErrors === 0 ? "passed" : "failed";
  receipt.completedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ model: receipt.model, quality: receipt.quality, status: receipt.status, ...receipt.summary }));
  if (receipt.status !== "passed") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(JSON.stringify({ failed: true, code: "IMAGE_MODEL_COMPARISON_FAILED", action: "Inspect the private receipt; never repeat an uncertain round." }));
    process.exitCode = 1;
  });
}
