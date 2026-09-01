import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
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

  assert.deepEqual(await store.deleteForThreads(["thread-12345678"]), { files: 1, metadata: 1 });
  await assert.rejects(store.readImage(first.filename), /ENOENT/);
  assert.equal((await store.listForThread("thread-87654321")).length, 1);
});

test("builds owned localImage inputs and preserves image-edit lineage", async () => {
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
  assert.equal(inputs[0]?.type, "localImage");
  assert.match(inputs[0]?.path ?? "", new RegExp(`${source.filename.replace(".", "\\.")}$`));
  await assert.rejects(
    store.buildTurnInputs("thread-87654321", [source.filename]),
    /does not belong to this thread/,
  );
});
