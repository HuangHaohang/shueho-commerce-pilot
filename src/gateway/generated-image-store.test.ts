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
    callId: null,
    model: "gpt-image-2",
    mimeType: "image/png",
    quality: "auto",
    size: "1024x1024",
  });
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
