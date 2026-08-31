"use client";

import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  toggleAgentMessageFeedback,
  type AgentMessageFeedbackRating,
} from "@/lib/agent/message-feedback-contract";
import { cn } from "@/lib/utils";

type AssistantMessageActionsProps = {
  messageId: string;
  copyText: string;
  feedback: AgentMessageFeedbackRating | null;
  feedbackSubmitting: boolean;
  retrying: boolean;
  retryDisabled: boolean;
  onFeedback(
    messageId: string,
    rating: AgentMessageFeedbackRating | null,
  ): Promise<boolean>;
  onRetry(messageId: string): Promise<boolean>;
};

export function AssistantMessageActions({
  messageId,
  copyText,
  feedback,
  feedbackSubmitting,
  retrying,
  retryDisabled,
  onFeedback,
  onRetry,
}: AssistantMessageActionsProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [feedbackAcknowledgementId, setFeedbackAcknowledgementId] = useState(0);

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 1_800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  useEffect(() => {
    if (feedbackAcknowledgementId === 0) return;
    const timeout = window.setTimeout(() => setFeedbackAcknowledgementId(0), 2_000);
    return () => window.clearTimeout(timeout);
  }, [feedbackAcknowledgementId]);

  const actionClass =
    "size-7 rounded-[var(--cp-radius-xs)] text-[var(--cp-text-faint)] hover:text-[var(--cp-text-soft)]";

  return (
    <div
      data-assistant-message-actions
      className="mt-2 flex h-7 items-center gap-0.5"
      aria-label="回复操作"
    >
      <ActionTooltip label={copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制回复"}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={actionClass}
          aria-label="复制回复"
          onClick={() => void copyAssistantText(copyText).then(
            () => setCopyState("copied"),
            () => setCopyState("failed"),
          )}
        >
          {copyState === "copied" ? <Check /> : <Copy />}
        </Button>
      </ActionTooltip>
      <ActionTooltip label="回复优秀">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            actionClass,
            feedback === "positive" && "bg-[var(--cp-bg-subtle)] text-[var(--cp-text)]",
          )}
          aria-label="回复优秀"
          aria-pressed={feedback === "positive"}
          disabled={feedbackSubmitting}
          onClick={() => void submitFeedback("positive")}
        >
          <ThumbsUp className={feedback === "positive" ? "fill-current" : undefined} />
        </Button>
      </ActionTooltip>
      <ActionTooltip label="回复不佳">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            actionClass,
            feedback === "negative" && "bg-[var(--cp-bg-subtle)] text-[var(--cp-text)]",
          )}
          aria-label="回复不佳"
          aria-pressed={feedback === "negative"}
          disabled={feedbackSubmitting}
          onClick={() => void submitFeedback("negative")}
        >
          <ThumbsDown className={feedback === "negative" ? "fill-current" : undefined} />
        </Button>
      </ActionTooltip>
      <ActionTooltip label={retrying ? "正在重新尝试" : "重新尝试"}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={actionClass}
          aria-label={retrying ? "正在重新尝试" : "重新尝试"}
          disabled={retryDisabled || retrying}
          onClick={() => void onRetry(messageId)}
        >
          <RefreshCw className={retrying ? "animate-spin" : undefined} aria-hidden="true" />
        </Button>
      </ActionTooltip>
      {feedbackAcknowledgementId > 0 ? (
        <span
          className="ml-1 text-xs text-[var(--cp-text-muted)]"
          role="status"
          aria-live="polite"
        >
          感谢您的反馈！
        </span>
      ) : null}
    </div>
  );

  async function submitFeedback(selected: AgentMessageFeedbackRating): Promise<void> {
    const saved = await onFeedback(
      messageId,
      toggleAgentMessageFeedback(feedback, selected),
    );
    if (saved) {
      setFeedbackAcknowledgementId((current) => current + 1);
    }
  }
}

function ActionTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

async function copyAssistantText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through for browsers that expose Clipboard but deny the current context.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy failed.");
}
