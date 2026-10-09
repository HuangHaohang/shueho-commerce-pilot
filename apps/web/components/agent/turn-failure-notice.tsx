"use client";

import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TurnFailureNotice({ error, canContinue, continuing, onContinue }: {
  error: string | null;
  canContinue: boolean;
  continuing: boolean;
  onContinue: () => Promise<boolean>;
}) {
  if (!error && !canContinue && !continuing) return null;
  return (
    <div className="mt-6 rounded-[var(--cp-radius-item)] bg-[var(--cp-danger-bg)] px-4 py-3 text-sm text-[var(--cp-danger)]" role="alert">
      <p className="break-words">{error || "本次任务未完成，已有任务记录仍保留。"}</p>
      {canContinue || continuing ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" disabled={continuing} onClick={() => void onContinue()}>
            {continuing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
            {continuing ? "正在核对任务状态" : "继续任务"}
          </Button>
          <span className="text-xs text-[var(--cp-text-muted)]">沿用已有记录，继续处理未完成的部分</span>
        </div>
      ) : null}
    </div>
  );
}
