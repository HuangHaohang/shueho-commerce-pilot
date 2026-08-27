import { describe, expect, it } from "vitest";

import {
  isEndedRequestUserInputResponse,
  reconcileActivityStatus,
  REQUEST_USER_INPUT_ENDED_CODE,
  terminalTurnMessage,
} from "./request-user-input-lifecycle";

describe("request user input lifecycle", () => {
  it("recognizes an ended native question as terminal instead of retryable waiting", () => {
    expect(isEndedRequestUserInputResponse(410, null)).toBe(true);
    expect(isEndedRequestUserInputResponse(404, { code: REQUEST_USER_INPUT_ENDED_CODE })).toBe(true);
    expect(isEndedRequestUserInputResponse(503, null)).toBe(false);
  });

  it("maps authoritative interrupted and failed turns to visible terminal messages", () => {
    expect(terminalTurnMessage("interrupted")).toContain("未完成的提问或工具请求已经失效");
    expect(terminalTurnMessage("failed")).toContain("执行失败");
    expect(terminalTurnMessage("completed")).toBeNull();
  });

  it("fails orphaned in-progress activities when the authoritative turn is terminal", () => {
    expect(reconcileActivityStatus("inProgress", true)).toBe("running");
    expect(reconcileActivityStatus("inProgress", false)).toBe("failed");
  });
});
