"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpenCheck,
  ChevronRight,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type SkillInventoryItem = {
  name: string;
  description: string;
  enabled: boolean;
  scope: string;
  displayName: string;
  shortDescription: string;
  dependencyCount: number;
  creator: boolean;
  applicationManaged: boolean;
};

type SkillInventoryResponse = {
  skills: SkillInventoryItem[];
  errors: string[];
};

export function SkillsDirectory() {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const skillsQuery = useQuery({
    queryKey: ["codex-skills"],
    queryFn: getSkills,
    retry: 1,
    staleTime: 10_000,
  });
  const skills = useMemo(
    () =>
      [...(skillsQuery.data?.skills ?? [])].sort((left, right) => {
        if (left.creator !== right.creator) return left.creator ? -1 : 1;
        if (left.applicationManaged !== right.applicationManaged) return left.applicationManaged ? -1 : 1;
        return left.displayName.localeCompare(right.displayName, "zh-CN");
      }),
    [skillsQuery.data?.skills],
  );
  const selected = skills.find((skill) => skill.name === selectedName) ?? null;

  if (selected) {
    return <SkillDetail skill={selected} onBack={() => setSelectedName(null)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--cp-bg)] pt-14 md:pt-0">
      <div className="hidden h-[var(--cp-topbar-height)] shrink-0 items-center justify-center md:flex">
        <span className="text-sm font-medium">技能</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[920px] px-5 pb-20 pt-10 md:px-8 md:pt-14">
          <div>
            <h1 className="m-0 text-[28px] font-semibold leading-tight">技能</h1>
            <p className="mb-0 mt-2 max-w-[620px] text-sm leading-6 text-[var(--cp-text-muted)]">
              技能定义 Agent 完成任务的方法；插件负责分发技能、连接器和受控界面。
            </p>
          </div>

          {skillsQuery.isLoading ? <SkillsSkeleton /> : null}
          {skillsQuery.isError ? (
            <div className="mt-10 border-y border-[var(--cp-border)] py-8 text-sm text-[var(--cp-danger)]">
              无法读取 App Server 技能目录。
            </div>
          ) : null}
          {skillsQuery.data ? (
            <section className="mt-10" aria-labelledby="available-skills-title">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 id="available-skills-title" className="m-0 text-sm font-semibold">全局可用</h2>
                <span className="text-xs text-[var(--cp-text-faint)]">{skills.filter((skill) => skill.enabled).length} 个已启用</span>
              </div>
              <div className="border-y border-[var(--cp-border)]">
                {skills.map((skill) => (
                  <button
                    key={`${skill.scope}:${skill.name}`}
                    type="button"
                    className="grid min-h-[72px] w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--cp-border-subtle)] px-1 py-3 text-left last:border-b-0 hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cp-focus)]"
                    onClick={() => setSelectedName(skill.name)}
                  >
                    <SkillIcon skill={skill} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-[var(--cp-text)]">{skill.displayName}</span>
                        {skill.creator ? (
                          <span className="rounded-[var(--cp-radius-segment)] bg-[var(--cp-bg-muted)] px-2 py-0.5 text-[10px] text-[var(--cp-text-muted)]">
                            系统
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block truncate text-xs leading-5 text-[var(--cp-text-muted)]">
                        {skill.shortDescription || skill.description}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 pl-3">
                      <span className={cn("text-xs", skill.enabled ? "text-[var(--cp-success)]" : "text-[var(--cp-text-faint)]")}>
                        {skill.enabled ? "已启用" : "已停用"}
                      </span>
                      <ChevronRight className="size-4 text-[var(--cp-text-faint)]" strokeWidth={1.8} />
                    </span>
                  </button>
                ))}
              </div>
              {skillsQuery.data.errors.length ? (
                <p className="mt-4 text-xs text-[var(--cp-warning)]">部分技能目录读取失败，请刷新后重试。</p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SkillDetail({ skill, onBack }: { skill: SkillInventoryItem; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--cp-bg)] pt-14 md:pt-0">
      <div className="hidden h-[var(--cp-topbar-height)] shrink-0 items-center px-6 md:flex">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-surface-hover)]"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" strokeWidth={1.8} />
          技能
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <article className="mx-auto w-full max-w-[760px] px-5 pb-20 pt-10 md:px-8 md:pt-14">
          <button
            type="button"
            className="mb-8 inline-flex h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-surface-hover)] md:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} />
            技能
          </button>
          <header className="flex items-start gap-4">
            <SkillIcon skill={skill} large />
            <div className="min-w-0">
              <h1 className="m-0 text-[28px] font-semibold leading-tight">{skill.displayName}</h1>
              <p className="mb-0 mt-2 text-sm leading-6 text-[var(--cp-text-muted)]">{skill.description}</p>
            </div>
          </header>
          <dl className="mb-0 mt-10 border-y border-[var(--cp-border)]">
            <SkillInfo label="标识" value={skill.name} />
            <SkillInfo label="状态" value={skill.enabled ? "已启用" : "已停用"} />
            <SkillInfo label="范围" value={scopeLabel(skill.scope)} />
            <SkillInfo label="依赖" value={skill.dependencyCount ? `${skill.dependencyCount} 个工具依赖` : "无外部工具依赖"} />
            <SkillInfo label="来源" value={skill.applicationManaged ? "Commerce Pilot 托管" : skill.creator ? "Codex 系统技能" : "Codex 技能目录"} last />
          </dl>
          <div className="mt-7 flex items-start gap-2 text-xs leading-5 text-[var(--cp-text-faint)]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
            <span>
              {skill.creator
                ? "创建技能本身由 Skill Creator Skill 指导。发布到托管运行时仍需经过应用校验，不能写入任意宿主路径。"
                : "技能只提供工作方法，不会自动扩大工具、网络、文件或外部写入权限。"}
            </span>
          </div>
        </article>
      </div>
    </div>
  );
}

function SkillIcon({ skill, large = false }: { skill: SkillInventoryItem; large?: boolean }) {
  const Icon = skill.creator ? WandSparkles : skill.applicationManaged ? Sparkles : BookOpenCheck;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)]",
        large ? "size-12" : "size-11",
        skill.creator
          ? "bg-[#f2edff] text-[#6750a4]"
          : skill.applicationManaged
            ? "bg-[#edf6f2] text-[#216c58]"
            : "bg-[var(--cp-bg-muted)] text-[var(--cp-text-soft)]",
      )}
      aria-hidden="true"
    >
      <Icon className={large ? "size-6" : "size-5"} strokeWidth={1.8} />
    </span>
  );
}

function SkillInfo({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={cn("grid min-h-12 grid-cols-[88px_minmax(0,1fr)] items-center gap-5 border-b border-[var(--cp-border-subtle)] py-2 text-sm", last && "border-b-0")}>
      <dt className="text-[var(--cp-text-faint)]">{label}</dt>
      <dd className="m-0 break-words text-[var(--cp-text-soft)]">{value}</dd>
    </div>
  );
}

function SkillsSkeleton() {
  return (
    <div className="mt-10 border-y border-[var(--cp-border)]" aria-label="正在读取技能">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex min-h-[72px] items-center gap-3 border-b border-[var(--cp-border-subtle)] px-1 py-3 last:border-b-0">
          <div className="size-11 animate-pulse rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)]" />
          <div className="flex-1">
            <div className="h-3 w-28 animate-pulse rounded bg-[var(--cp-bg-muted)]" />
            <div className="mt-2 h-3 w-64 max-w-full animate-pulse rounded bg-[var(--cp-bg-muted)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function getSkills(): Promise<SkillInventoryResponse> {
  const response = await fetch("/api/skills", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as SkillInventoryResponse | { error?: string } | null;
  if (!response.ok || !payload || !("skills" in payload)) {
    throw new Error(payload && "error" in payload ? payload.error : "Skills unavailable.");
  }
  return payload;
}

function scopeLabel(scope: string): string {
  if (scope === "system") return "Codex 系统";
  if (scope === "admin") return "管理员";
  if (scope === "repo") return "当前 Commerce Pilot";
  if (scope === "user") return "当前用户";
  return "运行时";
}
