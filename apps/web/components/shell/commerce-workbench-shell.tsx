"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Ellipsis,
  Eye,
  EyeOff,
  ExternalLink,
  FilePlus2,
  HelpCircle,
  ImageIcon,
  Library,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Mic,
  Palette,
  PanelLeft,
  Paperclip,
  Phone,
  Plug,
  Plus,
  Search,
  SendHorizontal,
  Share2,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Store,
  Square,
  Telescope,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useAgentThread,
  type AgentActivity,
  type AgentThreadSummary,
  type ConversationMessage,
  type GeneratedImageItem,
} from "@/lib/agent/use-agent-thread";
import { cn } from "@/lib/utils";

type WorkMode = "chat" | "work";
type AuthMode = "login" | "register";
type AuthIdentifierType = "email" | "phone";

type AuthUser = {
  id: string;
  name: string;
  email: string | null;
  phoneNumber: string | null;
  displayIdentifier: string;
};

type AuthSessionResponse = {
  user: AuthUser | null;
};

type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

type ProviderModelSummary = {
  id: string;
  ownedBy: string | null;
  kind: "agent" | "image" | "other";
  isConfiguredImageModel: boolean;
};

type ProviderModelsResponse = {
  agentModels: ProviderModelSummary[];
  imageModels: ProviderModelSummary[];
  configuredImageModel: string;
};

type AgentThreadsResponse = {
  threads: AgentThreadSummary[];
};

type GatewayHealthResponse = {
  ok: boolean;
  status: number;
  latencyMs: number;
  gateway: string | null;
  instanceId: string | null;
  codex: {
    running?: boolean;
    initialized?: boolean;
    pendingServerRequests?: number;
  } | null;
  runtimePolicy: {
    maxTurnDurationMs?: number;
  } | null;
  error?: string;
};

const primaryNavItems = [
  { label: "新任务", icon: SquarePen, active: true },
  { label: "市场调研", icon: Telescope, active: false },
  { label: "创作空间", icon: Palette, active: false },
  { label: "资料库", icon: Library, active: false },
];

const moreNavItems = [
  { label: "已安排", icon: Clock3, active: false },
  { label: "插件", icon: Plug, active: false },
];

const reasoningEffortOptions: Array<{
  value: ReasoningEffort;
  label: string;
  color: string;
  gradientEnd: string;
}> = [
  { value: "low", label: "轻度", color: "#8f8f8f", gradientEnd: "#8f8f8f" },
  { value: "medium", label: "中", color: "#10a37f", gradientEnd: "#10a37f" },
  { value: "high", label: "高", color: "#1687e8", gradientEnd: "#1687e8" },
  { value: "xhigh", label: "极高", color: "#4f66d8", gradientEnd: "#5c55d8" },
  { value: "max", label: "最高", color: "#6f4bd8", gradientEnd: "#8c4cdb" },
  { value: "ultra", label: "超高", color: "#4f46c8", gradientEnd: "#c64dde" },
];

export function CommerceWorkbenchShell() {
  const [mode, setMode] = useState<WorkMode>("work");
  const [draft, setDraft] = useState("");
  const [submittedDraft, setSubmittedDraft] = useState<string | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthMode>("login");
  const [selectedModel, setSelectedModel] = useState("gpt-5.6-sol");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("low");
  const autoRestoreAttemptedRef = useRef(false);

  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: getAuthSession,
    retry: false,
    staleTime: 30_000,
  });
  const authUser = sessionQuery.data?.user ?? null;
  const isAuthenticated = Boolean(authUser);

  const modelsQuery = useQuery({
    queryKey: ["provider-models"],
    queryFn: getProviderModels,
    enabled: isAuthenticated,
    retry: 1,
    staleTime: 60_000,
  });

  const threadsQuery = useQuery({
    queryKey: ["agent-threads", authUser?.id],
    queryFn: getAgentThreads,
    enabled: isAuthenticated,
    retry: 1,
    staleTime: 10_000,
    refetchInterval: (query) =>
      query.state.data?.threads.some((thread) => thread.status === "running") ? 3_000 : false,
  });

  useEffect(() => {
    const models = modelsQuery.data?.agentModels;
    if (models?.length && !models.some((model) => model.id === selectedModel)) {
      setSelectedModel(models[0].id);
    }
  }, [modelsQuery.data, selectedModel]);

  const healthQuery = useQuery({
    queryKey: ["gateway-health"],
    queryFn: getGatewayHealth,
    refetchInterval: 12_000,
  });

  const runtimeStatus = useMemo(() => getRuntimeStatus(healthQuery.data, healthQuery.isLoading), [
    healthQuery.data,
    healthQuery.isLoading,
  ]);

  const agentThread = useAgentThread({
    model: selectedModel,
    effort: supportsReasoningControl(selectedModel) ? reasoningEffort : undefined,
    runtimeHealth: healthQuery.data
      ? {
          available:
            healthQuery.data.ok === true &&
            healthQuery.data.codex?.running === true &&
            healthQuery.data.codex?.initialized === true,
          observedAt: healthQuery.dataUpdatedAt,
          instanceId: healthQuery.data.instanceId,
          maxTurnDurationMs: healthQuery.data.runtimePolicy?.maxTurnDurationMs ?? 600_000,
        }
      : null,
  });
  const hasActiveThread = Boolean(agentThread.threadId || agentThread.messages.length);
  const navigationLocked = agentThread.status === "connecting" && !agentThread.threadId;

  useEffect(() => {
    if (!isAuthenticated) {
      autoRestoreAttemptedRef.current = false;
      return;
    }
    if (!threadsQuery.isSuccess || autoRestoreAttemptedRef.current) {
      return;
    }
    autoRestoreAttemptedRef.current = true;
    const latestThread = threadsQuery.data?.threads[0];
    if (!agentThread.threadId && latestThread) {
      void agentThread.loadThread(latestThread);
    }
  }, [agentThread.loadThread, agentThread.threadId, isAuthenticated, threadsQuery.data, threadsQuery.isSuccess]);

  useEffect(() => {
    if (agentThread.threadId) {
      void threadsQuery.refetch();
    }
  }, [agentThread.status, agentThread.threadId]);

  async function submitDraft() {
    const value = draft.trim();
    if (!value) {
      return;
    }
    setDraft("");
    if (isAuthenticated) {
      await agentThread.submit(value);
    } else {
      setSubmittedDraft(value);
    }
  }

  function openAuthDialog(authMode: AuthMode) {
    setAuthDialogMode(authMode);
    setAuthDialogOpen(true);
  }

  async function logout() {
    await fetch("/api/account/logout", { method: "POST" });
    await sessionQuery.refetch();
  }

  function startNewTask() {
    if (navigationLocked) {
      return;
    }
    setDraft("");
    setSubmittedDraft(null);
    agentThread.resetThread();
    void threadsQuery.refetch();
  }

  function openStoredThread(thread: AgentThreadSummary) {
    if (navigationLocked || thread.threadId === agentThread.threadId) {
      return;
    }
    setDraft("");
    void agentThread.loadThread(thread);
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--cp-bg)] text-[var(--cp-text)]">
      <Sidebar
        user={authUser}
        threads={threadsQuery.data?.threads ?? []}
        activeThreadId={agentThread.threadId}
        navigationLocked={navigationLocked}
        onNewTask={startNewTask}
        onOpenThread={openStoredThread}
        onOpenAuth={() => openAuthDialog("login")}
        onLogout={logout}
      />

      <main className="relative flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <MobileTopbar user={authUser} onOpenAuth={() => openAuthDialog("login")} onLogout={logout} />

        <div className="pointer-events-none sticky top-0 z-20 hidden h-[var(--cp-topbar-height)] items-center justify-center bg-[rgba(255,255,255,0.92)] md:flex">
          {isAuthenticated && !hasActiveThread ? <ModeSwitch mode={mode} onModeChange={setMode} /> : null}
          {isAuthenticated && hasActiveThread ? <ConversationTopActions /> : null}
          {!isAuthenticated ? (
            <TopAuthActions
              onOpenLogin={() => openAuthDialog("login")}
              onOpenRegister={() => openAuthDialog("register")}
            />
          ) : null}
        </div>

        {isAuthenticated && hasActiveThread ? (
          <ConversationWorkspace
            title={agentThread.threadTitle || "新任务"}
            messages={agentThread.messages}
            activities={agentThread.activities}
            images={agentThread.images}
            status={agentThread.status}
            currentTurnId={agentThread.currentTurnId}
            canInterrupt={Boolean(agentThread.activeTurnId)}
            interrupting={agentThread.interrupting}
            durationMs={agentThread.durationMs}
            startedAt={agentThread.startedAt}
            error={agentThread.error}
            value={draft}
            models={modelsQuery.data?.agentModels ?? []}
            modelsLoading={modelsQuery.isLoading}
            selectedModel={selectedModel}
            reasoningEffort={reasoningEffort}
            onChange={setDraft}
            onSubmit={submitDraft}
            onInterrupt={agentThread.interrupt}
            onModelChange={setSelectedModel}
            onReasoningEffortChange={setReasoningEffort}
          />
        ) : (
        <section
          className={cn(
            "flex flex-1 flex-col items-center px-4 md:px-8",
            isAuthenticated
              ? "pb-12 pt-28 md:pt-[21vh]"
              : "justify-center pb-16 pt-20 md:pb-20 md:pt-20",
          )}
        >
          <div className="flex w-full max-w-[var(--cp-content-max)] flex-col items-center">
            <h1
              className={cn(
                "text-center text-[24px] font-semibold leading-tight tracking-[0] text-[var(--cp-text)] md:text-[26px]",
                isAuthenticated ? "mb-8" : "mb-5 font-normal",
              )}
            >
              {isAuthenticated ? "我们该做什么？" : "我们先从哪里开始呢？"}
            </h1>

            {isAuthenticated ? (
              <WorkComposer
                mode={mode}
                value={draft}
                submittedDraft={submittedDraft}
                runtimeStatus={runtimeStatus}
                models={modelsQuery.data?.agentModels ?? []}
                modelsLoading={modelsQuery.isLoading}
                selectedModel={selectedModel}
                reasoningEffort={reasoningEffort}
                onChange={setDraft}
                onSubmit={submitDraft}
                onModelChange={setSelectedModel}
                onReasoningEffortChange={setReasoningEffort}
              />
            ) : (
              <GuestComposer
                value={draft}
                onChange={setDraft}
                onSubmit={submitDraft}
                onUseSuggestion={() => setDraft("你能做什么？")}
              />
            )}
          </div>
        </section>
        )}

        {!hasActiveThread ? <ComplianceFooter /> : null}
      </main>

      {authDialogOpen ? (
        <AuthDialog
          initialMode={authDialogMode}
          onClose={() => setAuthDialogOpen(false)}
          onAuthenticated={async () => {
            await sessionQuery.refetch();
            setAuthDialogOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ComplianceFooter() {
  return (
    <footer className="shrink-0 px-4 pb-2 pt-4 md:px-8 md:pb-3" aria-label="法律与 AI 使用说明">
      <p className="mx-auto m-0 max-w-[820px] text-center text-[11px] leading-5 text-[var(--cp-text-faint)]">
        Commerce Pilot 是 AI。使用即表示你同意我们的
        <Link className="mx-0.5 underline underline-offset-2 hover:text-[var(--cp-text-muted)]" href="/terms">
          条款
        </Link>
        和
        <Link className="mx-0.5 underline underline-offset-2 hover:text-[var(--cp-text-muted)]" href="/privacy">
          隐私政策
        </Link>
        。聊天内容可能会被审核，并用于改进我们的 AI 模型。
        <Link className="ml-0.5 underline underline-offset-2 hover:text-[var(--cp-text-muted)]" href="/ai-notice">
          了解更多
        </Link>
      </p>
    </footer>
  );
}

function ConversationTopActions() {
  return (
    <div className="pointer-events-auto absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1">
      <IconTooltip label="分享">
        <Button type="button" variant="ghost" size="icon" aria-label="分享">
          <Share2 />
        </Button>
      </IconTooltip>
      <IconTooltip label="更多操作">
        <Button type="button" variant="ghost" size="icon" aria-label="更多操作">
          <Ellipsis />
        </Button>
      </IconTooltip>
      <IconTooltip label="会话设置">
        <Button type="button" variant="ghost" size="icon" aria-label="会话设置">
          <SlidersHorizontal />
        </Button>
      </IconTooltip>
    </div>
  );
}

function ConversationWorkspace({
  title,
  messages,
  activities,
  images,
  status,
  currentTurnId,
  canInterrupt,
  interrupting,
  durationMs,
  startedAt,
  error,
  value,
  models,
  modelsLoading,
  selectedModel,
  reasoningEffort,
  onChange,
  onSubmit,
  onInterrupt,
  onModelChange,
  onReasoningEffortChange,
}: {
  title: string;
  messages: ConversationMessage[];
  activities: AgentActivity[];
  images: GeneratedImageItem[];
  status: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed";
  currentTurnId: string | null;
  canInterrupt: boolean;
  interrupting: boolean;
  durationMs: number | null;
  startedAt: number | null;
  error: string | null;
  value: string;
  models: ProviderModelSummary[];
  modelsLoading: boolean;
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldFollowBottomRef = useRef(true);
  const scrollingToBottomRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [conversationInputExpanded, setConversationInputExpanded] = useState(false);
  const running = status === "connecting" || status === "running";
  const latestUserSequence = messages.reduce(
    (latestSequence, message) => (message.role === "user" ? Math.max(latestSequence, message.sequence) : latestSequence),
    -1,
  );
  const visibleMessages = messages
    .filter((message) => {
      if (message.role === "user" || message.phase === "final_answer") {
        return true;
      }
      if (message.phase === "commentary") {
        return running && Boolean(currentTurnId) && message.turnId === currentTurnId;
      }
      return message.turnId !== currentTurnId || running || status === "completed";
    })
    .sort((left, right) => left.sequence - right.sequence);
  const messagesBeforeStatus = visibleMessages.filter((message) => message.sequence <= latestUserSequence);
  const messagesAfterStatus = visibleMessages.filter((message) => message.sequence > latestUserSequence);
  const currentActivities = currentTurnId
    ? activities.filter((activity) => activity.turnId === currentTurnId)
    : [];
  const latestCurrentActivity = currentActivities.reduce<AgentActivity | null>(
    (latest, activity) => (!latest || activity.sequence > latest.sequence ? activity : latest),
    null,
  );
  const activeTimeline = [
    ...messagesAfterStatus.map((message) => ({ type: "message" as const, sequence: message.sequence, message })),
    ...(running && latestCurrentActivity
      ? [{ type: "activity" as const, sequence: latestCurrentActivity.sequence, activity: latestCurrentActivity }]
      : []),
  ].sort((left, right) => left.sequence - right.sequence);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    if (shouldFollowBottomRef.current) {
      node.scrollTop = node.scrollHeight;
      setShowScrollToBottom(false);
      return;
    }
    setShowScrollToBottom(getDistanceFromBottom(node) > 80);
  }, [activities, images, messages, status]);

  useEffect(() => {
    if (conversationInputRef.current) {
      const inputHeight = resizeTextarea(conversationInputRef.current, 32, 120);
      setConversationInputExpanded(inputHeight > 32);
    }
  }, [value]);

  function handleConversationScroll() {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    const isNearBottom = getDistanceFromBottom(node) <= 80;
    if (scrollingToBottomRef.current) {
      if (isNearBottom) {
        scrollingToBottomRef.current = false;
        shouldFollowBottomRef.current = true;
        setShowScrollToBottom(false);
      }
      return;
    }
    shouldFollowBottomRef.current = isNearBottom;
    setShowScrollToBottom(!isNearBottom);
  }

  function scrollConversationToBottom() {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    scrollingToBottomRef.current = true;
    shouldFollowBottomRef.current = true;
    setShowScrollToBottom(false);
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }

  return (
    <section data-agent-status={status} className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        data-conversation-scroll
        className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 pb-8 md:px-8"
        onScroll={handleConversationScroll}
      >
        <div className="mx-auto w-full max-w-[820px] pb-12 pt-2 xl:pr-[72px]">
          <h1 className="sr-only">{title}</h1>

          <div className="space-y-6">
            {messagesBeforeStatus.map((message) => (
              <ConversationMessageView key={message.id} message={message} />
            ))}
            <ProcessingStatus
              running={running}
              durationMs={durationMs}
              startedAt={startedAt}
            />
            {activeTimeline.length > 0 ? (
              <div className="space-y-4">
                {activeTimeline.map((entry) =>
                  entry.type === "message" ? (
                    <ConversationMessageView key={entry.message.id} message={entry.message} />
                  ) : (
                    <ActivityRow key="current-turn-activity" activity={entry.activity} />
                  ),
                )}
              </div>
            ) : null}
          </div>

          {!running && currentActivities.length > 0 ? (
            <ActivityDisclosure key={currentTurnId} activities={currentActivities} />
          ) : null}

          {images.length > 0 ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {images.map((image) => (
                <figure key={image.id} className="m-0 overflow-hidden rounded-[var(--cp-radius-item)] border border-[var(--cp-border)] bg-[var(--cp-bg-subtle)]">
                  {/* Generated provider images have dynamic dimensions and are served by an authenticated route. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="AI 生成内容" className="block aspect-square w-full object-cover" />
                  <figcaption className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--cp-text-muted)]">
                    <ImageIcon className="size-3.5" />
                    <span className="truncate">{image.model}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-[var(--cp-radius-item)] bg-[var(--cp-danger-bg)] px-4 py-3 text-sm text-[var(--cp-danger)]" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <WorkOutputPanel images={images} />

      <div className="relative shrink-0 bg-[var(--cp-bg)] px-4 pb-3 pt-2 md:px-8">
        {showScrollToBottom ? (
          <div className="absolute -top-10 left-1/2 z-30 -translate-x-1/2">
            <IconTooltip label="回到底部">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9 rounded-full border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-[var(--cp-shadow-popover)] hover:bg-[var(--cp-bg-subtle)]"
                aria-label="回到底部"
                onClick={scrollConversationToBottom}
              >
                {running ? (
                  <span className="cp-scroll-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <ArrowDown className="size-4" aria-hidden="true" />
                )}
              </Button>
            </IconTooltip>
          </div>
        ) : null}
        <p className="mx-auto mb-3 max-w-[768px] text-center text-[11px] text-[var(--cp-text-faint)]">
          Commerce Pilot 也可能会犯错。请核查重要信息。
        </p>
        <form
          className={cn(
            "mx-auto grid w-full max-w-[768px] grid-cols-[auto_minmax(0,1fr)_auto] gap-x-1 rounded-[28px] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-2 py-2 shadow-[var(--cp-shadow-composer)] transition-[height,border-radius] duration-[var(--cp-duration-base)]",
            conversationInputExpanded
              ? "max-h-[180px] grid-rows-[auto_36px] items-end gap-y-1"
              : "min-h-[56px] items-center",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            if (!running) {
              void onSubmit();
            }
          }}
        >
          <IconTooltip label="添加内容">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("rounded-full", conversationInputExpanded && "col-start-1 row-start-2")}
              aria-label="添加内容"
            >
              <Plus className="size-5" />
            </Button>
          </IconTooltip>
          <textarea
            ref={conversationInputRef}
            data-conversation-input
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229 &&
                !running
              ) {
                event.preventDefault();
                if (value.trim()) {
                  void onSubmit();
                }
              }
            }}
            placeholder="继续追问"
            className={cn(
              "cp-composer-textarea min-h-8 max-h-[120px] min-w-0 resize-none overflow-y-hidden border-0 bg-transparent px-2 py-1.5 text-[14px] leading-5 text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)]",
              conversationInputExpanded
                ? "col-span-3 col-start-1 row-start-1 w-full px-3"
                : "col-start-2 row-start-1 w-full",
            )}
            aria-label="继续追问"
          />
          <div
            className={cn(
              "flex items-center gap-1",
              conversationInputExpanded ? "col-start-3 row-start-2" : "col-start-3 row-start-1",
            )}
          >
            <ModelAndReasoningControl
              models={models}
              loading={modelsLoading}
              selectedModel={selectedModel}
              reasoningEffort={reasoningEffort}
              disabled={running}
              placement="top"
              onModelChange={onModelChange}
              onReasoningEffortChange={onReasoningEffortChange}
            />
            <IconTooltip label="语音输入">
              <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="语音输入">
                <Mic />
              </Button>
            </IconTooltip>
            {running && canInterrupt ? (
              <IconTooltip label="停止">
                <Button
                  type="button"
                  size="icon"
                  className="rounded-full"
                  aria-label="停止"
                  disabled={interrupting}
                  onClick={onInterrupt}
                >
                  {interrupting ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-3.5 fill-current" />}
                </Button>
              </IconTooltip>
            ) : running ? (
              <IconTooltip label="正在启动任务">
                <Button type="button" size="icon" className="rounded-full" aria-label="正在启动任务" disabled>
                  <Loader2 className="size-4 animate-spin" />
                </Button>
              </IconTooltip>
            ) : (
              <IconTooltip label="发送">
                <Button type="submit" size="icon" className="rounded-full" aria-label="发送" disabled={!value.trim()}>
                  <ArrowUp />
                </Button>
              </IconTooltip>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

function getDistanceFromBottom(node: HTMLDivElement): number {
  return Math.max(0, node.scrollHeight - node.scrollTop - node.clientHeight);
}

function resizeTextarea(node: HTMLTextAreaElement, minHeight: number, maxHeight: number): number {
  node.style.height = "0px";
  const nextHeight = Math.min(Math.max(node.scrollHeight, minHeight), maxHeight);
  node.style.height = `${nextHeight}px`;
  node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  return nextHeight;
}

function ConversationMessageView({ message }: { message: ConversationMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-[18px] bg-[var(--cp-text)] px-4 py-2.5 text-sm leading-6 text-[var(--cp-text-inverse)]">
          {message.content}
        </div>
      </div>
    );
  }

  if (!message.content) {
    return null;
  }

  return (
    <div
      className={cn(
        "text-[14px] leading-6 text-[var(--cp-text-soft)]",
        message.phase === "commentary" && "text-sm text-[var(--cp-text-muted)]",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-4 mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-4 list-disc space-y-2 pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="my-4 list-decimal space-y-2 pl-6">{children}</ol>,
          code: ({ children }) => (
            <code className="rounded-[var(--cp-radius-xs)] bg-[var(--cp-bg-muted)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--cp-text)]">
              {children}
            </code>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {children}
            </a>
          ),
        }}
      >
        {message.content}
      </ReactMarkdown>
    </div>
  );
}

function ActivityRow({ activity }: { activity: AgentActivity }) {
  const running = activity.status === "running";
  return (
    <div
      data-agent-activity
      data-activity-status={activity.status}
      className="flex min-h-8 items-center gap-2 py-1 text-[13px] text-[var(--cp-text-faint)]"
    >
      {activity.status === "failed" ? (
        <CircleAlert className="size-4 shrink-0 text-[var(--cp-danger)]" />
      ) : null}
      <span className={cn("flex min-w-0 items-center gap-2 overflow-hidden", running && "cp-activity-shimmer")}>
        <span className="shrink-0">{activity.label}</span>
        {activity.detail ? <code className="min-w-0 truncate font-mono text-[11px]">{activity.detail}</code> : null}
      </span>
      {activity.durationMs ? (
        <span className="ml-auto shrink-0 text-[11px]">{formatCompactDuration(activity.durationMs)}</span>
      ) : null}
    </div>
  );
}

function ActivityDisclosure({ activities }: { activities: AgentActivity[] }) {
  const [expanded, setExpanded] = useState(false);
  const running = activities.some((activity) => activity.status === "running");
  const summary = summarizeActivities(activities, running);

  return (
    <div className="mt-4">
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 py-1.5 text-left text-[13px] text-[var(--cp-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className={running ? "cp-thinking-shimmer" : undefined}>{summary}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-[var(--cp-text-faint)] transition-transform duration-[var(--cp-duration-fast)]",
            expanded && "rotate-180",
          )}
          strokeWidth={1.8}
        />
      </button>

      {expanded ? (
        <div className="ml-7 mt-1 space-y-1">
          {activities.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function summarizeActivities(activities: AgentActivity[], running: boolean): string {
  const kinds = new Set(activities.map((activity) => activity.kind));
  if (running) {
    if (activities.some((activity) => activity.kind === "image" && activity.status === "running")) {
      return "正在生成图片";
    }
    if (activities.some((activity) => activity.kind === "file" && activity.status === "running")) {
      return "正在编辑文件";
    }
    if (activities.some((activity) => activity.kind === "command" && activity.status === "running")) {
      return "正在运行命令";
    }
    return "正在调用工具";
  }
  if (kinds.has("file") && kinds.has("command")) {
    return "编辑了文件并运行了命令";
  }
  if (kinds.has("file")) {
    return "编辑了文件";
  }
  if (kinds.has("command")) {
    return "运行了命令";
  }
  if (kinds.has("image")) {
    return "生成了图片";
  }
  if (kinds.has("search")) {
    return "完成了搜索";
  }
  return "调用了工具";
}

function ProcessingStatus({
  running,
  durationMs,
  startedAt,
}: {
  running: boolean;
  durationMs: number | null;
  startedAt: number | null;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (!running && durationMs === null) {
    return null;
  }
  const elapsed = durationMs ?? (startedAt ? now - startedAt : 0);
  return (
    <div className="min-h-5 text-sm text-[var(--cp-text-muted)]" aria-live="polite">
      {running ? (
        <span className="cp-thinking-shimmer">正在处理 {formatDuration(elapsed)}</span>
      ) : (
        `已处理 ${formatDuration(elapsed)}`
      )}
    </div>
  );
}

function WorkOutputPanel({ images }: { images: GeneratedImageItem[] }) {
  return (
    <aside className="absolute right-6 top-2 hidden w-[300px] rounded-[var(--cp-radius-popover)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-5 shadow-[var(--cp-shadow-soft)] 2xl:block">
      <div className="text-sm text-[var(--cp-text-muted)]">输出内容</div>
      {images.length ? (
        <div className="mt-3 space-y-2">
          {images.map((image) => (
            <a key={image.id} href={image.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-[var(--cp-text-soft)] hover:underline">
              <ImageIcon className="size-4" />
              <span className="truncate">{image.filename}</span>
            </a>
          ))}
        </div>
      ) : (
        <button type="button" className="mt-3 flex items-center gap-2 text-sm text-[var(--cp-text-faint)]">
          <FilePlus2 className="size-4" />
          创建文件或图片
        </button>
      )}
      <div className="my-4 h-px bg-[var(--cp-border-subtle)]" />
      <div className="text-sm text-[var(--cp-text-muted)]">来源</div>
      <button type="button" className="mt-3 flex items-center gap-2 text-sm text-[var(--cp-text-faint)]">
        <Plus className="size-4" />
        添加来源
      </button>
    </aside>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

function formatCompactDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function Sidebar({
  user,
  threads,
  activeThreadId,
  navigationLocked,
  onNewTask,
  onOpenThread,
  onOpenAuth,
  onLogout,
}: {
  user: AuthUser | null;
  threads: AgentThreadSummary[];
  activeThreadId: string | null;
  navigationLocked: boolean;
  onNewTask: () => void;
  onOpenThread: (thread: AgentThreadSummary) => void;
  onOpenAuth: () => void;
  onLogout: () => Promise<void>;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuPosition, setMoreMenuPosition] = useState({ left: 0, top: 0 });
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) {
      return;
    }

    function closeMoreMenu(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !moreButtonRef.current?.contains(target) &&
        !moreMenuRef.current?.contains(target)
      ) {
        setMoreOpen(false);
      }
    }

    function closeMoreMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMoreOpen(false);
      }
    }

    function positionMoreMenu() {
      const button = moreButtonRef.current;
      if (!button) {
        return;
      }
      const rect = button.getBoundingClientRect();
      const menuWidth = 252;
      const menuHeight = 104;
      setMoreMenuPosition({
        left: Math.min(rect.right + 10, window.innerWidth - menuWidth - 8),
        top: Math.min(rect.top, window.innerHeight - menuHeight - 8),
      });
    }

    document.addEventListener("pointerdown", closeMoreMenu);
    window.addEventListener("keydown", closeMoreMenuOnEscape);
    window.addEventListener("resize", positionMoreMenu);
    window.addEventListener("scroll", positionMoreMenu, true);
    return () => {
      document.removeEventListener("pointerdown", closeMoreMenu);
      window.removeEventListener("keydown", closeMoreMenuOnEscape);
      window.removeEventListener("resize", positionMoreMenu);
      window.removeEventListener("scroll", positionMoreMenu, true);
    };
  }, [moreOpen]);

  function toggleMoreMenu() {
    if (moreOpen) {
      setMoreOpen(false);
      return;
    }
    const rect = moreButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 252;
      const menuHeight = 104;
      setMoreMenuPosition({
        left: Math.min(rect.right + 10, window.innerWidth - menuWidth - 8),
        top: Math.min(rect.top, window.innerHeight - menuHeight - 8),
      });
    }
    setMoreOpen(true);
  }

  return (
    <aside className="hidden w-[var(--cp-sidebar-width)] shrink-0 flex-col border-r border-[var(--cp-border)] bg-[var(--cp-sidebar)] md:flex">
      <div className="flex h-[56px] items-center justify-between px-4">
        <div className="min-w-0 text-[18px] font-semibold leading-none text-[var(--cp-text)]">Commerce Pilot</div>
        <div className="flex items-center gap-1">
          <IconTooltip label="搜索">
            <Button type="button" variant="ghost" size="icon" aria-label="搜索">
              <Search />
            </Button>
          </IconTooltip>
          <IconTooltip label="收起侧栏">
            <Button type="button" variant="ghost" size="icon" aria-label="收起侧栏">
              <PanelLeft />
            </Button>
          </IconTooltip>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2">
        {primaryNavItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className={cn(
              "flex h-[var(--cp-sidebar-item-height)] w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-left text-sm text-[var(--cp-text-soft)] transition-colors duration-[var(--cp-duration-fast)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
              item.label === "新任务" && !activeThreadId && "bg-[var(--cp-surface-hover)] text-[var(--cp-text)]",
              navigationLocked && item.label === "新任务" && "cursor-not-allowed opacity-50",
            )}
            disabled={navigationLocked && item.label === "新任务"}
            onClick={item.label === "新任务" ? onNewTask : undefined}
          >
            <item.icon className="size-[var(--cp-sidebar-icon-size)] shrink-0" strokeWidth={1.8} />
            <span className="truncate">{item.label}</span>
          </button>
        ))}

        <div>
          <button
            ref={moreButtonRef}
            type="button"
            className={cn(
              "flex h-[var(--cp-sidebar-item-height)] w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-left text-sm text-[var(--cp-text-soft)] transition-colors duration-[var(--cp-duration-fast)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
              moreOpen && "bg-[var(--cp-surface-hover)] text-[var(--cp-text)]",
            )}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            aria-controls="sidebar-more-navigation"
            onClick={toggleMoreMenu}
          >
            <Ellipsis className="size-[var(--cp-sidebar-icon-size)] shrink-0" strokeWidth={1.8} />
            <span className="truncate">更多</span>
          </button>

          {moreOpen
            ? createPortal(
                <div
                  ref={moreMenuRef}
                  id="sidebar-more-navigation"
                  role="menu"
                  aria-label="更多功能"
                  className="fixed z-50 w-[252px] rounded-[var(--cp-radius-popover)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-2 shadow-[var(--cp-shadow-popover)]"
                  style={{ left: moreMenuPosition.left, top: moreMenuPosition.top }}
                >
                  {moreNavItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      className="flex h-10 w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-left text-sm text-[var(--cp-text-soft)] transition-colors duration-[var(--cp-duration-fast)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                      onClick={() => setMoreOpen(false)}
                    >
                      <item.icon className="size-[18px] shrink-0" strokeWidth={1.8} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>,
                document.body,
              )
            : null}
        </div>

        {threads.length ? (
          <div className="mt-5 px-1">
            <div className="mb-1 px-2 text-xs font-medium text-[var(--cp-text-faint)]">最近</div>
            <div className="space-y-1">
              {threads.map((thread) => (
                <button
                  key={thread.threadId}
                  type="button"
                  data-thread-id={thread.threadId}
                  data-thread-status={thread.status}
                  className={cn(
                    "flex h-[var(--cp-sidebar-item-height)] w-full items-center rounded-[var(--cp-radius-item)] px-3 text-left text-sm text-[var(--cp-text)] transition-colors hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                    thread.threadId === activeThreadId && "bg-[var(--cp-surface-hover)]",
                    navigationLocked && thread.threadId !== activeThreadId && "cursor-not-allowed opacity-50",
                  )}
                  disabled={navigationLocked && thread.threadId !== activeThreadId}
                  onClick={() => onOpenThread(thread)}
                >
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                  {thread.status === "running" ? (
                    <Loader2
                      data-thread-spinner
                      className="ml-2 size-3.5 shrink-0 animate-spin text-[var(--cp-text-muted)]"
                    />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </nav>

      <div className="px-3 pb-3">
        {user ? (
          <AuthenticatedSidebarFooter user={user} onLogout={onLogout} />
        ) : (
          <UnauthenticatedSidebarFooter onOpenAuth={onOpenAuth} />
        )}
      </div>
    </aside>
  );
}

function AuthenticatedSidebarFooter({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const initial = user.name.trim().slice(0, 1).toUpperCase() || "用";

  return (
    <div className="flex h-[52px] items-center gap-1 rounded-[var(--cp-radius-item)] px-2 hover:bg-[var(--cp-surface-hover)]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--cp-surface-hover)] text-sm font-medium text-[var(--cp-text)]">
        {initial}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm leading-5 text-[var(--cp-text)]">{user.name}</span>
        <span className="block truncate text-xs leading-4 text-[var(--cp-text-muted)]">{user.displayIdentifier}</span>
      </span>
      <IconTooltip label="退出登录">
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="退出登录" onClick={onLogout}>
          <LogOut className="size-4" strokeWidth={1.8} />
        </Button>
      </IconTooltip>
    </div>
  );
}

function MobileTopbar({
  user,
  onOpenAuth,
  onLogout,
}: {
  user: AuthUser | null;
  onOpenAuth: () => void;
  onLogout: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--cp-border)] bg-[rgba(255,255,255,0.96)] px-3 md:hidden">
      <Button type="button" variant="ghost" size="icon" aria-label="打开导航">
        <Menu />
      </Button>
      <div className="text-sm font-semibold text-[var(--cp-text)]">Commerce Pilot</div>
      {user ? (
        <Button type="button" variant="ghost" size="icon" aria-label="退出登录" onClick={onLogout}>
          <LogOut />
        </Button>
      ) : (
        <Button type="button" variant="default" size="sm" className="rounded-full" onClick={onOpenAuth}>
          登录
        </Button>
      )}
    </div>
  );
}

function TopAuthActions({
  onOpenLogin,
  onOpenRegister,
}: {
  onOpenLogin: () => void;
  onOpenRegister: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
      <Button type="button" size="md" className="h-10 rounded-full px-5" onClick={onOpenLogin}>
        登录
      </Button>
      <Button
        type="button"
        variant="subtle"
        size="md"
        className="h-10 rounded-full bg-[var(--cp-surface)] px-5 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)] hover:bg-[var(--cp-surface)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.05)]"
        onClick={onOpenRegister}
      >
        免费注册
      </Button>
    </div>
  );
}

function UnauthenticatedSidebarFooter({ onOpenAuth }: { onOpenAuth: () => void }) {
  return (
    <div className="border-t border-[var(--cp-border-subtle)] pt-3">
      <div className="space-y-1">
        <SidebarUtilityItem icon={Sparkles} label="查看套餐和定价" trailingIcon={ExternalLink} />
        <SidebarUtilityItem icon={Settings} label="设置" />
        <SidebarUtilityItem icon={HelpCircle} label="帮助" trailingIcon={ExternalLink} />
      </div>

      <div className="mt-4 border-t border-[var(--cp-border-subtle)] px-1 pt-4">
        <div className="text-sm font-semibold leading-5 text-[var(--cp-text)]">获取为你量身定制的回复</div>
        <p className="mt-2 text-xs leading-5 text-[var(--cp-text-muted)]">
          登录后可保存电商任务、上传文件并使用项目上下文。
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4 h-11 w-full rounded-full border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.02)] hover:bg-[var(--cp-surface)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.03)]"
          onClick={onOpenAuth}
        >
          登录
        </Button>
      </div>
    </div>
  );
}

function SidebarUtilityItem({
  icon: Icon,
  label,
  trailingIcon: TrailingIcon,
}: {
  icon: typeof Sparkles;
  label: string;
  trailingIcon?: typeof ExternalLink;
}) {
  return (
    <button
      type="button"
      className="flex h-9 w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-2 text-left text-sm text-[var(--cp-text-soft)] transition-colors hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {TrailingIcon ? <TrailingIcon className="size-3.5 shrink-0 text-[var(--cp-text-muted)]" strokeWidth={1.8} /> : null}
    </button>
  );
}

function AuthDialog({
  initialMode,
  onClose,
  onAuthenticated,
}: {
  initialMode: AuthMode;
  onClose: () => void;
  onAuthenticated: () => Promise<void>;
}) {
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
  const [identifierType, setIdentifierType] = useState<AuthIdentifierType>("email");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submitAuthentication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/account/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifierType,
          identifier,
          password,
          rememberMe: true,
          ...(authMode === "register" ? { name } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "认证请求失败，请稍后重试。");
      }
      await onAuthenticated();
    } catch (authenticationError) {
      setError(authenticationError instanceof Error ? authenticationError.message : "认证请求失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  function switchAuthMode(nextMode: AuthMode) {
    setAuthMode(nextMode);
    setError(null);
  }

  function switchIdentifierType() {
    setIdentifierType((current) => (current === "email" ? "phone" : "email"));
    setIdentifier("");
    setError(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.42)] px-4 py-8"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
        className="relative w-full max-w-[476px] rounded-[20px] bg-[var(--cp-surface)] px-10 pb-8 pt-9 text-center shadow-[var(--cp-shadow-popover)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full text-[var(--cp-text-soft)] transition-colors hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          aria-label="关闭"
          onClick={onClose}
        >
          <X className="size-5" strokeWidth={1.8} />
        </button>

        <h2 id="auth-dialog-title" className="text-[24px] font-semibold leading-tight tracking-[0] text-[var(--cp-text)]">
          {authMode === "login" ? "登录" : "创建账号"}
        </h2>
        <p className="mx-auto mt-4 max-w-[380px] text-sm leading-6 text-[var(--cp-text-soft)] sm:whitespace-nowrap">
          登录后可保存电商任务、上传文件并使用项目上下文。
        </p>

        <div className="mt-7 space-y-3">
          <AuthProviderButton onClick={switchIdentifierType}>
            {identifierType === "email" ? (
              <>
                <Phone className="size-4" strokeWidth={1.8} />
                <span>使用电话号码继续</span>
              </>
            ) : (
              <>
                <Mail className="size-4" strokeWidth={1.8} />
                <span>使用电子邮件继续</span>
              </>
            )}
          </AuthProviderButton>
        </div>

        <div className="my-6 grid grid-cols-[1fr_auto_1fr] items-center gap-5 text-xs text-[var(--cp-text-muted)]">
          <span className="h-px bg-[var(--cp-border)]" />
          <span>或</span>
          <span className="h-px bg-[var(--cp-border)]" />
        </div>

        <form className="space-y-3" onSubmit={submitAuthentication}>
          {authMode === "register" ? (
            <div className="relative">
              <label className="sr-only" htmlFor="auth-name">
                名称
              </label>
              <Store className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--cp-text-faint)]" />
              <input
                id="auth-name"
                data-auth-input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="名称"
                className="h-12 w-full rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] pl-11 pr-4 text-sm text-[var(--cp-text)] outline-none transition-colors placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-border-strong)]"
                required
                maxLength={50}
              />
            </div>
          ) : null}

          <div className="relative">
            <label className="sr-only" htmlFor="auth-identifier">
              {identifierType === "email" ? "电子邮件地址" : "手机号码"}
            </label>
            {identifierType === "email" ? (
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--cp-text-faint)]" />
            ) : (
              <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--cp-text-faint)]" />
            )}
            <input
              id="auth-identifier"
              data-auth-input
              type={identifierType === "email" ? "email" : "tel"}
              autoComplete={identifierType === "email" ? "email" : "tel"}
              inputMode={identifierType === "email" ? "email" : "tel"}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={identifierType === "email" ? "电子邮件地址" : "手机号码"}
              className="h-12 w-full rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] pl-11 pr-4 text-sm text-[var(--cp-text)] outline-none transition-colors placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-border-strong)]"
              required
            />
          </div>

          <div className="relative">
            <label className="sr-only" htmlFor="auth-password">
              密码
            </label>
            <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--cp-text-faint)]" />
            <input
              id="auth-password"
              data-auth-input
              type={passwordVisible ? "text" : "password"}
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="密码"
              className="h-12 w-full rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] pl-11 pr-12 text-sm text-[var(--cp-text)] outline-none transition-colors placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-border-strong)]"
              required
              minLength={8}
              maxLength={128}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              {passwordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          {authMode === "register" ? (
            <p className="m-0 px-2 text-left text-xs leading-5 text-[var(--cp-text-muted)]">
              密码至少 8 个字符，并同时包含英文字母和数字。
            </p>
          ) : null}

          {error ? (
            <p className="m-0 rounded-[var(--cp-radius-item)] bg-[var(--cp-danger-bg)] px-3 py-2 text-left text-xs leading-5 text-[var(--cp-danger)]" role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="h-12 w-full rounded-full text-sm" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : null}
            {submitting ? "处理中" : authMode === "login" ? "登录" : "免费注册"}
          </Button>
        </form>

        <p className="mb-0 mt-5 text-sm text-[var(--cp-text-muted)]">
          {authMode === "login" ? "还没有账号？" : "已经有账号？"}
          <button
            type="button"
            className="ml-1 font-medium text-[var(--cp-text)] underline underline-offset-4"
            onClick={() => switchAuthMode(authMode === "login" ? "register" : "login")}
          >
            {authMode === "login" ? "免费注册" : "登录"}
          </button>
        </p>
      </section>
    </div>
  );
}

function AuthProviderButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] px-4 text-sm font-medium text-[var(--cp-text)] transition-colors hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
    >
      {children}
    </button>
  );
}

function ModeSwitch({ mode, onModeChange }: { mode: WorkMode; onModeChange: (mode: WorkMode) => void }) {
  const options: Array<{ value: WorkMode; label: string }> = [
    { value: "chat", label: "聊天" },
    { value: "work", label: "工作" },
  ];

  return (
    <div className="pointer-events-auto inline-flex h-9 items-center rounded-[var(--cp-radius-segment)] bg-[var(--cp-bg-subtle)] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onModeChange(option.value)}
          className={cn(
            "h-8 min-w-[98px] rounded-[var(--cp-radius-segment)] px-5 text-sm font-medium text-[var(--cp-text-soft)] transition-[background,box-shadow,color] duration-[var(--cp-duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
            mode === option.value &&
              "bg-[var(--cp-surface)] text-[var(--cp-text)] shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)]",
          )}
          aria-pressed={mode === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GuestComposer({
  value,
  onChange,
  onSubmit,
  onUseSuggestion,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onUseSuggestion: () => void;
}) {
  return (
    <div className="flex w-full max-w-[768px] flex-col items-center">
      <form
        className="flex h-[54px] w-full items-center gap-2 rounded-full border border-[var(--cp-border-strong)] bg-[var(--cp-surface)] px-2 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.04)] focus-within:border-[var(--cp-text-faint)]"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <IconTooltip label="添加内容">
          <Button type="button" variant="ghost" size="icon" className="size-9 rounded-full" aria-label="添加内容">
            <Plus className="size-5" />
          </Button>
        </IconTooltip>

        <label className="sr-only" htmlFor="guest-prompt">
          输入问题
        </label>
        <input
          id="guest-prompt"
          data-guest-composer-input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="有问题，随便问"
          className="min-w-0 flex-1 border-0 bg-transparent px-1 text-[14px] text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)]"
        />

        <IconTooltip label="语音输入">
          <Button type="button" variant="ghost" size="icon" className="size-9 rounded-full" aria-label="语音输入">
            <Mic className="size-[18px]" />
          </Button>
        </IconTooltip>

        <IconTooltip label="发送">
          <Button
            type="submit"
            size="icon"
            className="size-9 rounded-full disabled:bg-[var(--cp-text-faint)] disabled:text-white disabled:opacity-70"
            aria-label="发送"
            disabled={!value.trim()}
          >
            <ArrowUp className="size-[18px]" strokeWidth={2} />
          </Button>
        </IconTooltip>
      </form>

      <button
        type="button"
        className="mt-6 h-11 rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] px-4 text-sm font-medium text-[var(--cp-text)] transition-colors hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
        onClick={onUseSuggestion}
      >
        你能做什么？
      </button>
    </div>
  );
}

function WorkComposer({
  mode,
  value,
  submittedDraft,
  runtimeStatus,
  models,
  modelsLoading,
  selectedModel,
  reasoningEffort,
  onChange,
  onSubmit,
  onModelChange,
  onReasoningEffortChange,
}: {
  mode: WorkMode;
  value: string;
  submittedDraft: string | null;
  runtimeStatus: RuntimeStatus;
  models: ProviderModelSummary[];
  modelsLoading: boolean;
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
}) {
  const placeholder =
    mode === "work" ? "处理订单、库存、商品、售后或报表事务" : "询问电商运营、系统配置或数据问题";
  const composerInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (composerInputRef.current) {
      resizeTextarea(composerInputRef.current, 68, 180);
    }
  }, [value]);

  return (
    <div className="w-full">
      <div className="min-h-[var(--cp-composer-min-height)] rounded-[var(--cp-radius-composer)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-5 py-4 shadow-[var(--cp-shadow-composer)] transition-[border-color,box-shadow] duration-[var(--cp-duration-base)] focus-within:border-[var(--cp-border-strong)] focus-within:shadow-[var(--cp-shadow-composer)]">
        <textarea
          ref={composerInputRef}
          data-composer-input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          placeholder={placeholder}
          className="min-h-[68px] max-h-[180px] w-full resize-none overflow-y-hidden border-0 bg-transparent p-0 text-[14px] leading-relaxed text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)]"
          aria-label="任务输入"
        />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <IconTooltip label="添加上下文">
              <Button type="button" variant="ghost" size="composerIcon" aria-label="添加上下文">
                <Plus className="size-5" />
              </Button>
            </IconTooltip>
            <IconTooltip label="添加附件">
              <Button type="button" variant="ghost" size="composerIcon" aria-label="添加附件">
                <Paperclip />
              </Button>
            </IconTooltip>
            <IconTooltip label="资料库">
              <Button type="button" variant="ghost" size="composerIcon" aria-label="资料库">
                <BookOpen />
              </Button>
            </IconTooltip>
          </div>

          <div className="flex items-center gap-1">
            <ModelAndReasoningControl
              models={models}
              loading={modelsLoading}
              selectedModel={selectedModel}
              reasoningEffort={reasoningEffort}
              onModelChange={onModelChange}
              onReasoningEffortChange={onReasoningEffortChange}
            />

            <IconTooltip label="语音输入">
              <Button type="button" variant="ghost" size="composerIcon" aria-label="语音输入" className="rounded-full">
                <Mic />
              </Button>
            </IconTooltip>

            <IconTooltip label="提交">
              <Button
                type="button"
                size="composerIcon"
                aria-label="提交"
                disabled={!value.trim()}
                onClick={onSubmit}
                className="rounded-full"
              >
                <SendHorizontal />
              </Button>
            </IconTooltip>
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-11 w-[calc(100%-40px)] items-center justify-between gap-3 rounded-b-[18px] bg-[var(--cp-bg-subtle)] px-6 text-sm text-[var(--cp-text-soft)]">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-[var(--cp-radius-item)] py-2 text-left hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
        >
          <span className="truncate">选择项目</span>
          <ChevronDown className="size-4 shrink-0 text-[var(--cp-text-muted)]" />
        </button>

        <RuntimeStatusInline runtimeStatus={runtimeStatus} />
      </div>

      {submittedDraft ? (
        <div className="mt-6 rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] px-4 py-3 text-sm text-[var(--cp-text-soft)] shadow-[var(--cp-shadow-soft)]">
          <div className="mb-2 flex items-center gap-2 text-xs text-[var(--cp-text-muted)]">
            <Bot className="size-4" />
            <span>本地草稿</span>
          </div>
          <p className="m-0 break-words leading-relaxed">{submittedDraft}</p>
        </div>
      ) : null}
    </div>
  );
}

function ModelAndReasoningControl({
  models,
  loading,
  selectedModel,
  reasoningEffort,
  disabled = false,
  placement = "bottom",
  onModelChange,
  onReasoningEffortChange,
}: {
  models: ProviderModelSummary[];
  loading: boolean;
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  disabled?: boolean;
  placement?: "top" | "bottom";
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"quick" | "advanced">("quick");
  const [submenu, setSubmenu] = useState<"model" | "effort" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const effortIndex = Math.max(
    0,
    reasoningEffortOptions.findIndex((option) => option.value === reasoningEffort),
  );
  const effortOption = reasoningEffortOptions[effortIndex] ?? reasoningEffortOptions[0];
  const effortLabel = effortOption.label;
  const reasoningSupported = supportsReasoningControl(selectedModel);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setSubmenu(null);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function closeOnOutsidePointer(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setSubmenu(null);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggleControl() {
    if (disabled) {
      return;
    }
    setOpen((current) => !current);
    setPanel(reasoningSupported ? "quick" : "advanced");
    setSubmenu(reasoningSupported ? null : "model");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-9 max-w-[210px] items-center gap-1.5 rounded-full bg-[var(--cp-bg-subtle)] px-4 text-sm text-[var(--cp-text)] transition-colors hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:cursor-not-allowed disabled:text-[var(--cp-text-muted)] disabled:opacity-70 disabled:hover:bg-[var(--cp-bg-subtle)]"
        aria-label={disabled ? "任务运行中不可切换模型" : "模型和推理设置"}
        aria-expanded={!disabled && open}
        aria-haspopup="menu"
        disabled={disabled}
        title={disabled ? "任务运行中不可切换模型" : undefined}
        onClick={toggleControl}
      >
        <span className="truncate font-medium">{loading ? "加载模型" : formatModelName(selectedModel)}</span>
        {reasoningSupported ? (
          <span className="shrink-0 font-medium" style={{ color: effortOption.color }}>
            {effortLabel}
          </span>
        ) : null}
        <ChevronDown className="size-3.5 shrink-0 text-[var(--cp-text-faint)]" strokeWidth={1.8} />
      </button>

      {!disabled && open && panel === "quick" && reasoningSupported ? (
        <div
          role="menu"
          aria-label="推理设置"
          className={cn(
            "absolute right-0 z-50 w-[226px] rounded-[var(--cp-radius-popover)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-3 shadow-[var(--cp-shadow-popover)]",
            placement === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          )}
        >
          <div className="relative h-8">
            <input
              type="range"
              className="cp-reasoning-slider absolute inset-0 z-10 w-full cursor-grab active:cursor-grabbing"
              min={0}
              max={reasoningEffortOptions.length - 1}
              step={1}
              value={effortIndex}
              aria-label={`推理强度：${effortLabel}`}
              data-effort={reasoningEffort}
              style={
                {
                  "--cp-slider-progress": `${(effortIndex / (reasoningEffortOptions.length - 1)) * 100}%`,
                  "--cp-slider-color-start": effortOption.color,
                  "--cp-slider-color-end": effortOption.gradientEnd,
                } as React.CSSProperties
              }
              onChange={(event) => {
                const option = reasoningEffortOptions[Number(event.target.value)];
                if (option) {
                  onReasoningEffortChange(option.value);
                }
              }}
            />
            <div className="pointer-events-none absolute inset-x-3 top-1/2 z-20 flex -translate-y-1/2 justify-between">
              {reasoningEffortOptions.map((option, index) => (
                <span
                  key={option.value}
                  className={cn(
                    "size-1 rounded-full",
                    index <= effortIndex ? "bg-white/70" : "bg-[var(--cp-border-strong)]",
                  )}
                />
              ))}
            </div>
          </div>

          {reasoningEffort === "ultra" ? (
            <p className="mb-0 mt-1 text-center text-xs font-medium text-[#9847d1]">更快消耗用量额度</p>
          ) : null}

          <button
            type="button"
            className="mt-2 flex h-9 w-full items-center justify-between rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
            onClick={() => {
              setPanel("advanced");
              setSubmenu(null);
            }}
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="size-4" strokeWidth={1.8} />
              高级
            </span>
            <ChevronRight className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      ) : null}

      {!disabled && open && panel === "advanced" ? (
        <div
          role="menu"
          aria-label="高级模型设置"
          className={cn(
            "absolute right-0 z-50 w-[226px] rounded-[var(--cp-radius-popover)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-2 shadow-[var(--cp-shadow-popover)]",
            placement === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          )}
        >
          <button
            type="button"
            className="flex h-9 w-full items-center gap-1 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
            onClick={() => {
              setPanel("quick");
              setSubmenu(null);
            }}
          >
            高级
            <ChevronDown className="size-3.5" strokeWidth={1.8} />
          </button>

          <SettingsMenuRow
            label="模型"
            value={formatModelName(selectedModel)}
            active={submenu === "model"}
            onClick={() => setSubmenu((current) => (current === "model" ? null : "model"))}
          />
          {reasoningSupported ? (
            <SettingsMenuRow
              label="推理强度"
              value={effortLabel}
              valueColor={effortOption.color}
              active={submenu === "effort"}
              onClick={() => setSubmenu((current) => (current === "effort" ? null : "effort"))}
            />
          ) : null}

          {submenu === "model" ? (
            <div className="absolute left-[calc(100%+8px)] top-9 max-h-[360px] w-[252px] overflow-y-auto rounded-[var(--cp-radius-popover)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-2 shadow-[var(--cp-shadow-popover)] max-[1500px]:left-auto max-[1500px]:right-[calc(100%+8px)]">
              {models.length ? (
                models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={model.id === selectedModel}
                    className="flex min-h-10 w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-3 py-2 text-left text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                    onClick={() => {
                      onModelChange(model.id);
                      setSubmenu(null);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words">{formatModelName(model.id)}</span>
                      {model.ownedBy ? (
                        <span className="block text-xs text-[var(--cp-text-faint)]">{model.ownedBy}</span>
                      ) : null}
                    </span>
                    {model.id === selectedModel ? <Check className="size-4 shrink-0" strokeWidth={2} /> : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-[var(--cp-text-muted)]">
                  {loading ? "正在加载模型" : "模型列表不可用"}
                </div>
              )}
            </div>
          ) : null}

          {submenu === "effort" && reasoningSupported ? (
            <div className="absolute left-[calc(100%+8px)] top-[84px] w-[190px] rounded-[var(--cp-radius-popover)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-2 shadow-[var(--cp-shadow-popover)] max-[1500px]:left-auto max-[1500px]:right-[calc(100%+8px)]">
              {reasoningEffortOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === reasoningEffort}
                  className="flex h-10 w-full items-center justify-between rounded-[var(--cp-radius-item)] px-3 text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                  onClick={() => {
                    onReasoningEffortChange(option.value);
                    setSubmenu(null);
                  }}
                >
                  <span style={{ color: option.color }}>{option.label}</span>
                  {option.value === reasoningEffort ? <Check className="size-4" strokeWidth={2} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SettingsMenuRow({
  label,
  value,
  valueColor,
  active,
  onClick,
}: {
  label: string;
  value: string;
  valueColor?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex min-h-10 w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-left text-sm hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
        active && "bg-[var(--cp-bg-subtle)]",
      )}
      onClick={onClick}
    >
      <span className="shrink-0 text-[var(--cp-text)]">{label}</span>
      <span
        className="min-w-0 flex-1 truncate text-right text-[var(--cp-text-muted)]"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
      <ChevronRight className="size-4 shrink-0 text-[var(--cp-text-faint)]" strokeWidth={1.8} />
    </button>
  );
}

function formatModelName(modelId: string): string {
  const friendlyNames: Record<string, string> = {
    "gpt-5.6-sol": "5.6 Sol",
    "gpt-5.6-terra": "5.6 Terra",
    "gpt-5.6-luna": "5.6 Luna",
    "gpt-5.5": "GPT-5.5",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.4-mini": "GPT-5.4 mini",
    "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
    "gemini-3.7-flash-high": "Gemini 3.7 Flash",
    "claude-sonnet-4-6": "Claude 4.6 Sonnet",
    "claude-opus-4-6-thinking": "Claude 4.6 Opus Thinking",
  };
  return friendlyNames[modelId] ?? modelId;
}

function supportsReasoningControl(modelId: string): boolean {
  return /^gpt-5\.(5|6)(?:-|$)/i.test(modelId);
}

function RuntimeStatusInline({ runtimeStatus }: { runtimeStatus: RuntimeStatus }) {
  const Icon = runtimeStatus.icon;

  return (
    <div className="hidden shrink-0 items-center gap-2 text-xs text-[var(--cp-text-muted)] sm:flex">
      <Icon className={cn("size-4", runtimeStatus.iconClass)} />
      <span>{runtimeStatus.label}</span>
    </div>
  );
}

function IconTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

type RuntimeStatus = {
  label: string;
  shortLabel: string;
  dotClass: string;
  icon: typeof CheckCircle2;
  iconClass: string;
  loading: boolean;
};

async function getGatewayHealth(): Promise<GatewayHealthResponse> {
  const response = await fetch("/api/gateway/health", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Gateway health endpoint failed.");
  }
  return (await response.json()) as GatewayHealthResponse;
}

async function getAuthSession(): Promise<AuthSessionResponse> {
  const response = await fetch("/api/account/session", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Authentication session endpoint failed.");
  }
  return (await response.json()) as AuthSessionResponse;
}

async function getProviderModels(): Promise<ProviderModelsResponse> {
  const response = await fetch("/api/provider/models", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Provider model catalog endpoint failed.");
  }
  return (await response.json()) as ProviderModelsResponse;
}

async function getAgentThreads(): Promise<AgentThreadsResponse> {
  const response = await fetch("/api/agent/threads", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Agent thread history endpoint failed.");
  }
  return (await response.json()) as AgentThreadsResponse;
}

function getRuntimeStatus(data: GatewayHealthResponse | undefined, loading: boolean): RuntimeStatus {
  if (loading && !data) {
    return {
      label: "正在检查",
      shortLabel: "检查中",
      dotClass: "bg-[var(--cp-text-faint)]",
      icon: Loader2,
      iconClass: "animate-spin text-[var(--cp-text-faint)]",
      loading: true,
    };
  }

  if (!data?.ok) {
    return {
      label: "Gateway 未连接",
      shortLabel: "Gateway 离线",
      dotClass: "bg-[var(--cp-danger)]",
      icon: CircleAlert,
      iconClass: "text-[var(--cp-danger)]",
      loading: false,
    };
  }

  if (data.codex?.initialized) {
    return {
      label: "Codex 就绪",
      shortLabel: "Codex 就绪",
      dotClass: "bg-[var(--cp-success)]",
      icon: CheckCircle2,
      iconClass: "text-[var(--cp-success)]",
      loading: false,
    };
  }

  if (data.codex?.running) {
    return {
      label: "Codex 启动中",
      shortLabel: "Codex 启动中",
      dotClass: "bg-[var(--cp-warning)]",
      icon: Loader2,
      iconClass: "animate-spin text-[var(--cp-warning)]",
      loading: true,
    };
  }

  return {
    label: "Gateway 在线",
    shortLabel: "Gateway 在线",
    dotClass: "bg-[var(--cp-success)]",
    icon: CheckCircle2,
    iconClass: "text-[var(--cp-success)]",
    loading: false,
  };
}
