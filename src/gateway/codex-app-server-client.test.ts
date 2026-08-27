import assert from "node:assert/strict";
import test from "node:test";

import { CodexAppServerClient } from "../codex/app-server-client.js";

type AppServerClientTestAccess = {
  handleStdoutLine(line: string): void;
};

test("removes a server request when App Server emits serverRequest/resolved", () => {
  const client = new CodexAppServerClient({
    codexBin: "unused",
    cwd: process.cwd(),
  });
  const testAccess = client as unknown as AppServerClientTestAccess;

  testAccess.handleStdoutLine(JSON.stringify({
    id: 17,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread_12345678",
      turnId: "turn_12345678",
      itemId: "item-1",
      questions: [],
      isBlocking: true,
    },
  }));
  assert.equal(client.listPendingServerRequests().length, 1);

  testAccess.handleStdoutLine(JSON.stringify({
    method: "serverRequest/resolved",
    params: { threadId: "thread_12345678", requestId: 17 },
  }));
  assert.deepEqual(client.listPendingServerRequests(), []);
});

test("drops a cancelled dynamic-tool request when its Harness turn completes", () => {
  const client = new CodexAppServerClient({
    codexBin: "unused",
    cwd: process.cwd(),
  });
  const testAccess = client as unknown as AppServerClientTestAccess;

  testAccess.handleStdoutLine(JSON.stringify({
    id: "dynamic-9",
    method: "item/tool/call",
    params: {
      threadId: "thread_12345678",
      turnId: "turn_12345678",
      callId: "call_12345678",
      namespace: "commerce_data",
      tool: "research_social_content",
      arguments: {},
    },
  }));
  assert.equal(client.listPendingServerRequests().length, 1);

  testAccess.handleStdoutLine(JSON.stringify({
    method: "turn/completed",
    params: {
      threadId: "thread_12345678",
      turn: { id: "turn_12345678", status: "interrupted" },
    },
  }));
  assert.deepEqual(client.listPendingServerRequests(), []);
});
