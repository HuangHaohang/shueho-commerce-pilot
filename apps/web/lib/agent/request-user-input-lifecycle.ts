export const REQUEST_USER_INPUT_ENDED_CODE = "REQUEST_USER_INPUT_ENDED";

export function isEndedRequestUserInputResponse(
  status: number,
  payload: Record<string, unknown> | null,
): boolean {
  return status === 410 ||
    ((status === 404 || status === 409) && payload?.code === REQUEST_USER_INPUT_ENDED_CODE);
}

export function terminalTurnMessage(
  status: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed",
): string | null {
  if (status === "interrupted") {
    return "当前任务已中断，未完成的提问或工具请求已经失效。请重新发送任务。";
  }
  if (status === "failed") {
    return "当前任务执行失败，待回答请求已经失效。请重新发送任务。";
  }
  return null;
}

export function reconcileActivityStatus(
  itemStatus: unknown,
  turnRunning: boolean,
): "running" | "completed" | "failed" {
  if (itemStatus === "failed") return "failed";
  if (itemStatus === "inProgress") return turnRunning ? "running" : "failed";
  return "completed";
}
