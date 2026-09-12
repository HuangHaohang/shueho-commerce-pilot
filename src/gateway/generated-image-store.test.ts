import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GeneratedImageStore } from "./generated-image-store.js";

test("deletes generated image files and metadata for one thread without touching another", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "commerce-generated-images-"));
  const store = new GeneratedImageStore(codexHome);
  const first = await store.save({
    base64: Buffer.from("first").toString("base64"),
    threadId: "thread-12345678",
    turnId: "turn-12345678",
    callId: "image-item-12345678",
    model: "gpt-image-2",
    mimeType: "image/png",
    quality: "auto",
    size: "1024x1024",
  });
  assert.equal(
    (await store.findByCallId("thread-12345678", "turn-12345678", "image-item-12345678"))?.filename,
    first.filename,
  );
  const duplicate = await store.saveOnceForCall({
    base64: Buffer.from("replacement").toString("base64"),
    threadId: "thread-12345678",
    turnId: "turn-12345678",
    callId: "image-item-12345678",
    model: "gpt-image-2",
    mimeType: "image/png",
    quality: null,
    size: null,
  });
  assert.equal(duplicate.filename, first.filename);
  await store.save({
    base64: Buffer.from("second").toString("base64"),
    threadId: "thread-87654321",
    turnId: "turn-87654321",
    callId: null,
    model: "gpt-image-2",
    mimeType: "image/png",
    quality: "auto",
    size: "1024x1024",
  });
  const nativeDirectory = join(codexHome, "generated_images", "thread-12345678");
  await mkdir(nativeDirectory, { recursive: true });
  await writeFile(join(nativeDirectory, "native-image.png"), "native");

  assert.deepEqual(await store.deleteForThreads(["thread-12345678"]), { files: 1, metadata: 1 });
  await assert.rejects(store.readImage(first.filename), /ENOENT/);
  await assert.rejects(stat(nativeDirectory), /ENOENT/);
  assert.equal((await store.listForThread("thread-87654321")).length, 1);
});

test("builds owned in-memory image inputs and preserves image-edit lineage", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "commerce-generated-image-edit-"));
  const store = new GeneratedImageStore(codexHome);
  const source = await store.save({
    base64: Buffer.from("source").toString("base64"),
    threadId: "thread-12345678",
    turnId: "turn-12345678",
    callId: "image-item-source",
    model: "gpt-image-2",
    mimeType: "image/png",
    quality: null,
    size: null,
  });
  const edited = await store.save({
    base64: Buffer.from("edited").toString("base64"),
    threadId: "thread-12345678",
    turnId: "turn-87654321",
    callId: "image-item-edited",
    model: "gpt-image-2",
    mimeType: "image/png",
    quality: null,
    size: null,
    sourceFilenames: [source.filename],
  });

  assert.deepEqual((await store.get(edited.filename))?.sourceFilenames, [source.filename]);
  const inputs = await store.buildTurnInputs("thread-12345678", [source.filename]);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.type, "image");
  assert.equal(inputs[0]?.url, `data:image/png;base64,${Buffer.from("source").toString("base64")}`);
  await assert.rejects(
    store.buildTurnInputs("thread-87654321", [source.filename]),
    /does not belong to this thread/,
  );
});

test("inventory cache observes another store's writes and deletes without sharing mutable state", async () => {
  const home = await mkdtemp(join(tmpdir(), "commerce-image-cache-"));
  const first = new GeneratedImageStore(home), second = new GeneratedImageStore(home);
  const input = { base64: Buffer.from("image").toString("base64"), threadId: "thread-cache123", turnId: "turn-cache123", callId: "call-cache123", model: "gpt-image-2", mimeType: "image/png" as const, quality: null, size: null };
  await first.save(input);
  const views = await Promise.all(Array.from({ length: 30 }, () => first.listForThread(input.threadId)));
  assert.ok(views.every((view) => view.length === 1));
  views[0]![0]!.sourceFilenames.push("modified");
  assert.deepEqual((await first.listForThread(input.threadId))[0]!.sourceFilenames, []);
  await second.save({ ...input, callId: "call-next123" });
  assert.equal((await first.listForThread(input.threadId)).length, 2);
  await second.deleteForThreads([input.threadId]);
  assert.deepEqual(await first.listForThread(input.threadId), []);
});

test("concurrent native artifact persistence deduplicates one call and preserves independent calls", async () => {
  const store = new GeneratedImageStore(await mkdtemp(join(tmpdir(), "commerce-image-concurrency-")));
  const input = { base64: Buffer.from("image").toString("base64"), threadId: "thread-concurrent", turnId: "turn-concurrent", callId: "call-concurrent", model: "gpt-image-2", mimeType: "image/png" as const, quality: null, size: null };
  const same = await Promise.all(Array.from({ length: 30 }, () => store.saveOnceForCall(input)));
  assert.equal(new Set(same.map((image) => image.filename)).size, 1);
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.saveOnceForCall({ ...input, callId: `call-independent-${i}` })));
  assert.equal((await store.listForThread(input.threadId)).length, 11);
});

test("an in-flight copy id cannot be reused for a different source", async () => {
  const store = new GeneratedImageStore(await mkdtemp(join(tmpdir(), "commerce-copy-conflict-")));
  const input = { base64: "AA==", threadId: "thread-copy123", turnId: "turn-copy123", callId: null, model: "image", mimeType: "image/png" as const, quality: null, size: null };
  const a = await store.save(input), b = await store.save(input);
  const first = store.copyImage(a.filename, input.threadId, "request-copy123");
  await assert.rejects(store.copyImage(b.filename, input.threadId, "request-copy123"), /conflicts/);
  assert.equal((await first).copyOf, a.filename);
  assert.equal((await store.copyImage(a.filename, input.threadId, "request-copy123")).copyOf, a.filename);
});
