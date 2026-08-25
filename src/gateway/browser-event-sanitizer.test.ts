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
