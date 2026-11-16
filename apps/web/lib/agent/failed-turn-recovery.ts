import { readAgentJson } from "./agent-read";

// This is an explicit user follow-up, not replay of the failed Turn. Keep the
// original tool results and native request_user_input answers in Harness history.
export const CONTINUE_FAILED_TASK_MESSAGE =
  "请从刚才中断的位置继续任务，沿用已有选择和已取得的结果。先核对未完成操作的状态；不要重复已完成或结果不确定的付费查询、图片生成及写入操作，无法核实时先说明情况。";

export async function continueFailedTask(input: {
  threadId: string;
  turnId: string;
  isCurrent: () => boolean;
  submit: (message: string) => Promise<boolean>;
}): Promise<boolean> {
  const response = await readAgentJson<{
    thread?: { id?: string; lastTurnId?: string | null; status?: string };
  }>(`/api/agent/threads/${encodeURIComponent(input.threadId)}/status`);
  if (!input.isCurrent()) return false;
  if (!response.ok || !response.payload?.thread) {
    throw new Error("暂时无法核对任务状态，请稍后再继续。");
  }
  const thread = response.payload.thread;
  if (thread.id !== input.threadId || thread.lastTurnId !== input.turnId || thread.status !== "failed") {
    throw new Error("任务状态已变化，请重新打开任务查看最新进度。");
  }
  return input.submit(CONTINUE_FAILED_TASK_MESSAGE);
}

export function presentRuntimeError(error: string | null): string | null {
  if (!error) return null;
  if (/stream disconnected before completion|stream closed before response\.completed/i.test(error)) {
    return "模型响应中途断开，本次回答未完成。已有任务记录仍保留。";
  }
  if (/idle timeout|timed out waiting for (?:sse|response)|stream.*timed out/i.test(error)) {
    return "模型服务长时间未返回数据，本次回答未完成。已有任务记录仍保留。";
  }
  if (/\b524\b/.test(error)) return "上游服务响应超时（524），请等待任务状态确认。";
  if (/<!doctype\s+html|<html[\s>]/i.test(error)) return "上游服务暂时不可用，请稍后再试。";
  return error;
}
