"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { SkillInventoryItem } from "@/lib/agent/skills";
import { cn } from "@/lib/utils";
import { SkillPreviewMotion } from "./SkillPreviewMotion";

export function SkillPreviewDialog({ skill, onClose, onUse }: {
  skill: SkillInventoryItem | null;
  onClose: () => void;
  onUse: (skill: SkillInventoryItem) => void;
}) {
  return <Dialog open={Boolean(skill)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {skill ? <DialogContent data-skill-detail className="max-h-[88dvh] max-w-[640px] overflow-y-auto">
      <SkillPreviewBody key={skill.name} skill={skill} onUse={onUse} />
    </DialogContent> : null}
  </Dialog>;
}

function SkillPreviewBody({ skill, onUse }: { skill: SkillInventoryItem; onUse: (skill: SkillInventoryItem) => void }) {
  const [exampleIndex, setExampleIndex] = useState(0);
  const presentation = skill.presentation;
  const examples = presentation?.preview_examples ?? [];
  const example = examples[exampleIndex];
  return <article>
    {presentation ? <div className="skill-demo-frame h-[min(42dvh,440px)] w-full overflow-hidden bg-[var(--cp-bg-subtle)]">
      <SkillPreviewMotion src={presentation.preview_url} title={skill.displayName}
        examples={example ? [example] : examples} layout={presentation.preview_layout} />
    </div> : null}
    <div className="p-5 sm:p-6">
      {examples.length > 1 ? <div className="mb-4 flex flex-wrap gap-2" aria-label="切换示例">
        {examples.map((item, index) => <button type="button" key={item.url} aria-pressed={exampleIndex === index}
          className={cn("rounded-full border border-[var(--cp-border)] px-3 py-1 text-xs hover:bg-[var(--cp-bg-subtle)]", exampleIndex === index && "bg-[var(--cp-bg-muted)]")}
          onClick={() => setExampleIndex(index)}>{item.title}</button>)}
      </div> : null}
      <DialogTitle className="pr-6 text-xl">{skill.displayName}</DialogTitle>
      <DialogDescription className="mt-2 text-sm">{presentation?.summary ?? skill.description}</DialogDescription>
      {presentation ? <div className="mt-5 border-t border-[var(--cp-border)] pt-4">
        <p className="text-xs text-[var(--cp-text-faint)]">创作素材</p>
        <p className="mt-1 text-sm">{presentation.required_assets}</p>
      </div> : null}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--cp-text-muted)]">{presentation ? "效果示例 · 以你的素材展开创作" : "选择技能后输入你的任务"}</p>
        <button type="button" disabled={!skill.enabled} onClick={() => onUse(skill)}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--cp-text)] px-4 text-sm text-[var(--cp-text-inverse)] disabled:opacity-40">
          使用此 Skill <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  </article>;
}
