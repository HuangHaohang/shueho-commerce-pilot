"use client";

import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  CircleStop,
  Clapperboard,
  FileText,
  FolderKanban,
  LoaderCircle,
  Megaphone,
  MessageSquareText,
  PanelsTopLeft,
  Plus,
  ShoppingBag,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  AgentThreadSummary,
  ConversationMessage,
  GeneratedImageItem,
} from "@/lib/agent/use-agent-thread";
import { CreativeCanvasNavigationProvider } from "@/lib/creative/creative-canvas-navigation";
import {
  creativeMethodLabel,
  creativeMethodOptions,
  type CreativeMethod,
} from "@/lib/creative/creative-method-contract";
import {
  creativeMethodGroupLabels,
  creativeMethodPresentation,
  type CreativeMethodGroupId,
} from "@/lib/creative/creative-method-presentation";
import { cn } from "@/lib/utils";

import { CreativeInfiniteCanvas } from "./creative-infinite-canvas";

export type CreativeSpaceWorkbenchProps = {
  projects: readonly AgentThreadSummary[];
  activeProjectId: string | null;
  messages: readonly ConversationMessage[];
  images: readonly GeneratedImageItem[];
  conversation: ReactNode;
  navigationDisabled?: boolean;
  onCreateProject: () => void;
  onSelectProject: (project: AgentThreadSummary) => void;
  onBackToWorkbench: () => void;
};

type CreativeMobileView = "projects" | "canvas" | "conversation";

const creativeMobileViews = [
  { value: "projects", label: "项目", icon: FolderKanban },
  { value: "canvas", label: "画布", icon: PanelsTopLeft },
  { value: "conversation", label: "对话", icon: MessageSquareText },
] as const satisfies ReadonlyArray<{
  value: CreativeMobileView;
  label: string;
  icon: typeof FolderKanban;
}>;

export function CreativeSpaceWorkbench({
  projects,
  activeProjectId,
  messages,
  images,
  conversation,
  navigationDisabled = false,
  onCreateProject,
  onSelectProject,
  onBackToWorkbench,
}: CreativeSpaceWorkbenchProps) {
  const [mobileView, setMobileView] = useState<CreativeMobileView>("conversation");

  return (
    <CreativeCanvasNavigationProvider key={activeProjectId ?? "new-creative-project"}>
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--cp-bg)] xl:grid xl:grid-cols-[var(--cp-sidebar-width)_minmax(0,1fr)_minmax(360px,430px)] xl:grid-rows-1">
        <CreativeMobileNavigation
          value={mobileView}
          onChange={setMobileView}
          onBackToWorkbench={onBackToWorkbench}
          disabled={navigationDisabled}
        />
        <CreativeProjectSidebar
          projects={projects}
          activeProjectId={activeProjectId}
          navigationDisabled={navigationDisabled}
          mobileVisible={mobileView === "projects"}
          onCreateProject={() => {
            setMobileView("conversation");
            onCreateProject();
          }}
          onSelectProject={(project) => {
            setMobileView("conversation");
            onSelectProject(project);
          }}
          onBackToWorkbench={onBackToWorkbench}
        />
        <CreativeInfiniteCanvas
          threadId={activeProjectId}
          messages={messages}
          images={images}
          running={projects.some((project) => project.threadId === activeProjectId && project.status === "running")}
          mobileVisible={mobileView === "canvas"}
        />
        <aside
          data-creative-conversation
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-[var(--cp-border)] bg-[var(--cp-bg)] xl:flex xl:border-l xl:border-t-0",
            mobileView === "conversation" ? "flex" : "hidden",
          )}
          aria-label="项目对话"
        >
          {conversation}
        </aside>
      </div>
    </CreativeCanvasNavigationProvider>
  );
}

function CreativeMobileNavigation({
  value,
  onChange,
  onBackToWorkbench,
  disabled,
}: {
  value: CreativeMobileView;
  onChange: (view: CreativeMobileView) => void;
  onBackToWorkbench: () => void;
  disabled: boolean;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--cp-border)] bg-[var(--cp-sidebar)] px-2 xl:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="rounded-full"
        aria-label="返回主工作台"
        disabled={disabled}
        onClick={onBackToWorkbench}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      <div
        className="grid min-w-0 flex-1 grid-cols-3 rounded-[var(--cp-radius-segment)] bg-[var(--cp-bg-muted)] p-0.5"
        role="tablist"
        aria-label="创作空间视图"
      >
        {creativeMobileViews.map((view) => (
          <button
            key={view.value}
            type="button"
            role="tab"
            aria-selected={value === view.value}
            className={cn(
              "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[var(--cp-radius-control)] px-2 text-xs text-[var(--cp-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
              value === view.value && "bg-[var(--cp-surface)] font-medium text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]",
            )}
            onClick={() => onChange(view.value)}
          >
            <view.icon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{view.label}</span>
          </button>
        ))}
      </div>
    </header>
  );
}

export function CreativeMethodPicker({
  value,
  disabled = false,
  onSelect,
}: {
  value: CreativeMethod | null;
  disabled?: boolean;
  onSelect: (method: CreativeMethod) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-w-[148px] rounded-full px-3"
          aria-label={value ? `创作类型：${creativeMethodLabel(value)}` : "选择创作类型"}
          aria-expanded={open}
          disabled={disabled}
        >
          <PanelsTopLeft aria-hidden="true" />
          <span className="truncate">{value ? creativeMethodLabel(value) : "创作类型"}</span>
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="max-h-[min(620px,var(--radix-popover-content-available-height))] overflow-y-auto p-2"
        style={{ width: "min(360px, var(--radix-popover-content-available-width))" }}
        role="dialog"
        aria-label="选择创作类型"
      >
        <CreativeMethodPickerPanel
          value={value}
          onSelect={(method) => {
            onSelect(method);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function CreativeMethodPickerPanel({
  value,
  onSelect,
}: {
  value: CreativeMethod | null;
  onSelect: (method: CreativeMethod) => void;
}) {
  const groupIcons: Record<CreativeMethodGroupId, typeof ShoppingBag> = {
    listing: ShoppingBag,
    promotion: Megaphone,
    video: Clapperboard,
  };
  const groups = Object.keys(creativeMethodGroupLabels) as CreativeMethodGroupId[];

  return (
    <>
      <div className="px-2 pb-1 pt-1">
        <h2 className="m-0 text-sm font-semibold text-[var(--cp-text)]">创作类型</h2>
      </div>
      {groups.map((group) => {
        const GroupIcon = groupIcons[group];
        const options = creativeMethodOptions.filter(
          (option) => creativeMethodPresentation[option.value].group === group,
        );
        return (
          <section key={group} className="border-t border-[var(--cp-border-subtle)] py-2" aria-labelledby={`creative-method-${group}`}>
            <h3
              id={`creative-method-${group}`}
              className="m-0 flex items-center gap-1.5 px-2 pb-1 text-[11px] font-medium text-[var(--cp-text-faint)]"
            >
              <GroupIcon className="size-3.5" aria-hidden="true" />
              {creativeMethodGroupLabels[group]}
            </h3>
            <div className="space-y-0.5">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "w-full rounded-[var(--cp-radius-item)] px-2.5 py-2 text-left hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                    value === option.value && "bg-[var(--cp-surface-active)]",
                  )}
                  aria-pressed={value === option.value}
                  onClick={() => onSelect(option.value)}
                >
                  <span className="block text-[13px] font-medium leading-5 text-[var(--cp-text)]">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[var(--cp-text-muted)]">{option.shortDescription}</span>
                </button>
              ))}
              {group === "video" ? (
                <button
                  type="button"
                  className="w-full rounded-[var(--cp-radius-item)] px-2.5 py-2 text-left"
                  disabled
                  aria-describedby="creative-video-render-disabled"
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-medium leading-5 text-[var(--cp-text-faint)]">
                    <Video className="size-3.5" aria-hidden="true" />
                    视频成片
                  </span>
                  <span id="creative-video-render-disabled" className="mt-0.5 block text-[11px] leading-4 text-[var(--cp-text-faint)]">
                    当前可生成脚本与分镜，暂不渲染成片
                  </span>
                </button>
              ) : null}
            </div>
          </section>
        );
      })}
    </>
  );
}

export function CreativeProjectSidebar({
  projects,
  activeProjectId,
  navigationDisabled = false,
  mobileVisible = false,
  onCreateProject,
  onSelectProject,
  onBackToWorkbench,
}: Pick<
  CreativeSpaceWorkbenchProps,
  | "projects"
  | "activeProjectId"
  | "navigationDisabled"
  | "onCreateProject"
  | "onSelectProject"
  | "onBackToWorkbench"
> & { mobileVisible?: boolean }) {
  return (
    <aside
      className={cn(
        "min-h-0 min-w-0 flex-1 shrink-0 flex-col border-b border-[var(--cp-border)] bg-[var(--cp-sidebar)] xl:flex xl:border-b-0 xl:border-r",
        mobileVisible ? "flex" : "hidden",
      )}
    >
      <div className="shrink-0 px-3 pb-3 pt-3">
        <button
          type="button"
          className="hidden h-9 w-full items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-left text-sm text-[var(--cp-text-muted)] transition-colors hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:pointer-events-none disabled:opacity-45 xl:flex"
          disabled={navigationDisabled}
          onClick={onBackToWorkbench}
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          <span>主工作台</span>
        </button>
        <div className="mt-1 flex items-center justify-between gap-2 px-2 xl:mt-4">
          <h1 className="m-0 min-w-0 truncate text-sm font-semibold">创作项目</h1>
          <span className="shrink-0 text-xs tabular-nums text-[var(--cp-text-faint)]">
            {projects.length}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 w-full justify-start"
          disabled={navigationDisabled}
          onClick={onCreateProject}
        >
          <Plus aria-hidden="true" />
          新建项目
        </Button>
      </div>

      <nav
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3"
        aria-label="创作项目"
      >
        {projects.length > 0 ? (
          <ul className="m-0 list-none space-y-1 p-0">
            {projects.map((project) => {
              const active = project.threadId === activeProjectId;
              return (
                <li key={project.threadId}>
                  <button
                    type="button"
                    className={cn(
                      "flex min-h-10 w-full min-w-0 items-center gap-2 rounded-[var(--cp-radius-item)] px-2.5 py-2 text-left text-sm text-[var(--cp-text-soft)] transition-colors hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:pointer-events-none disabled:opacity-45",
                      active && "bg-[var(--cp-surface-active)] text-[var(--cp-text)]",
                    )}
                    aria-current={active ? "page" : undefined}
                    disabled={navigationDisabled}
                    onClick={() => onSelectProject(project)}
                  >
                    <FileText className="size-4 shrink-0 text-[var(--cp-text-faint)]" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{project.title || "未命名项目"}</span>
                    <ProjectStatus status={project.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 px-2.5 py-2 text-xs text-[var(--cp-text-faint)]">还没有创作项目</p>
        )}
      </nav>
    </aside>
  );
}

function ProjectStatus({ status }: { status: AgentThreadSummary["status"] }) {
  if (status === "running") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-[var(--cp-text-muted)]" title="正在运行">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        <span className="sr-only">正在运行</span>
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-[var(--cp-danger)]" title="运行失败">
        <AlertCircle className="size-3.5" aria-hidden="true" />
        <span className="sr-only">运行失败</span>
      </span>
    );
  }
  if (status === "interrupted") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-[var(--cp-text-faint)]" title="已停止">
        <CircleStop className="size-3.5" aria-hidden="true" />
        <span className="sr-only">已停止</span>
      </span>
    );
  }
  return null;
}
