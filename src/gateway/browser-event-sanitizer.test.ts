import assert from "node:assert/strict";
import test from "node:test";

import type { AppServerEvent } from "../codex/protocol.js";
import { sanitizeBrowserAppServerEvent } from "./browser-event-sanitizer.js";

test("removes tenant artifact paths and extracted attachment context from browser events", () => {
  const event = {
    type: "notification",
    method: "item/completed",
    params: {
      threadId: "thread-12345678",
      item: {
        id: "item-12345678",
        type: "userMessage",
        content: [
          { type: "text", text: "[附件：photo.png、notes.txt]\n请总结附件" },
          { type: "localImage", path: "/srv/codex/thread_artifacts/thread-123/photo.png" },
          { type: "text", text: "<commerce_attachment_context name=\"notes.txt\">secret extracted text</commerce_attachment_context>" },
        ],
      },
    },
    at: new Date().toISOString(),
  } as AppServerEvent;

  const sanitized = sanitizeBrowserAppServerEvent(event);
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /\/srv\/codex|secret extracted text/);
  assert.match(serialized, /请总结附件/);
  assert.match(serialized, /"type":"localImage"/);
});

test("removes native image bytes and host paths from browser events", () => {
  const event = {
    type: "notification",
    method: "item/completed",
    params: {
      threadId: "thread-12345678",
      turnId: "turn-12345678",
      item: {
        type: "imageGeneration",
        id: "image-12345678",
        status: "completed",
        revisedPrompt: "商品主图",
        result: "very-large-base64",
        savedPath: "/srv/codex/generated_images/private.png",
        failure: null,
      },
    },
    at: new Date().toISOString(),
  } as AppServerEvent;

  const serialized = JSON.stringify(sanitizeBrowserAppServerEvent(event));
  assert.doesNotMatch(serialized, /very-large-base64|\/srv\/codex/);
  assert.match(serialized, /imageGeneration/);
});
