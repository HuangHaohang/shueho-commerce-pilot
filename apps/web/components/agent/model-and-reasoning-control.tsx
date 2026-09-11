"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatModelName, reasoningEffortOptions, supportsReasoningControl, type ReasoningEffort } from "@/lib/agent/model-presentation";
import { cn } from "@/lib/utils";

type Panel = "quick" | "advanced" | "model" | "effort";

export function ModelAndReasoningControl({ compact = false, models, loading, selectedModel, reasoningEffort,
  open, disabled = false, placement = "bottom", onModelChange, onReasoningEffortChange, onOpenChange,
}: {
  compact?: boolean;
  models: Array<{ id: string; ownedBy: string | null }>;
  loading: boolean;
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  open: boolean;
  disabled?: boolean;
  placement?: "top" | "bottom";
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [panel, setPanel] = useState<Panel>("quick");
  const reasoningSupported = supportsReasoningControl(selectedModel);
  const effortIndex = Math.max(0, reasoningEffortOptions.findIndex((option) => option.value === reasoningEffort));
  const effort = reasoningEffortOptions[effortIndex];
  useEffect(() => { if (disabled && open) onOpenChange(false); }, [disabled, open, onOpenChange]);

  return <Popover open={!disabled && open} onOpenChange={(next) => {
    if (disabled) return;
    if (next) setPanel(reasoningSupported ? "quick" : "model");
    onOpenChange(next);
  }}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} aria-label={disabled ? "任务运行中不可切换模型" : "模型和推理设置"}
        className={cn("flex h-9 items-center rounded-full bg-[var(--cp-bg-subtle)] text-sm text-[var(--cp-text)] hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:opacity-70",
          compact ? "w-9 justify-center p-0" : "max-w-[210px] gap-1.5 px-4 max-sm:w-9 max-sm:justify-center max-sm:p-0")}>
        <Sparkles className={cn("size-4 shrink-0", !compact && "sm:hidden")} strokeWidth={1.8} aria-hidden="true" />
        {!compact ? <span className="truncate font-medium max-sm:hidden">{loading ? "加载模型" : formatModelName(selectedModel)}</span> : null}
        {!compact && reasoningSupported ? <span className="shrink-0 font-medium max-sm:hidden" style={{ color: effort.color }}>{effort.label}</span> : null}
        {!compact ? <ChevronDown className="size-3.5 shrink-0 text-[var(--cp-text-faint)] max-sm:hidden" /> : null}
      </button>
    </PopoverTrigger>
    <PopoverContent side={placement} align="end" collisionPadding={16}
      aria-label="模型和推理设置" data-model-settings
      className="cp-flat-scrollbar max-h-[min(420px,var(--radix-popover-content-available-height))] w-[min(280px,calc(100vw-32px))] overflow-y-auto overscroll-contain p-2">
      {panel === "quick" && reasoningSupported ? <>
        <div className="px-3 py-2">
          <p className="mb-3 text-sm">推理强度：{effort.label}</p>
          <input type="range" min={0} max={reasoningEffortOptions.length - 1} step={1} value={effortIndex}
            aria-label={`推理强度：${effort.label}`} className="cp-reasoning-slider w-full cursor-pointer"
            data-effort={reasoningEffort}
            style={{ "--cp-slider-progress": `${effortIndex / (reasoningEffortOptions.length - 1) * 100}%`, "--cp-slider-color-start": effort.color, "--cp-slider-color-end": effort.gradientEnd } as CSSProperties}
            onChange={(event) => { const value = reasoningEffortOptions[Number(event.target.value)]; if (value) onReasoningEffortChange(value.value); }} />
          {reasoningEffort === "ultra" ? <p className="mt-2 text-xs text-[var(--cp-text-muted)]">更快消耗用量额度</p> : null}
        </div>
        <SettingsRow label="高级" onClick={() => setPanel("advanced")} />
      </> : <>
        <button type="button" className="mb-1 flex h-9 w-full items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)]"
          onClick={() => {
            if (panel === "advanced" && !reasoningSupported) onOpenChange(false);
            else setPanel(panel === "advanced" ? "quick" : "advanced");
          }}>
          <ArrowLeft className="size-4" />{panel === "model" ? "选择模型" : panel === "effort" ? "推理强度" : "高级"}
        </button>
        {panel === "advanced" ? <>
          <SettingsRow label="模型" value={formatModelName(selectedModel)} onClick={() => setPanel("model")} />
          {reasoningSupported ? <SettingsRow label="推理强度" value={effort.label} onClick={() => setPanel("effort")} /> : null}
        </> : null}
        {panel === "model" ? <div role="menu" aria-label="可用模型">
          {models.map((model) => <button key={model.id} type="button" role="menuitemradio" aria-checked={selectedModel === model.id}
            className="flex min-h-11 w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-3 py-2 text-left text-sm hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cp-focus)]"
            onClick={() => { onModelChange(model.id); onOpenChange(false); }}>
            <span className="min-w-0 flex-1"><span className="block break-words">{formatModelName(model.id)}</span>
              {model.ownedBy ? <span className="block text-xs text-[var(--cp-text-faint)]">{model.ownedBy}</span> : null}</span>
            {selectedModel === model.id ? <Check className="size-4 shrink-0" /> : null}
          </button>)}
          {!models.length ? <p className="px-3 py-2 text-sm text-[var(--cp-text-muted)]">{loading ? "正在加载模型" : "模型列表不可用"}</p> : null}
        </div> : null}
        {panel === "effort" && reasoningSupported ? <div role="menu" aria-label="推理强度选项">
          {reasoningEffortOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === reasoningEffort}
            className="flex h-10 w-full items-center justify-between rounded-[var(--cp-radius-item)] px-3 text-sm hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cp-focus)]"
            onClick={() => { onReasoningEffortChange(option.value); onOpenChange(false); }}>
            <span style={{ color: option.color }}>{option.label}</span>{option.value === reasoningEffort ? <Check className="size-4" /> : null}
          </button>)}
        </div> : null}
      </>}
    </PopoverContent>
  </Popover>;
}

function SettingsRow({ label, value, onClick }: { label: string; value?: string; onClick: () => void }) {
  return <button type="button" className="flex min-h-10 w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-sm hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cp-focus)]" onClick={onClick}>
    <span className="shrink-0">{label}</span><span className="min-w-0 flex-1 truncate text-right text-[var(--cp-text-muted)]">{value}</span><ChevronRight className="size-4 shrink-0" />
  </button>;
}
