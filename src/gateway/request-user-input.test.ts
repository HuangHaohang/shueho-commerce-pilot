import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRequestUserInputAnswers,
  readPendingRequestUserInput,
  serializePendingRequestUserInput,
} from "./request-user-input.js";

const questions = [
  {
    id: "publication_channel",
    header: "发布渠道",
    question: "这次准备发布到哪里？",
    options: [{ label: "小红书", description: "生活化表达" }],
  },
];

test("accepts a bounded App Server request_user_input server request", () => {
  const pending = readPendingRequestUserInput({
    type: "server_request",
    id: 42,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread_12345678",
      turnId: "turn_12345678",
      itemId: "item-1",
      questions,
      isBlocking: true,
    },
    at: "2026-08-24T00:00:00.000Z",
  });

  assert.ok(pending);
  assert.equal(pending.requestId, "42");
  assert.deepEqual(serializePendingRequestUserInput(pending).questions, questions);
});

test("validates answers against original question ids", () => {
  assert.deepEqual(
    normalizeRequestUserInputAnswers(
      { publication_channel: { answers: ["小红书", "补充：更自然"] } },
      questions,
    ),
    { publication_channel: { answers: ["小红书", "补充：更自然"] } },
  );
  assert.equal(normalizeRequestUserInputAnswers({ other: { answers: ["x"] } }, questions), null);
  assert.equal(normalizeRequestUserInputAnswers({ publication_channel: { answers: [] } }, questions), null);
});

test("rejects malformed or oversized question requests", () => {
  assert.equal(
    readPendingRequestUserInput({
      type: "server_request",
      id: 9,
      method: "item/tool/requestUserInput",
      params: { threadId: "bad", turnId: "turn_12345678", itemId: "item-1", questions },
      at: "2026-08-24T00:00:00.000Z",
    }),
    null,
  );
});
