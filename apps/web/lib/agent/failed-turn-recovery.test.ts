import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTINUE_FAILED_TASK_MESSAGE, continueFailedTask, presentRuntimeError } from "./failed-turn-recovery";

describe("failed Turn continuation", () => {
  afterEach(() => vi.unstubAllGlobals());

  function readback(status: string, lastTurnId = "failed-turn") {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      thread: { id: "thread-1", lastTurnId, status },
    })));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("reads the authoritative terminal status before one explicit continuation, without replaying history", async () => {
    const fetchMock = readback("failed");
    const submit = vi.fn().mockResolvedValue(true);
    expect(await continueFailedTask({ threadId: "thread-1", turnId: "failed-turn", isCurrent: () => true, submit })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/threads/thread-1/status", expect.objectContaining({ method: "GET" }));
    expect(submit).toHaveBeenCalledExactlyOnceWith(CONTINUE_FAILED_TASK_MESSAGE);
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[0]);
  });

  it.each(["running", "completed", "interrupted", "idle"])("never continues a %s Turn based on a stale browser failure", async (status) => {
    readback(status);
    const submit = vi.fn();
    await expect(continueFailedTask({ threadId: "thread-1", turnId: "failed-turn", isCurrent: () => true, submit })).rejects.toThrow("任务状态已变化");
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not continue a newer failed Turn or a different thread", async () => {
    readback("failed", "newer-turn");
    const submit = vi.fn();
    await expect(continueFailedTask({ threadId: "thread-1", turnId: "failed-turn", isCurrent: () => true, submit })).rejects.toThrow();
    readback("failed");
    await expect(continueFailedTask({ threadId: "other-thread", turnId: "failed-turn", isCurrent: () => true, submit })).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });

  it("cancels continuation if navigation or another submission occurred during readback", async () => {
    readback("failed");
    const submit = vi.fn();
    expect(await continueFailedTask({ threadId: "thread-1", turnId: "failed-turn", isCurrent: () => false, submit })).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([503, 401, 403])("does not submit when status readback returns %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    const submit = vi.fn();
    await expect(continueFailedTask({ threadId: "thread-1", turnId: "failed-turn", isCurrent: () => true, submit })).rejects.toThrow("无法核对");
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not retry an ambiguous continuation submission", async () => {
    readback("failed");
    const submit = vi.fn().mockRejectedValue(new Error("response lost"));
    await expect(continueFailedTask({ threadId: "thread-1", turnId: "failed-turn", isCurrent: () => true, submit })).rejects.toThrow("response lost");
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("runtime failure presentation", () => {
  it("explains a truncated provider stream without claiming it timed out", () => {
    const text = presentRuntimeError("stream disconnected before completion: stream closed before response.completed");
    expect(text).toContain("模型响应中途断开");
    expect(text).not.toContain("超时");
  });
  it("distinguishes an idle timeout and does not mislabel every 524 as an image failure", () => {
    expect(presentRuntimeError("stream idle timeout")).toContain("长时间未返回数据");
    expect(presentRuntimeError("524")).not.toContain("图片");
    expect(presentRuntimeError(null)).toBeNull();
  });
});
