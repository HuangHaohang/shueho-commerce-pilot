import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import ExcelJS from "exceljs";

import { MAX_THREAD_ATTACHMENT_BYTES, ThreadArtifactStore } from "./thread-artifact-store.js";

const threadId = "thread-attachment-1234";
const clientRequestId = "client-request-1234";
const scope = {
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  rootThreadId: threadId,
  parentThreadId: null,
  model: "model-1",
};

test("stores tenant-bound text and image attachments and creates native turn inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-attachments-"));
  const store = new ThreadArtifactStore(directory);
  try {
    const document = await store.save({
      threadId,
      scope,
      clientRequestId,
      originalName: "notes.txt",
      declaredMimeType: "text/plain",
      bytes: Buffer.from("商品名称：轻量通勤双肩包"),
    });
    const image = await store.save({
      threadId,
      scope,
      clientRequestId,
      originalName: "pixel.png",
      declaredMimeType: "image/png",
      bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"),
    });
    const inputs = await store.buildTurnInputs(threadId, [document.id, image.id], scope, clientRequestId);
    assert.equal(inputs[0]?.type, "text");
    assert.match(String(inputs[0]?.text), /轻量通勤双肩包/);
    assert.equal(inputs[1]?.type, "localImage");
    assert.match(String(inputs[1]?.path), /thread_artifacts/);
    await store.bindToTurn(threadId, [document.id, image.id], "turn-attachment-1234");
    assert.equal((await store.get(threadId, image.id))?.turnId, "turn-attachment-1234");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects attachment access across principals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-attachments-"));
  const store = new ThreadArtifactStore(directory);
  try {
    const artifact = await store.save({
      threadId,
      scope,
      clientRequestId,
      originalName: "notes.txt",
      declaredMimeType: "text/plain",
      bytes: Buffer.from("tenant owned"),
    });
    await assert.rejects(
      store.buildTurnInputs(
        threadId,
        [artifact.id],
        { ...scope, tenantId: "tenant-2" },
        clientRequestId,
      ),
      /ownership|binding/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("extracts bounded workbook text with the supported dependency set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-attachments-"));
  const store = new ThreadArtifactStore(directory);
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("商品");
    sheet.addRow(["SKU", "卖点"]);
    sheet.addRow(["BAG-001", "轻量通勤"]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const artifact = await store.save({
      threadId,
      scope,
      clientRequestId,
      originalName: "products.xlsx",
      declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    });
    const inputs = await store.buildTurnInputs(threadId, [artifact.id], scope, clientRequestId);
    assert.match(String(inputs[0]?.text), /BAG-001\t轻量通勤/);
    assert.equal(MAX_THREAD_ATTACHMENT_BYTES, 5 * 1024 * 1024);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
