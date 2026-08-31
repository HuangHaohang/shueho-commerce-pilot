"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  CornerDownRight,
  Ellipsis,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  HelpCircle,
  Headphones,
  ImageIcon,
  Library,
  ListRestart,
  ListX,
  Loader2,
  LocateFixed,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Mic,
  Palette,
  PackageSearch,
  Pencil,
  Phone,
  Plug,
  Plus,
  SendHorizontal,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Store,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { AgentRequestUserInputPanel } from "@/components/agent/request-user-input-panel";
import { AssistantMessageActions } from "@/components/agent/assistant-message-actions";
import { AssistantMarkdown } from "@/components/agent/assistant-markdown";
import {
  ComposerAddMenu,
  SelectedSkillChip,
  useComposerSkillSelector,
} from "@/components/agent/skill-selector";
import {
  CreativeMethodPicker,
  CreativeSpaceWorkbench,
} from "@/components/creative/creative-space-workbench";
import { PluginDirectory } from "@/components/plugins/plugin-directory";
import {
  ProductLibraryPicker,
  SelectedProductChips,
} from "@/components/products/product-library-picker";
import { ProductLibraryWorkspace } from "@/components/products/product-library-workspace";
import {
  ResearchEvidenceMobileSheet,
  ResearchEvidencePanel,
  ResearchToolReceiptView,
} from "@/components/research/market-research-evidence";
import { MarketResearchReportView } from "@/components/research/market-research-report";
import { ProductInsightWorkspace } from "@/components/research/product-insight-workspace";
import { SkillsDirectory } from "@/components/skills/skills-directory";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  findRetrySourceMessage,
  useAgentThread,
  type AgentActivity,
  type AgentMessageFeedbackRating,
  type AgentThreadSummary,
  type ConversationAttachment,
  type ConversationMessage,
  type GeneratedImageItem,
  type PendingRequestUserInput,
  type PendingAttachmentUpload,
  type QueuedMessage,
} from "@/lib/agent/use-agent-thread";
import {
  calculateConversationMinimapMarkerWidth,
  calculateConversationMinimap,
  selectConversationMinimapPromptMarkers,
  type ConversationMinimapMarker,
  type ConversationMinimapMarkerInput,
  type ConversationMinimapState,
} from "@/lib/agent/conversation-minimap";
import {
  collectRecentWebSources,
  type WebSource,
} from "@/lib/agent/web-sources";
import {
  canAccessEnterpriseAdmin,
  canManageExternalDataPolicy as hasExternalDataPolicyManagement,
} from "@/lib/enterprise/navigation-access";
import { approvalModeAfterTaskBoundary } from "@/lib/enterprise/external-data-policy";
import { resolveTaskCategory, type TaskCategory } from "@/lib/agent/task-category";
import { readExplicitSkillMessage, readVisibleAttachmentMessage } from "@/lib/agent/skill-invocation";
import {
  searchActivityLabel,
  summarizeSearchActivities,
} from "@/lib/agent/search-activity-presentation";
import { getSkills, sortSkillInventory, type SkillInventoryItem } from "@/lib/agent/skills";
import { shouldCompactComposerControls } from "@/lib/agent/composer-layout";
import { getPluginInventory, type CommercePluginInventoryItem } from "@/lib/plugins/catalog";
import {
  creativeMethodSkillName,
  isCreativeMethod,
  type CreativeMethod,
} from "@/lib/creative/creative-method-contract";
import {
  creativeMethodActiveRequirement,
  creativeMethodStarterPrompt,
} from "@/lib/creative/creative-method-presentation";
import {
  CreativeCanvasComposerBridge,
  type CanvasRevisionRequest,
  useCreativeCanvasNavigation,
} from "@/lib/creative/creative-canvas-navigation";
import type { CreativeCanvasMessageReference } from "@/lib/creative/creative-canvas-types";
import { getThreadProductContext } from "@/lib/products/thread-product-context";
import type { ProductContextMode, ProductSummary } from "@/lib/products/catalog";
import {
  parseMarketResearchResponse,
  type MarketResearchReceipt,
} from "@/lib/research/market-report";
import {
  productInsightMethodForRecipeId,
  productInsightSkillName,
  type ProductInsightMethod,
} from "@/lib/research/product-insight-contract";
import {
  tryParseStructuredCopywritingAnswer,
  tryParseStructuredCopywritingDraft,
  type CopywritingDraft,
} from "@/lib/copywriting/brief";
import { cn } from "@/lib/utils";

type WorkMode = "chat" | "work";
type WorkbenchView = "workbench" | "plugins" | "skills" | "creative" | "research" | "products";
type ComposerPopoverId = "access" | "products" | "model";
type AuthMode = "login" | "register";
type AuthIdentifierType = "email" | "phone";

const PRODUCT_ONBOARDING_PROMPT =
  "我想接入公司的产品库。请先检查当前企业可用的接入方式，用普通用户能理解的步骤引导我完成接入；在发布标准产品前先展示产品、SKU 和待复核问题，并让我明确确认。";

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

type ThreadDeletionJobView = {
  id: string;
  status: "queued" | "running" | "completed" | "partial" | "failed";
  totalItems: number;
  completedItems: number;
  failedItems: number;
  items: Array<{
    threadId: string;
    status: "queued" | "running" | "deleted" | "failed";
    error: string | null;
  }>;
};

type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
type ExternalDataApprovalMode = "always_ask" | "task" | "policy";

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

type EnterpriseNavigationContextResponse = {
  permissions: string[];
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
  managedMcp: {
    state?: "unknown" | "loading" | "ready" | "failed";
    available?: boolean;
    serverName?: string;
    tools?: string[];
    checkedAt?: string | null;
    error?: string | null;
  } | null;
  externalData: {
    provider?: string;
    configured?: boolean;
    connected?: boolean;
    controlConfigured?: boolean;
    businessTools?: string[];
    checkedAt?: string | null;
    error?: string | null;
  } | null;
  runtimePolicy: {
    maxTurnDurationMs?: number;
  } | null;
  error?: string;
};

export const primaryNavItems = [
  { label: "新任务", icon: SquarePen, active: true, disabledReason: null },
  { label: "商品决策", icon: PackageSearch, active: false, disabledReason: null },
  { label: "创作空间", icon: Palette, active: false, disabledReason: null },
  { label: "资料库", icon: Library, active: false, disabledReason: "资料库功能尚未接入" },
];

export const moreNavItems = [
  { label: "已安排", icon: Clock3, active: false, href: null, disabledReason: "已安排功能尚未接入" },
  { label: "插件", icon: Plug, active: false, href: null, disabledReason: null },
  { label: "技能", icon: Sparkles, active: false, href: null, disabledReason: null },
];

const taskGroupDefinitions: Array<{
  category: TaskCategory;
  label: string;
  icon: typeof Palette;
}> = [
  { category: "creative", label: "创作空间", icon: Palette },
  { category: "research", label: "商品决策", icon: PackageSearch },
  { category: "operations", label: "店铺运营", icon: Store },
  { category: "support", label: "客服与售后", icon: Headphones },
  { category: "analytics", label: "数据与报表", icon: ChartNoAxesCombined },
  { category: "general", label: "通用对话", icon: MessageCircle },
];

type SidebarFlyoutId = "more";

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

export function CommerceWorkbenchShell({
  allowPublicRegistration,
  initialView = "workbench",
}: {
  allowPublicRegistration: boolean;
  initialView?: WorkbenchView;
}) {
  const [activeView, setActiveView] = useState<WorkbenchView>(initialView);
  const [freshTaskEntry, setFreshTaskEntry] = useState<"research" | null>(null);
  const [activeManagedEntryWorkflow, setActiveManagedEntryWorkflow] = useState<"commerce-product-onboarding" | null>(null);
  const [mode, setMode] = useState<WorkMode>("work");
  const [draft, setDraft] = useState("");
  const [submittedDraft, setSubmittedDraft] = useState<string | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogMode, setAuthDialogMode] = useState<AuthMode>("login");
  const [selectedModel, setSelectedModel] = useState("gpt-5.6-sol");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("low");
  const [externalDataApprovalMode, setExternalDataApprovalMode] = useState<ExternalDataApprovalMode>("always_ask");
  const [selectedSkill, setSelectedSkill] = useState<SkillInventoryItem | null>(null);
  const [creativeMethod, setCreativeMethod] = useState<CreativeMethod | null>(null);
  const [productInsightMethod, setProductInsightMethod] = useState<ProductInsightMethod>("market_research");
  const [productContextMode, setProductContextMode] = useState<ProductContextMode>("auto");
  const [selectedProducts, setSelectedProducts] = useState<ProductSummary[]>([]);
  const [productLibraryReturnView, setProductLibraryReturnView] = useState<WorkbenchView>("workbench");
  const [composerAttachments, setComposerAttachments] = useState<PendingAttachmentUpload[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [selectedPluginDetailName, setSelectedPluginDetailName] = useState<string | null>(null);
  const [threadSelectionMode, setThreadSelectionMode] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(() => new Set());
  const [deleteDialogThreadIds, setDeleteDialogThreadIds] = useState<string[] | null>(null);
  const [threadDeletionJobs, setThreadDeletionJobs] = useState<ThreadDeletionJobView[]>([]);
  const [threadDeletionSubmitting, setThreadDeletionSubmitting] = useState(false);
  const [threadDeletionError, setThreadDeletionError] = useState<string | null>(null);
  const autoRestoreAttemptedRef = useRef(false);
  const previousAuthUserIdRef = useRef<string | null | undefined>(undefined);
  const composerAttachmentsRef = useRef<PendingAttachmentUpload[]>([]);
  const warmedThreadIdsRef = useRef(new Set<string>());
  const productContextRequestRef = useRef(0);
  const productContextAbortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

  useEffect(() => () => {
    productContextAbortRef.current?.abort();
    for (const attachment of composerAttachmentsRef.current) {
      if (attachment.kind === "image" && attachment.url.startsWith("blob:")) URL.revokeObjectURL(attachment.url);
    }
  }, []);

  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: getAuthSession,
    retry: false,
    staleTime: 30_000,
  });
  const authUser = sessionQuery.data?.user ?? null;
  const isAuthenticated = Boolean(authUser);

  const enterpriseNavigationQuery = useQuery({
    queryKey: ["enterprise-navigation-access", authUser?.id],
    queryFn: getEnterpriseNavigationContext,
    enabled: isAuthenticated,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });
  const canOpenEnterpriseAdmin =
    isAuthenticated &&
    enterpriseNavigationQuery.isSuccess &&
    !enterpriseNavigationQuery.isFetching &&
    canAccessEnterpriseAdmin(enterpriseNavigationQuery.data.permissions);
  const canManageExternalDataPolicy =
    isAuthenticated &&
    enterpriseNavigationQuery.isSuccess &&
    hasExternalDataPolicyManagement(enterpriseNavigationQuery.data.permissions);

  const modelsQuery = useQuery({
    queryKey: ["provider-models"],
    queryFn: getProviderModels,
    enabled: isAuthenticated,
    retry: 1,
    staleTime: 60_000,
  });

  const skillsQuery = useQuery({
    queryKey: ["codex-skills"],
    queryFn: getSkills,
    enabled: isAuthenticated,
    retry: 1,
    staleTime: 0,
  });
  const enabledSkills = useMemo(
    () => sortSkillInventory((skillsQuery.data?.skills ?? []).filter((skill) => skill.enabled)),
    [skillsQuery.data?.skills],
  );

  const pluginsQuery = useQuery({
    queryKey: ["commerce-plugin-inventory"],
    queryFn: getPluginInventory,
    enabled: isAuthenticated,
    retry: 1,
    staleTime: 10_000,
  });
  const enabledPlugins = useMemo(
    () => (pluginsQuery.data?.plugins ?? []).filter((plugin) => plugin.enabled),
    [pluginsQuery.data?.plugins],
  );

  const threadsQuery = useQuery({
    queryKey: ["agent-threads", authUser?.id],
    queryFn: getAgentThreads,
    enabled: isAuthenticated,
    retry: 1,
    staleTime: 10_000,
    refetchInterval: (query) =>
      query.state.data?.threads.some((thread) => thread.status === "running") ? 3_000 : false,
  });
  const creativeProjects = useMemo(
    () => (threadsQuery.data?.threads ?? []).filter(isCreativeProjectThread),
    [threadsQuery.data?.threads],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setThreadDeletionJobs([]);
      return;
    }
    let cancelled = false;
    void getActiveThreadDeletionJobs()
      .then((jobs) => {
        if (cancelled) return;
        setThreadDeletionJobs((current) => {
          const merged = new Map(current.map((job) => [job.id, job]));
          for (const job of jobs) merged.set(job.id, job);
          return [...merged.values()];
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

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
  const externalDataReady =
    healthQuery.data?.externalData?.connected === true &&
    healthQuery.data?.externalData?.controlConfigured === true;

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
  const navigationLocked =
    (agentThread.status === "connecting" && !agentThread.loadingHistory) ||
    agentThread.queueSubmitting ||
    Boolean(agentThread.retryingMessageId);
  const deletingThreadIds = useMemo(
    () =>
      new Set(
        threadDeletionJobs.flatMap((job) =>
          job.items
            .filter((item) => item.status === "queued" || item.status === "running")
            .map((item) => item.threadId),
        ),
      ),
    [threadDeletionJobs],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      warmedThreadIdsRef.current.clear();
      return;
    }
    const targets = (threadsQuery.data?.threads ?? [])
      .slice(0, 12)
      .map((thread) => thread.threadId)
      .filter((threadId) => !warmedThreadIdsRef.current.has(threadId));
    if (!targets.length) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void (async () => {
        for (const threadId of targets) {
          if (controller.signal.aborted) return;
          warmedThreadIdsRef.current.add(threadId);
          try {
            const response = await fetch(
              `/api/agent/threads/${encodeURIComponent(threadId)}/status`,
              { cache: "no-store", signal: controller.signal },
            );
            if (!response.ok) warmedThreadIdsRef.current.delete(threadId);
          } catch {
            warmedThreadIdsRef.current.delete(threadId);
            if (controller.signal.aborted) return;
          }
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isAuthenticated, threadsQuery.dataUpdatedAt]);

  useEffect(() => {
    const activeJobs = threadDeletionJobs.filter((job) => job.status === "queued" || job.status === "running");
    if (!activeJobs.length) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const refreshed = await Promise.all(activeJobs.map((job) => getThreadDeletionJobStatus(job.id).catch(() => job)));
      if (cancelled) return;
      setThreadDeletionJobs((current) => {
        const replacements = new Map(refreshed.map((job) => [job.id, job]));
        return current.map((job) => replacements.get(job.id) ?? job);
      });
      const terminal = refreshed.filter((job) => job.status !== "queued" && job.status !== "running");
      if (terminal.length) {
        const deletedIds = new Set(
          terminal.flatMap((job) => job.items.filter((item) => item.status === "deleted").map((item) => item.threadId)),
        );
        if (agentThread.threadId && deletedIds.has(agentThread.threadId)) startNewTask();
        if (terminal.some((job) => job.failedItems > 0)) {
          setThreadDeletionError("部分任务未能删除，请重新选择失败项后重试。");
        }
        await threadsQuery.refetch();
        setThreadDeletionJobs((current) => current.filter((job) => !terminal.some((item) => item.id === job.id)));
      }
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [agentThread.threadId, threadDeletionJobs, threadsQuery.refetch]);

  useEffect(() => {
    const currentUserId = authUser?.id ?? null;
    if (
      previousAuthUserIdRef.current !== undefined &&
      previousAuthUserIdRef.current !== currentUserId
    ) {
      productContextRequestRef.current += 1;
      productContextAbortRef.current?.abort();
      productContextAbortRef.current = null;
      agentThread.resetThread();
      setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
      setSelectedSkill(null);
      setActiveManagedEntryWorkflow(null);
      setCreativeMethod(null);
      setProductInsightMethod("market_research");
      resetProductContext();
      clearComposerAttachments();
      autoRestoreAttemptedRef.current = false;
      queryClient.removeQueries({ queryKey: ["agent-threads"] });
      queryClient.removeQueries({ queryKey: ["provider-models"] });
      warmedThreadIdsRef.current.clear();
    }
    previousAuthUserIdRef.current = currentUserId;
  }, [agentThread.resetThread, authUser?.id, queryClient]);

  useEffect(() => {
    if (!isAuthenticated || activeView !== "workbench") {
      autoRestoreAttemptedRef.current = false;
      return;
    }
    if (!threadsQuery.isSuccess || autoRestoreAttemptedRef.current) {
      return;
    }
    autoRestoreAttemptedRef.current = true;
    const latestThread = threadsQuery.data?.threads[0];
    if (!agentThread.threadId && latestThread) {
      setActiveManagedEntryWorkflow(isProductOnboardingThread(latestThread) ? "commerce-product-onboarding" : null);
      if (isCreativeProjectThread(latestThread)) {
        setActiveView("creative");
        void restoreThreadProductContext(latestThread.threadId);
      } else if (isProductInsightThread(latestThread)) {
        setProductInsightMethod(productInsightMethodForThread(latestThread));
        setActiveView("research");
        void restoreThreadProductContext(latestThread.threadId);
      }
      void agentThread.loadThread(latestThread);
    }
  }, [
    activeView,
    agentThread.loadThread,
    agentThread.threadId,
    isAuthenticated,
    threadsQuery.data,
    threadsQuery.isSuccess,
  ]);

  useEffect(() => {
    if (agentThread.threadId) {
      void threadsQuery.refetch();
    }
  }, [agentThread.status, agentThread.threadId, agentThread.threadTitle]);

  async function submitDraft() {
    const value = draft.trim();
    if (!value && !composerAttachments.length) {
      return;
    }
    if (agentThread.status === "connecting" || agentThread.compacting) {
      return;
    }
    const steering = agentThread.status === "running" && Boolean(agentThread.activeTurnId);
    if (agentThread.status === "running" && !steering) {
      return;
    }
    if (isAuthenticated) {
      if (steering) {
        const steeringWorkflow = activeView === "creative"
          ? "commerce-creative-project"
          : activeView === "research"
            ? "commerce-product-insight"
            : activeManagedEntryWorkflow ?? undefined;
        const sent = steeringWorkflow
          ? await agentThread.steerMessage(value, {
              workflow: steeringWorkflow,
              ...(activeView === "research" ? { insightMethod: productInsightMethod } : {}),
            })
          : await agentThread.enqueueMessage(value);
        if (sent) {
          setDraft("");
        }
      } else if (activeView === "creative" || activeView === "research") {
        const attachmentsForSubmit = takeComposerAttachments();
        const creativeMethodForSubmit = activeView === "creative" ? creativeMethod : null;
        setDraft("");
        if (creativeMethodForSubmit) setCreativeMethod(null);
        const submitted = await agentThread.submit(value || "请结合附件继续处理。", {
          workflow: activeView === "creative" ? "commerce-creative-project" : "commerce-product-insight",
          ...(activeView === "research" ? { insightMethod: productInsightMethod } : {}),
          ...(creativeMethodForSubmit ? { creativeMethod: creativeMethodForSubmit } : {}),
          ...(creativeMethodForSubmit ? { displaySkillName: creativeMethodSkillName(creativeMethodForSubmit) } : {}),
          attachments: attachmentsForSubmit,
          externalDataApprovalMode,
          productIds: selectedProducts.map((product) => product.id),
          productContextMode,
        });
        if (submitted) finalizeSubmittedAttachments(attachmentsForSubmit);
        else {
          restoreComposerAttachments(attachmentsForSubmit);
          setDraft(value);
          if (creativeMethodForSubmit) setCreativeMethod(creativeMethodForSubmit);
        }
      } else {
        const attachmentsForSubmit = takeComposerAttachments();
        const skillForSubmit = selectedSkill;
        setDraft("");
        setSelectedSkill(null);
        const submitted = await agentThread.submit(
          value,
          {
            ...(activeManagedEntryWorkflow ? { workflow: activeManagedEntryWorkflow } : {}),
            ...(skillForSubmit ? { skillName: skillForSubmit.name } : {}),
            attachments: attachmentsForSubmit,
            externalDataApprovalMode,
            productIds: selectedProducts.map((product) => product.id),
            productContextMode,
          },
        );
        if (submitted) {
          finalizeSubmittedAttachments(attachmentsForSubmit);
        } else {
          restoreComposerAttachments(attachmentsForSubmit);
          setDraft(value);
          setSelectedSkill(skillForSubmit);
        }
      }
    } else {
      setDraft("");
      setSubmittedDraft(value);
    }
  }

  function openAuthDialog(authMode: AuthMode) {
    setAuthDialogMode(authMode);
    setAuthDialogOpen(true);
  }

  async function logout() {
    cancelThreadProductContextRestore();
    agentThread.resetThread();
    setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
    setActiveManagedEntryWorkflow(null);
    setCreativeMethod(null);
    setProductInsightMethod("market_research");
    resetProductContext();
    clearComposerAttachments();
    autoRestoreAttemptedRef.current = false;
    await fetch("/api/account/logout", { method: "POST" });
    await sessionQuery.refetch();
  }

  function startNewTask() {
    if (navigationLocked) {
      return;
    }
    setDraft("");
    setFreshTaskEntry(null);
    setSubmittedDraft(null);
    setSelectedSkill(null);
    setActiveManagedEntryWorkflow(null);
    setCreativeMethod(null);
    setProductInsightMethod("market_research");
    cancelThreadProductContextRestore();
    resetProductContext();
    setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
    clearComposerAttachments();
    setActiveView("workbench");
    autoRestoreAttemptedRef.current = true;
    agentThread.resetThread();
    void threadsQuery.refetch();
  }

  function openStoredThread(thread: AgentThreadSummary) {
    if (navigationLocked || deletingThreadIds.has(thread.threadId)) {
      return;
    }
    setDraft("");
    setFreshTaskEntry(null);
    setSelectedSkill(null);
    setActiveManagedEntryWorkflow(isProductOnboardingThread(thread) ? "commerce-product-onboarding" : null);
    setCreativeMethod(null);
    if (isProductInsightThread(thread)) {
      setProductInsightMethod(productInsightMethodForThread(thread));
    }
    clearComposerAttachments();
    const threadView = isCreativeProjectThread(thread)
      ? "creative"
      : isProductInsightThread(thread)
        ? "research"
        : "workbench";
    setActiveView(threadView);
    if (threadView === "creative" || threadView === "research") {
      void restoreThreadProductContext(thread.threadId);
    } else {
      cancelThreadProductContextRestore();
      resetProductContext();
    }
    if (
      thread.threadId === agentThread.threadId &&
      (agentThread.loadingHistory || agentThread.status !== "failed" || agentThread.messages.length > 0)
    ) {
      return;
    }
    setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
    void agentThread.loadThread(thread);
  }

  function toggleThreadSelection(threadId: string) {
    if (deletingThreadIds.has(threadId)) return;
    setSelectedThreadIds((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  function toggleThreadSelectionMode() {
    setThreadSelectionMode((current) => !current);
    setSelectedThreadIds(new Set());
    setThreadDeletionError(null);
  }

  function requestThreadDeletion(threadIds: string[]) {
    const available = [...new Set(threadIds)].filter((threadId) => !deletingThreadIds.has(threadId));
    if (!available.length) return;
    setThreadDeletionError(null);
    setDeleteDialogThreadIds(available);
  }

  async function confirmThreadDeletion() {
    if (!deleteDialogThreadIds?.length || threadDeletionSubmitting) return;
    setThreadDeletionSubmitting(true);
    setThreadDeletionError(null);
    try {
      const response = await fetch("/api/agent/thread-deletions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadIds: deleteDialogThreadIds }),
      });
      const payload = (await response.json().catch(() => null)) as { job?: ThreadDeletionJobView; error?: string } | null;
      if (!response.ok || !payload?.job) throw new Error(payload?.error || "无法创建后台删除任务。");
      setThreadDeletionJobs((current) => [...current, payload.job as ThreadDeletionJobView]);
      setSelectedThreadIds(new Set());
      setThreadSelectionMode(false);
      setDeleteDialogThreadIds(null);
    } catch (error) {
      setThreadDeletionError(error instanceof Error ? error.message : "无法创建后台删除任务。");
    } finally {
      setThreadDeletionSubmitting(false);
    }
  }

  function openCreativeSpace() {
    if (!isAuthenticated) {
      openAuthDialog("login");
      return;
    }
    if (navigationLocked) {
      return;
    }
    setDraft("");
    setFreshTaskEntry(null);
    setSubmittedDraft(null);
    setSelectedSkill(null);
    setActiveManagedEntryWorkflow(null);
    setCreativeMethod(null);
    setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
    clearComposerAttachments();
    setActiveView("creative");
    autoRestoreAttemptedRef.current = true;
    cancelThreadProductContextRestore();

    const currentProject = creativeProjects.find((project) => project.threadId === agentThread.threadId);
    if (currentProject) {
      void restoreThreadProductContext(currentProject.threadId);
      return;
    }
    resetProductContext();
    agentThread.resetThread();
    const latestProject = creativeProjects[0];
    if (latestProject) {
      void restoreThreadProductContext(latestProject.threadId);
      void agentThread.loadThread(latestProject);
    }
  }

  function startCreativeProject() {
    if (navigationLocked) return;
    setDraft("");
    setFreshTaskEntry(null);
    setSubmittedDraft(null);
    setSelectedSkill(null);
    setActiveManagedEntryWorkflow(null);
    setCreativeMethod(null);
    setProductInsightMethod("market_research");
    cancelThreadProductContextRestore();
    resetProductContext();
    setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
    clearComposerAttachments();
    setActiveView("creative");
    agentThread.resetThread();
    void threadsQuery.refetch();
  }

  function openCreativeProject(project: AgentThreadSummary) {
    if (navigationLocked || deletingThreadIds.has(project.threadId)) return;
    setDraft("");
    setFreshTaskEntry(null);
    setSelectedSkill(null);
    setActiveManagedEntryWorkflow(null);
    setCreativeMethod(null);
    setProductInsightMethod("market_research");
    setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
    clearComposerAttachments();
    setActiveView("creative");
    void restoreThreadProductContext(project.threadId);
    if (
      project.threadId === agentThread.threadId &&
      (agentThread.loadingHistory || agentThread.status !== "failed" || agentThread.messages.length > 0)
    ) {
      return;
    }
    void agentThread.loadThread(project);
  }

  function selectCreativeMethod(method: CreativeMethod) {
    if (
      navigationLocked ||
      agentThread.status === "connecting" ||
      agentThread.status === "running" ||
      agentThread.compacting
    ) return;
    setCreativeMethod(method);
    setDraft(creativeMethodStarterPrompt(method));
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>("[data-conversation-input]");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function reviseCreativeCanvasNode(request: NonNullable<CanvasRevisionRequest>) {
    if (navigationLocked) return;
    if (isCreativeMethod(request.deliverableType)) setCreativeMethod(request.deliverableType);
    const nextDraft = `请修改画布节点《${request.title}》：`;
    setDraft(nextDraft);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>(
        "[data-creative-conversation] [data-conversation-input]",
      );
      input?.focus();
      input?.setSelectionRange(nextDraft.length, nextDraft.length);
    });
  }

  function openProductInsights() {
    if (!isAuthenticated) {
      openAuthDialog("login");
      return;
    }
    if (navigationLocked) return;
    setDraft("");
    setSubmittedDraft(null);
    setSelectedSkill(null);
    setActiveManagedEntryWorkflow(null);
    setCreativeMethod(null);
    setProductInsightMethod("market_research");
    clearComposerAttachments();
    setActiveView("research");
    cancelThreadProductContextRestore();
    resetProductContext();
    setFreshTaskEntry("research");
    startTransition(() => {
      setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
      agentThread.resetThread();
      setFreshTaskEntry(null);
    });
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();
    });
  }

  function selectProductInsightMethod(method: ProductInsightMethod) {
    if (navigationLocked || agentThread.threadId) return;
    setProductInsightMethod(method);
    setDraft("");
  }

  async function executeProductInsight(method: ProductInsightMethod, goal: string) {
    const attachmentsForSubmit = takeComposerAttachments();
    const skillForSubmit = selectedSkill;
    setSelectedSkill(null);
    const submitted = await agentThread.submit(goal, {
      workflow: "commerce-product-insight",
      insightMethod: method,
      displaySkillName: productInsightSkillName(method),
      attachments: attachmentsForSubmit,
      externalDataApprovalMode,
      productIds: selectedProducts.map((product) => product.id),
      productContextMode,
    });
    if (submitted) finalizeSubmittedAttachments(attachmentsForSubmit);
    else {
      restoreComposerAttachments(attachmentsForSubmit);
      setSelectedSkill(skillForSubmit);
    }
  }

  function useSkill(skill: SkillInventoryItem) {
    if (!isAuthenticated) {
      openAuthDialog("login");
      return;
    }
    if (navigationLocked) return;
    setDraft("");
    setFreshTaskEntry(null);
    setSubmittedDraft(null);
    setSelectedSkill(skill);
    setActiveManagedEntryWorkflow(null);
    cancelThreadProductContextRestore();
    resetProductContext();
    setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
    clearComposerAttachments();
    setActiveView("workbench");
    autoRestoreAttemptedRef.current = true;
    agentThread.resetThread();
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();
    });
  }

  function openPluginFromComposer(plugin: CommercePluginInventoryItem) {
    setSelectedPluginDetailName(plugin.manifest.name);
    setActiveView("plugins");
  }

  function openProductLibrary() {
    if (!isAuthenticated) {
      openAuthDialog("login");
      return;
    }
    if (navigationLocked) return;
    setProductLibraryReturnView(activeView === "products" ? "workbench" : activeView);
    setActiveView("products");
  }

  function startProductOnboardingConversation(prompt = PRODUCT_ONBOARDING_PROMPT) {
    if (!isAuthenticated) {
      openAuthDialog("login");
      return;
    }
    if (navigationLocked) return;
    setDraft(prompt.trim() || PRODUCT_ONBOARDING_PROMPT);
    setFreshTaskEntry(null);
    setSubmittedDraft(null);
    setSelectedSkill(null);
    setActiveManagedEntryWorkflow("commerce-product-onboarding");
    cancelThreadProductContextRestore();
    resetProductContext();
    setExternalDataApprovalMode(approvalModeAfterTaskBoundary);
    clearComposerAttachments();
    setActiveView("workbench");
    autoRestoreAttemptedRef.current = true;
    agentThread.resetThread();
    void threadsQuery.refetch();
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus();
    });
  }

  function closeProductLibrary() {
    setActiveView(productLibraryReturnView === "products" ? "workbench" : productLibraryReturnView);
  }

  function resetProductContext() {
    setProductContextMode("auto");
    setSelectedProducts([]);
  }

  function cancelThreadProductContextRestore() {
    productContextRequestRef.current += 1;
    productContextAbortRef.current?.abort();
    productContextAbortRef.current = null;
  }

  async function restoreThreadProductContext(threadId: string) {
    productContextAbortRef.current?.abort();
    const controller = new AbortController();
    productContextAbortRef.current = controller;
    const requestId = productContextRequestRef.current + 1;
    productContextRequestRef.current = requestId;
    resetProductContext();
    try {
      const context = await getThreadProductContext(threadId, controller.signal);
      if (controller.signal.aborted || requestId !== productContextRequestRef.current) return;
      if (context.turnId && context.products.length) {
        setSelectedProducts(context.products);
        setProductContextMode("selected");
      } else {
        resetProductContext();
      }
    } catch {
      if (controller.signal.aborted || requestId !== productContextRequestRef.current) return;
      resetProductContext();
    } finally {
      if (requestId === productContextRequestRef.current) {
        productContextAbortRef.current = null;
      }
    }
  }

  function removeSelectedProduct(productId: string) {
    setSelectedProducts((current) => {
      const next = current.filter((product) => product.id !== productId);
      if (!next.length) setProductContextMode("auto");
      return next;
    });
  }

  function addComposerFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    setAttachmentError(null);
    if (!incoming.length) return;
    const accepted = incoming.filter(isAcceptedComposerFile);
    if (accepted.length !== incoming.length) {
      setAttachmentError("支持 PNG、JPEG、WebP、PDF、DOCX、XLSX、CSV、JSON、Markdown 和文本文件。");
      return;
    }
    if (accepted.some((file) => !file.size || file.size > 5 * 1024 * 1024)) {
      setAttachmentError("单个附件必须小于 5 MB。");
      return;
    }
    if (composerAttachments.length + accepted.length > 8) {
      setAttachmentError("每次最多添加 8 个附件。");
      return;
    }
    const totalBytes = [...composerAttachments.map((attachment) => attachment.size), ...accepted.map((file) => file.size)]
      .reduce((total, size) => total + size, 0);
    if (totalBytes > 5 * 1024 * 1024) {
      setAttachmentError("一次提交的附件总大小不能超过 5 MB。");
      return;
    }
    setComposerAttachments((current) => {
      const next = [
        ...current,
        ...accepted.map((file): PendingAttachmentUpload => {
        const kind = file.type.startsWith("image/") ? "image" : "document";
        return {
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type || guessComposerFileMimeType(file.name),
          size: file.size,
          kind,
          url: kind === "image" ? URL.createObjectURL(file) : "",
          file,
          local: true,
        };
        }),
      ];
      composerAttachmentsRef.current = next;
      return next;
    });
  }

  function removeComposerAttachment(id: string) {
    setComposerAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id);
      if (removed?.kind === "image" && removed.url.startsWith("blob:")) URL.revokeObjectURL(removed.url);
      const next = current.filter((attachment) => attachment.id !== id);
      composerAttachmentsRef.current = next;
      return next;
    });
    setAttachmentError(null);
  }

  function clearComposerAttachments() {
    for (const attachment of composerAttachmentsRef.current) {
      if (attachment.kind === "image" && attachment.url.startsWith("blob:")) URL.revokeObjectURL(attachment.url);
    }
    composerAttachmentsRef.current = [];
    setComposerAttachments([]);
    setAttachmentError(null);
  }

  function takeComposerAttachments(): PendingAttachmentUpload[] {
    const current = composerAttachmentsRef.current;
    composerAttachmentsRef.current = [];
    setComposerAttachments([]);
    setAttachmentError(null);
    return current;
  }

  function restoreComposerAttachments(attachments: PendingAttachmentUpload[]) {
    composerAttachmentsRef.current = attachments;
    setComposerAttachments(attachments);
  }

  function finalizeSubmittedAttachments(attachments: PendingAttachmentUpload[]) {
    for (const attachment of attachments) {
      if (attachment.kind === "image" && attachment.url.startsWith("blob:")) URL.revokeObjectURL(attachment.url);
    }
  }

  async function retryAssistantMessage(assistantMessageId: string): Promise<boolean> {
    const assistantMessage = agentThread.messages.find((message) => message.id === assistantMessageId);
    if (!assistantMessage) return false;
    const sourceMessage = findRetrySourceMessage(agentThread.messages, assistantMessage);
    if (!sourceMessage) return false;
    return agentThread.retryMessage(
      assistantMessageId,
      sourceMessage,
      {
        externalDataApprovalMode,
      },
    );
  }

  function renderConversationWorkspace(layout: "default" | "creative-panel" = "default") {
    return (
      <ConversationWorkspace
        title={agentThread.threadTitle || (layout === "creative-panel" ? "未命名项目" : "新任务")}
        messages={agentThread.messages}
        activities={agentThread.activities}
        images={agentThread.images}
        status={agentThread.status}
        currentTurnId={agentThread.currentTurnId}
        pendingUserInput={agentThread.pendingUserInput}
        answeringUserInput={agentThread.answeringUserInput}
        compacting={agentThread.compacting}
        queuedMessages={agentThread.queuedMessages}
        queueSubmitting={agentThread.queueSubmitting}
        runningSubmitMode={activeView === "creative" || activeView === "research" ? "steer" : "queue"}
        queueOperationId={agentThread.queueOperationId}
        feedbackSubmittingIds={agentThread.feedbackSubmittingIds}
        retryingMessageId={agentThread.retryingMessageId}
        loadingHistory={agentThread.loadingHistory}
        hasOlderHistory={agentThread.hasOlderHistory}
        loadingOlderHistory={agentThread.loadingOlderHistory}
        canInterrupt={!agentThread.compacting && Boolean(agentThread.activeTurnId)}
        interrupting={agentThread.interrupting}
        durationMs={agentThread.durationMs}
        startedAt={agentThread.startedAt}
        error={agentThread.feedbackError ?? agentThread.error}
        value={draft}
        models={modelsQuery.data?.agentModels ?? []}
        modelsLoading={modelsQuery.isLoading}
        selectedModel={selectedModel}
        reasoningEffort={reasoningEffort}
        externalDataAvailable={externalDataReady}
        externalDataApprovalMode={externalDataApprovalMode}
        canManageExternalDataPolicy={canManageExternalDataPolicy}
        productContextMode={productContextMode}
        selectedProducts={selectedProducts}
        skills={activeView === "creative" || activeView === "research" ? [] : enabledSkills}
        skillsLoading={activeView === "creative" || activeView === "research" ? false : skillsQuery.isLoading}
        plugins={enabledPlugins}
        pluginsLoading={pluginsQuery.isLoading}
        selectedSkill={activeView === "creative" || activeView === "research" ? null : selectedSkill}
        attachments={composerAttachments}
        attachmentError={attachmentError}
        onChange={setDraft}
        onSubmit={submitDraft}
        onInterrupt={agentThread.interrupt}
        onAnswerUserInput={agentThread.respondToUserInput}
        onMessageFeedback={agentThread.setMessageFeedback}
        onMessageRetry={retryAssistantMessage}
        onLoadOlderHistory={agentThread.loadOlderHistory}
        onQueueDelete={agentThread.deleteQueuedMessage}
        onQueueSteer={agentThread.steerQueuedMessage}
        onQueueClear={agentThread.clearQueuedMessages}
        onModelChange={setSelectedModel}
        onReasoningEffortChange={setReasoningEffort}
        onExternalDataApprovalModeChange={setExternalDataApprovalMode}
        onProductContextModeChange={setProductContextMode}
        onSelectedProductsChange={setSelectedProducts}
        onRemoveSelectedProduct={removeSelectedProduct}
        onOpenProductLibrary={openProductLibrary}
        onSkillSelect={setSelectedSkill}
        onSkillClear={() => setSelectedSkill(null)}
        onOpenPlugin={openPluginFromComposer}
        onAddFiles={addComposerFiles}
        onRemoveAttachment={removeComposerAttachment}
        layout={layout}
      />
    );
  }

  const sidebarProps = {
    user: authUser,
    activeView,
    canOpenEnterpriseAdmin,
    threads: threadsQuery.data?.threads ?? [],
    activeThreadId: agentThread.threadId,
    navigationLocked,
    deletingThreadIds,
    selectionMode: threadSelectionMode,
    selectedThreadIds,
    onNewTask: startNewTask,
    onOpenThread: openStoredThread,
    onToggleSelectionMode: toggleThreadSelectionMode,
    onToggleThreadSelection: toggleThreadSelection,
    onRequestThreadDeletion: requestThreadDeletion,
    onOpenProductInsights: openProductInsights,
    onOpenCreative: openCreativeSpace,
    onOpenPlugins: () => {
      setSelectedPluginDetailName(null);
      setActiveView("plugins");
    },
    onOpenSkills: () => setActiveView("skills"),
    onOpenAuth: () => openAuthDialog("login"),
    onLogout: logout,
  } satisfies SidebarProps;

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--cp-bg)] text-[var(--cp-text)]">
      {activeView !== "creative" ? (
        <Sidebar {...sidebarProps} />
      ) : null}

      <main className="relative flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        {activeView !== "creative" ? (
          <MobileTopbar
            user={authUser}
            onOpenAuth={() => openAuthDialog("login")}
            onLogout={logout}
            renderNavigation={(onNavigate) => (
              <Sidebar {...sidebarProps} mobile onNavigate={onNavigate} />
            )}
          />
        ) : null}

        {activeView === "creative" ? (
          <CreativeSpaceWorkbench
            projects={creativeProjects}
            activeProjectId={agentThread.threadId}
            messages={agentThread.messages}
            images={agentThread.images}
            navigationDisabled={navigationLocked}
            onCreateProject={startCreativeProject}
            onSelectProject={openCreativeProject}
            onBackToWorkbench={startNewTask}
            conversation={(
              <div className="flex h-full min-h-0 flex-col">
                <header className="flex min-h-[var(--cp-topbar-height)] shrink-0 items-center gap-3 border-b border-[var(--cp-border-subtle)] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--cp-text)]">
                      {agentThread.threadTitle || "Harness 对话"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--cp-text-faint)]">
                      对话、工具与历史由 Codex thread 持续保存
                    </div>
                  </div>
                  <CreativeMethodPicker
                    value={creativeMethod}
                    disabled={
                      navigationLocked ||
                      agentThread.status === "connecting" ||
                      agentThread.status === "running" ||
                      agentThread.compacting
                    }
                    onSelect={selectCreativeMethod}
                  />
                </header>
                {creativeMethod ? (
                  <div
                    className="shrink-0 border-b border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)] px-3 py-2 text-[11px] leading-4 text-[var(--cp-text-muted)]"
                    role="status"
                  >
                    {creativeMethodActiveRequirement(creativeMethod, selectedProducts.length)}
                  </div>
                ) : null}
                <CreativeCanvasComposerBridge onRequest={reviseCreativeCanvasNode} />
                {renderConversationWorkspace("creative-panel")}
              </div>
            )}
          />
        ) : activeView === "products" ? (
          <ProductLibraryWorkspace
            onBack={closeProductLibrary}
            onStartConversation={startProductOnboardingConversation}
          />
        ) : activeView === "plugins" ? (
          <PluginDirectory
            initialSelectedPluginName={selectedPluginDetailName}
            onOpenProductLibrary={openProductLibrary}
            onStartProductOnboarding={() => startProductOnboardingConversation()}
          />
        ) : activeView === "skills" ? (
          <SkillsDirectory onUseSkill={useSkill} />
        ) : activeView === "research" && (!agentThread.threadId || freshTaskEntry === "research") ? (
          <ProductInsightWorkspace
            method={productInsightMethod}
            error={agentThread.error}
            composerValue={draft}
            onComposerChange={setDraft}
            externalDataAvailable={externalDataReady}
            selectedProducts={selectedProducts}
            productContextMode={productContextMode}
            modelLabel={`${formatModelName(selectedModel)} · ${
              reasoningEffortOptions.find((option) => option.value === reasoningEffort)?.label ?? "轻度"
            }`}
            onMethodChange={selectProductInsightMethod}
            onExecute={executeProductInsight}
            renderComposer={({ placeholder, disabled, onSubmit }) => (
              <AgentComposer
                value={draft}
                placeholder={placeholder}
                running={agentThread.status === "connecting" || agentThread.status === "running"}
                canInterrupt={!agentThread.compacting && Boolean(agentThread.activeTurnId)}
                interrupting={agentThread.interrupting}
                compacting={agentThread.compacting}
                queueSubmitting={agentThread.queueSubmitting}
                runningSubmitMode="steer"
                queuedMessages={agentThread.queuedMessages}
                queueOperationId={agentThread.queueOperationId}
                models={modelsQuery.data?.agentModels ?? []}
                modelsLoading={modelsQuery.isLoading}
                selectedModel={selectedModel}
                reasoningEffort={reasoningEffort}
                externalDataAvailable={externalDataReady}
                externalDataApprovalMode={externalDataApprovalMode}
                canManageExternalDataPolicy={canManageExternalDataPolicy}
                productContextMode={productContextMode}
                selectedProducts={selectedProducts}
                plugins={enabledPlugins}
                pluginsLoading={pluginsQuery.isLoading}
                skills={[]}
                skillsLoading={false}
                selectedSkill={null}
                attachments={composerAttachments}
                attachmentError={attachmentError}
                disabled={disabled}
                onChange={setDraft}
                onSubmit={onSubmit}
                onInterrupt={agentThread.interrupt}
                onQueueDelete={agentThread.deleteQueuedMessage}
                onQueueSteer={agentThread.steerQueuedMessage}
                onQueueClear={agentThread.clearQueuedMessages}
                onModelChange={setSelectedModel}
                onReasoningEffortChange={setReasoningEffort}
                onExternalDataApprovalModeChange={setExternalDataApprovalMode}
                onProductContextModeChange={setProductContextMode}
                onSelectedProductsChange={setSelectedProducts}
                onRemoveSelectedProduct={removeSelectedProduct}
                onOpenProductLibrary={openProductLibrary}
                onOpenPlugin={openPluginFromComposer}
                onSkillSelect={setSelectedSkill}
                onSkillClear={() => setSelectedSkill(null)}
                onAddFiles={addComposerFiles}
                onRemoveAttachment={removeComposerAttachment}
              />
            )}
          />
        ) : (
        <>
        <div className="pointer-events-none sticky top-0 z-20 hidden h-[var(--cp-topbar-height)] items-center justify-center bg-[rgba(255,255,255,0.92)] md:flex">
          {isAuthenticated && !hasActiveThread ? <ModeSwitch mode={mode} onModeChange={setMode} /> : null}
          {!isAuthenticated ? (
            <TopAuthActions
              onOpenLogin={() => openAuthDialog("login")}
              onOpenRegister={() => openAuthDialog("register")}
              allowPublicRegistration={allowPublicRegistration}
            />
          ) : null}
        </div>

        {isAuthenticated && hasActiveThread ? renderConversationWorkspace() : (
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
                externalDataAvailable={externalDataReady}
                externalDataApprovalMode={externalDataApprovalMode}
                canManageExternalDataPolicy={canManageExternalDataPolicy}
                productContextMode={productContextMode}
                selectedProducts={selectedProducts}
                skills={enabledSkills}
                skillsLoading={skillsQuery.isLoading}
                plugins={enabledPlugins}
                pluginsLoading={pluginsQuery.isLoading}
                selectedSkill={selectedSkill}
                attachments={composerAttachments}
                attachmentError={attachmentError}
                onChange={setDraft}
                onSubmit={submitDraft}
                onModelChange={setSelectedModel}
                onReasoningEffortChange={setReasoningEffort}
                onExternalDataApprovalModeChange={setExternalDataApprovalMode}
                onProductContextModeChange={setProductContextMode}
                onSelectedProductsChange={setSelectedProducts}
                onRemoveSelectedProduct={removeSelectedProduct}
                onOpenProductLibrary={openProductLibrary}
                onSkillSelect={setSelectedSkill}
                onSkillClear={() => setSelectedSkill(null)}
                onOpenPlugin={openPluginFromComposer}
                onAddFiles={addComposerFiles}
                onRemoveAttachment={removeComposerAttachment}
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
        </>
        )}
      </main>

      {threadDeletionError && !deleteDialogThreadIds ? (
        <div
          className="fixed bottom-5 left-1/2 z-[80] flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 items-center gap-2 rounded-[8px] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2.5 text-sm text-[var(--cp-text)] shadow-[var(--cp-shadow-popover)]"
          role="alert"
        >
          <CircleAlert className="size-4 shrink-0 text-[var(--cp-danger)]" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">{threadDeletionError}</span>
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-[var(--cp-radius-xs)] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)]"
            aria-label="关闭删除错误提示"
            onClick={() => setThreadDeletionError(null)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {authDialogOpen ? (
        <AuthDialog
          initialMode={authDialogMode}
          allowPublicRegistration={allowPublicRegistration}
          onClose={() => setAuthDialogOpen(false)}
          onAuthenticated={async () => {
            await sessionQuery.refetch();
            setAuthDialogOpen(false);
          }}
        />
      ) : null}
      {deleteDialogThreadIds ? (
        <ThreadDeletionDialog
          threadIds={deleteDialogThreadIds}
          threads={threadsQuery.data?.threads ?? []}
          submitting={threadDeletionSubmitting}
          error={threadDeletionError}
          onClose={() => {
            if (!threadDeletionSubmitting) setDeleteDialogThreadIds(null);
          }}
          onConfirm={confirmThreadDeletion}
        />
      ) : null}
    </div>
  );
}

function isCreativeProjectThread(thread: AgentThreadSummary): boolean {
  return thread.recipeId === "creative_project" || thread.recipeId === "copywriting";
}

function isProductInsightThread(thread: AgentThreadSummary): boolean {
  return productInsightMethodForRecipeId(thread.recipeId) !== null;
}

function productInsightMethodForThread(thread: AgentThreadSummary): ProductInsightMethod {
  return productInsightMethodForRecipeId(thread.recipeId) ?? "market_research";
}

function isProductOnboardingThread(thread: AgentThreadSummary): boolean {
  return thread.recipeId === "product_onboarding";
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
        。任务内容可能按隐私政策进行必要的安全与质量审核；未经另行告知和适用授权，不会当然用于模型改进。
        <Link className="ml-0.5 underline underline-offset-2 hover:text-[var(--cp-text-muted)]" href="/ai-notice">
          了解更多
        </Link>
      </p>
    </footer>
  );
}

function ConversationWorkspace({
  title,
  messages,
  activities,
  images,
  status,
  currentTurnId,
  pendingUserInput,
  answeringUserInput,
  compacting,
  queuedMessages,
  queueSubmitting,
  runningSubmitMode,
  queueOperationId,
  feedbackSubmittingIds,
  retryingMessageId,
  loadingHistory,
  hasOlderHistory,
  loadingOlderHistory,
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
  externalDataAvailable,
  externalDataApprovalMode,
  canManageExternalDataPolicy,
  productContextMode,
  selectedProducts,
  plugins,
  pluginsLoading,
  skills,
  skillsLoading,
  selectedSkill,
  attachments,
  attachmentError,
  onChange,
  onSubmit,
  onInterrupt,
  onAnswerUserInput,
  onMessageFeedback,
  onMessageRetry,
  onLoadOlderHistory,
  onQueueDelete,
  onQueueSteer,
  onQueueClear,
  onModelChange,
  onReasoningEffortChange,
  onExternalDataApprovalModeChange,
  onProductContextModeChange,
  onSelectedProductsChange,
  onRemoveSelectedProduct,
  onOpenProductLibrary,
  onOpenPlugin,
  onSkillSelect,
  onSkillClear,
  onAddFiles,
  onRemoveAttachment,
  layout = "default",
}: {
  title: string;
  messages: ConversationMessage[];
  activities: AgentActivity[];
  images: GeneratedImageItem[];
  status: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed";
  currentTurnId: string | null;
  pendingUserInput: PendingRequestUserInput | null;
  answeringUserInput: boolean;
  compacting: boolean;
  queuedMessages: QueuedMessage[];
  queueSubmitting: boolean;
  runningSubmitMode: "queue" | "steer";
  queueOperationId: string | null;
  feedbackSubmittingIds: ReadonlySet<string>;
  retryingMessageId: string | null;
  loadingHistory: boolean;
  hasOlderHistory: boolean;
  loadingOlderHistory: boolean;
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
  externalDataAvailable: boolean;
  externalDataApprovalMode: ExternalDataApprovalMode;
  canManageExternalDataPolicy: boolean;
  productContextMode: ProductContextMode;
  selectedProducts: ProductSummary[];
  plugins: CommercePluginInventoryItem[];
  pluginsLoading: boolean;
  skills: SkillInventoryItem[];
  skillsLoading: boolean;
  selectedSkill: SkillInventoryItem | null;
  attachments: PendingAttachmentUpload[];
  attachmentError: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  onAnswerUserInput: (answers: Record<string, { answers: string[] }>) => Promise<boolean>;
  onMessageFeedback: (
    messageId: string,
    rating: AgentMessageFeedbackRating | null,
  ) => Promise<boolean>;
  onMessageRetry: (messageId: string) => Promise<boolean>;
  onLoadOlderHistory: () => Promise<boolean>;
  onQueueDelete: (queuedSubmissionId: string) => Promise<boolean>;
  onQueueSteer: (queuedSubmissionId: string) => Promise<boolean>;
  onQueueClear: () => Promise<void>;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  onExternalDataApprovalModeChange: (mode: ExternalDataApprovalMode) => void;
  onProductContextModeChange: (mode: ProductContextMode) => void;
  onSelectedProductsChange: (products: ProductSummary[]) => void;
  onRemoveSelectedProduct: (productId: string) => void;
  onOpenProductLibrary: () => void;
  onOpenPlugin: (plugin: CommercePluginInventoryItem) => void;
  onSkillSelect: (skill: SkillInventoryItem) => void;
  onSkillClear: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
  layout?: "default" | "creative-panel";
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const shouldFollowBottomRef = useRef(true);
  const scrollingToBottomRef = useRef(false);
  const minimapFrameRef = useRef<number | null>(null);
  const minimapMarkersRef = useRef<ConversationMinimapMarkerInput[]>([]);
  const minimapNeedsMeasurementRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [minimapState, setMinimapState] = useState<ConversationMinimapState>(() =>
    calculateConversationMinimap(0, 1, 1, []),
  );
  const [hoveredMinimapMarkerId, setHoveredMinimapMarkerId] = useState<string | null>(null);
  const running = !loadingHistory && (status === "connecting" || status === "running");
  const compactPanel = layout === "creative-panel";
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
  const imagesBeforeStatus = images.filter((image) => image.sequence <= latestUserSequence);
  const imagesAfterStatus = images.filter((image) => image.sequence > latestUserSequence);
  const timelineBeforeStatus = [
    ...messagesBeforeStatus.map((message) => ({ type: "message" as const, sequence: message.sequence, message })),
    ...imagesBeforeStatus.map((image) => ({ type: "image" as const, sequence: image.sequence, image })),
  ].sort((left, right) => left.sequence - right.sequence);
  const currentActivities = currentTurnId
    ? activities.filter((activity) => activity.turnId === currentTurnId)
    : [];
  const webSources = useMemo(() => collectRecentWebSources(activities), [activities]);
  const marketResearchReceipts = useMemo(() => {
    const receipts = new Map<string, MarketResearchReceipt>();
    for (const message of messages) {
      if (message.role !== "assistant" || message.phase === "commentary" || message.status !== "completed") continue;
      const report = parseMarketResearchResponse(message.content);
      if (!report || report.responseType !== "report") continue;
      for (const receipt of report.receipts) receipts.set(receipt.researchRequestId, receipt);
    }
    return [...receipts.values()];
  }, [messages]);
  const latestCurrentActivity = currentActivities.reduce<AgentActivity | null>(
    (latest, activity) => (!latest || activity.sequence > latest.sequence ? activity : latest),
    null,
  );
  const activeTimeline = [
    ...messagesAfterStatus.map((message) => ({ type: "message" as const, sequence: message.sequence, message })),
    ...imagesAfterStatus.map((image) => ({ type: "image" as const, sequence: image.sequence, image })),
    ...(running && latestCurrentActivity
      ? [{ type: "activity" as const, sequence: latestCurrentActivity.sequence, activity: latestCurrentActivity }]
      : !running && currentActivities.length > 0
        ? [
            {
              type: "activityDisclosure" as const,
              sequence: Math.min(...currentActivities.map((activity) => activity.sequence)),
              activities: currentActivities,
            },
          ]
        : []),
  ].sort((left, right) => left.sequence - right.sequence);

  const updateMinimap = useCallback(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    if (minimapNeedsMeasurementRef.current || minimapMarkersRef.current.length === 0) {
      const containerRect = node.getBoundingClientRect();
      const measuredMarkers = [
        ...node.querySelectorAll<HTMLElement>("[data-minimap-prompt]"),
      ]
        .map<ConversationMinimapMarkerInput | null>((element, index) => {
          const preview = normalizeMinimapPreview(
            element.dataset.minimapPreview || element.innerText,
          );
          const kind = readMinimapMarkerKind(element.dataset.minimapKind);
          if (!preview || !kind) {
            return null;
          }
          const elementRect = element.getBoundingClientRect();
          return {
            id: element.dataset.minimapId || `timeline-${index}`,
            offsetTop: node.scrollTop + elementRect.top - containerRect.top,
            preview,
            kind,
          };
        })
        .filter((marker): marker is ConversationMinimapMarkerInput => Boolean(marker));
      minimapMarkersRef.current = selectConversationMinimapPromptMarkers(measuredMarkers);
      minimapNeedsMeasurementRef.current = false;
    }
    setMinimapState(
      calculateConversationMinimap(
        node.scrollTop,
        node.scrollHeight,
        node.clientHeight,
        minimapMarkersRef.current,
      ),
    );
  }, []);

  const scheduleMinimapUpdate = useCallback((measureMarkers = false) => {
    if (measureMarkers) {
      minimapNeedsMeasurementRef.current = true;
    }
    if (minimapFrameRef.current !== null) {
      return;
    }
    minimapFrameRef.current = window.requestAnimationFrame(() => {
      minimapFrameRef.current = null;
      updateMinimap();
    });
  }, [updateMinimap]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    if (shouldFollowBottomRef.current) {
      node.scrollTop = node.scrollHeight;
      setShowScrollToBottom(false);
      scheduleMinimapUpdate(true);
      return;
    }
    setShowScrollToBottom(getDistanceFromBottom(node) > 80);
    scheduleMinimapUpdate(true);
  }, [activities, images, messages, scheduleMinimapUpdate, status]);

  useEffect(() => {
    const scrollNode = scrollRef.current;
    const contentNode = timelineContentRef.current;
    if (!scrollNode || !contentNode) {
      return;
    }
    const resizeObserver = new ResizeObserver(() => scheduleMinimapUpdate(true));
    resizeObserver.observe(scrollNode);
    resizeObserver.observe(contentNode);
    scheduleMinimapUpdate(true);
    return () => {
      resizeObserver.disconnect();
      if (minimapFrameRef.current !== null) {
        window.cancelAnimationFrame(minimapFrameRef.current);
        minimapFrameRef.current = null;
      }
    };
  }, [scheduleMinimapUpdate]);

  function handleConversationScroll() {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    scheduleMinimapUpdate();
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

  async function loadOlderHistory() {
    const node = scrollRef.current;
    if (!node || loadingOlderHistory) return;
    const previousHeight = node.scrollHeight;
    const loaded = await onLoadOlderHistory();
    if (!loaded) return;
    window.requestAnimationFrame(() => {
      const currentNode = scrollRef.current;
      if (!currentNode) return;
      currentNode.scrollTop += currentNode.scrollHeight - previousHeight;
      scheduleMinimapUpdate(true);
    });
  }

  return (
    <section
      data-agent-status={status}
      className={cn(
        "relative flex min-h-0 flex-1 flex-col",
        compactPanel && "bg-[var(--cp-bg)]",
      )}
    >
      {!compactPanel ? (
        <ConversationMinimap
          state={minimapState}
          scrollContainerRef={scrollRef}
          hoveredMarkerId={hoveredMinimapMarkerId}
          onHoveredMarkerChange={setHoveredMinimapMarkerId}
        />
      ) : null}
      <div
        id="commerce-conversation-scroll"
        ref={scrollRef}
        data-conversation-scroll
        className={cn(
          "min-h-0 flex-1 overscroll-contain overflow-y-auto",
          compactPanel ? "px-3 pb-4" : "px-4 pb-8 md:px-8",
        )}
        onScroll={handleConversationScroll}
      >
        <div
          ref={timelineContentRef}
          className={cn(
            "mx-auto w-full",
            compactPanel ? "max-w-none pb-8 pt-3" : "max-w-[820px] pb-12 pt-2 xl:pr-[72px]",
          )}
        >
          <h1 className="sr-only">{title}</h1>

          {loadingHistory ? (
            <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-[var(--cp-text-faint)]" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <span>正在加载对话</span>
            </div>
          ) : null}

          {!loadingHistory && hasOlderHistory ? (
            <div className="mb-5 flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-[var(--cp-text-faint)]"
                disabled={loadingOlderHistory}
                onClick={() => void loadOlderHistory()}
              >
                {loadingOlderHistory ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Clock3 className="size-3.5" aria-hidden="true" />
                )}
                更早记录
              </Button>
            </div>
          ) : null}

          {!loadingHistory ? (
            <div className="space-y-6">
              {timelineBeforeStatus.map((entry) =>
                entry.type === "message" ? (
                  <ConversationTimelineMessage
                    key={entry.message.id}
                    message={entry.message}
                    skills={skills}
                    feedbackSubmitting={feedbackSubmittingIds.has(entry.message.id)}
                    retryAvailable={Boolean(findRetrySourceMessage(messages, entry.message))}
                    retrying={retryingMessageId === entry.message.id}
                    retryDisabled={running || compacting || Boolean(retryingMessageId)}
                    onMessageFeedback={onMessageFeedback}
                    onMessageRetry={onMessageRetry}
                  />
                ) : (
                  <GeneratedImageCard key={entry.image.id} image={entry.image} />
                ),
              )}
              <ProcessingStatus
                key={startedAt ?? "no-active-turn"}
                running={running}
                compacting={compacting}
                durationMs={durationMs}
                startedAt={startedAt}
              />
              {pendingUserInput ? (
                <p className="cp-running-shimmer m-0 min-h-7 py-1 text-[13px]">正在等待你的回答</p>
              ) : null}
              {activeTimeline.length > 0 ? (
                <div className="space-y-4">
                  {activeTimeline.map((entry) =>
                    entry.type === "message" ? (
                      <ConversationTimelineMessage
                        key={entry.message.id}
                        message={entry.message}
                        skills={skills}
                        feedbackSubmitting={feedbackSubmittingIds.has(entry.message.id)}
                        retryAvailable={Boolean(findRetrySourceMessage(messages, entry.message))}
                        retrying={retryingMessageId === entry.message.id}
                        retryDisabled={running || compacting || Boolean(retryingMessageId)}
                        onMessageFeedback={onMessageFeedback}
                        onMessageRetry={onMessageRetry}
                      />
                    ) : entry.type === "image" ? (
                      <GeneratedImageCard key={entry.image.id} image={entry.image} />
                    ) : entry.type === "activity" ? (
                      <ActivityRow key="current-turn-activity" activity={entry.activity} />
                    ) : (
                      <ActivityDisclosure
                        key={`activity-disclosure-${currentTurnId ?? "completed"}`}
                        activities={entry.activities}
                      />
                    ),
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-[var(--cp-radius-item)] bg-[var(--cp-danger-bg)] px-4 py-3 text-sm text-[var(--cp-danger)]" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      {!compactPanel ? (
        <WorkOutputPanel
          images={images}
          sources={webSources}
          activities={activities}
          reportReceipts={marketResearchReceipts}
        />
      ) : null}

      <div
        className={cn(
          "relative shrink-0 bg-[var(--cp-bg)] pb-3 pt-2",
          compactPanel ? "px-3" : "px-4 md:px-8",
        )}
      >
        {!compactPanel ? (
          <ResearchEvidenceMobileSheet
            activities={activities}
            reportReceipts={marketResearchReceipts}
            webSources={webSources}
          />
        ) : null}
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
        {pendingUserInput ? (
          <AgentRequestUserInputPanel
            key={pendingUserInput.requestId}
            questions={pendingUserInput.questions}
            submitting={answeringUserInput}
            submitLabel="确认"
            onSubmit={async (answers) => {
              await onAnswerUserInput(answers);
            }}
          />
        ) : (
          <>
            <p className="mx-auto mb-2 max-w-[768px] text-center text-[11px] text-[var(--cp-text-faint)]">
              Commerce Pilot 也可能会犯错。请核查重要信息。
            </p>
            <AgentComposer
              compact={compactPanel}
              value={value}
              placeholder={
                running && canInterrupt
                  ? "输入调整方向"
                  : compactPanel && messages.length === 0
                    ? "选择创作类型，或直接描述想生成的内容"
                    : "继续追问"
              }
              running={running}
              canInterrupt={canInterrupt}
              interrupting={interrupting}
              compacting={compacting}
              queueSubmitting={queueSubmitting}
              runningSubmitMode={runningSubmitMode}
              queuedMessages={queuedMessages}
              queueOperationId={queueOperationId}
              models={models}
              modelsLoading={modelsLoading}
              selectedModel={selectedModel}
              reasoningEffort={reasoningEffort}
              externalDataAvailable={externalDataAvailable}
              externalDataApprovalMode={externalDataApprovalMode}
              canManageExternalDataPolicy={canManageExternalDataPolicy}
              productContextMode={productContextMode}
              selectedProducts={selectedProducts}
              skills={skills}
              skillsLoading={skillsLoading}
              plugins={plugins}
              pluginsLoading={pluginsLoading}
              selectedSkill={selectedSkill}
              attachments={attachments}
              attachmentError={attachmentError}
              onChange={onChange}
              onSubmit={onSubmit}
              onInterrupt={onInterrupt}
              onQueueDelete={onQueueDelete}
              onQueueSteer={onQueueSteer}
              onQueueClear={onQueueClear}
              onModelChange={onModelChange}
              onReasoningEffortChange={onReasoningEffortChange}
              onExternalDataApprovalModeChange={onExternalDataApprovalModeChange}
              onProductContextModeChange={onProductContextModeChange}
              onSelectedProductsChange={onSelectedProductsChange}
              onRemoveSelectedProduct={onRemoveSelectedProduct}
              onOpenProductLibrary={onOpenProductLibrary}
              onSkillSelect={onSkillSelect}
              onSkillClear={onSkillClear}
              onOpenPlugin={onOpenPlugin}
              onAddFiles={onAddFiles}
              onRemoveAttachment={onRemoveAttachment}
            />
          </>
        )}
      </div>
    </section>
  );
}

function AgentComposer({
  compact = false,
  value,
  placeholder,
  running,
  canInterrupt,
  interrupting,
  compacting,
  queueSubmitting,
  runningSubmitMode = "queue",
  queuedMessages,
  queueOperationId,
  models,
  modelsLoading,
  selectedModel,
  reasoningEffort,
  externalDataAvailable = false,
  externalDataApprovalMode = "always_ask",
  canManageExternalDataPolicy = false,
  productContextMode,
  selectedProducts,
  plugins = [],
  pluginsLoading = false,
  skills = [],
  skillsLoading = false,
  selectedSkill = null,
  attachments = [],
  attachmentError = null,
  disabled = false,
  onChange,
  onSubmit,
  onInterrupt,
  onQueueDelete,
  onQueueSteer,
  onQueueClear,
  onModelChange,
  onReasoningEffortChange,
  onExternalDataApprovalModeChange = () => undefined,
  onProductContextModeChange,
  onSelectedProductsChange,
  onRemoveSelectedProduct,
  onOpenProductLibrary,
  onOpenPlugin = () => undefined,
  onSkillSelect = () => undefined,
  onSkillClear = () => undefined,
  onAddFiles = () => undefined,
  onRemoveAttachment = () => undefined,
}: {
  compact?: boolean;
  value: string;
  placeholder: string;
  running: boolean;
  canInterrupt: boolean;
  interrupting: boolean;
  compacting: boolean;
  queueSubmitting: boolean;
  runningSubmitMode?: "queue" | "steer";
  queuedMessages: QueuedMessage[];
  queueOperationId: string | null;
  models: ProviderModelSummary[];
  modelsLoading: boolean;
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  externalDataAvailable?: boolean;
  externalDataApprovalMode?: ExternalDataApprovalMode;
  canManageExternalDataPolicy?: boolean;
  productContextMode: ProductContextMode;
  selectedProducts: ProductSummary[];
  plugins?: CommercePluginInventoryItem[];
  pluginsLoading?: boolean;
  skills?: SkillInventoryItem[];
  skillsLoading?: boolean;
  selectedSkill?: SkillInventoryItem | null;
  attachments?: PendingAttachmentUpload[];
  attachmentError?: string | null;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
  onQueueDelete: (queuedSubmissionId: string) => Promise<boolean>;
  onQueueSteer: (queuedSubmissionId: string) => Promise<boolean>;
  onQueueClear: () => Promise<void>;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  onExternalDataApprovalModeChange?: (mode: ExternalDataApprovalMode) => void;
  onProductContextModeChange: (mode: ProductContextMode) => void;
  onSelectedProductsChange: (products: ProductSummary[]) => void;
  onRemoveSelectedProduct: (productId: string) => void;
  onOpenProductLibrary: () => void;
  onOpenPlugin?: (plugin: CommercePluginInventoryItem) => void;
  onSkillSelect?: (skill: SkillInventoryItem) => void;
  onSkillClear?: () => void;
  onAddFiles?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeComposerPopover, setActiveComposerPopover] = useState<ComposerPopoverId | null>(null);
  const productPickerBoundary = compact
    ? formRef.current?.closest<HTMLElement>("[data-creative-conversation]") ?? null
    : null;
  const skillSelector = useComposerSkillSelector({
    value,
    skills,
    selectedSkill,
    disabled: disabled || running,
    inputRef,
    rootRef: formRef,
    onChange,
    onSelect: onSkillSelect,
  });

  useEffect(() => {
    if (skillSelector.open) setActiveComposerPopover(null);
  }, [skillSelector.open]);

  useLayoutEffect(() => {
    if (!inputRef.current) return;
    resizeTextarea(inputRef.current, 60, 120);
  }, [value]);

  function returnQueuedMessageToComposer(message: QueuedMessage): void {
    const previousValue = value;
    onChange(message.content);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(message.content.length, message.content.length);
    });
    void onQueueDelete(message.id).then((deleted) => {
      if (!deleted) onChange(previousValue);
    });
  }

  return (
    <>
      {running && queuedMessages.length > 0 ? (
        <QueuedSubmissionList
          messages={queuedMessages}
          operationId={queueOperationId}
          onReturnToComposer={returnQueuedMessageToComposer}
          onDelete={onQueueDelete}
          onSteer={onQueueSteer}
          onClear={onQueueClear}
        />
      ) : null}
      <form
        ref={formRef}
        className="relative mx-auto grid min-h-[92px] max-h-[260px] w-full max-w-[768px] grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_36px] items-end gap-x-1 gap-y-1 rounded-[24px] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-2 py-2 shadow-[var(--cp-shadow-composer)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && (!running || canInterrupt)) void onSubmit();
        }}
      >
        <ComposerAddMenu
          open={skillSelector.open}
          source={skillSelector.source}
          query={skillSelector.query}
          plugins={plugins}
          pluginsLoading={pluginsLoading}
          skills={skillSelector.filteredSkills}
          activeIndex={skillSelector.activeIndex}
          loading={skillsLoading}
          selectedSkill={selectedSkill}
          onSelect={skillSelector.selectSkill}
          onActiveIndexChange={skillSelector.setActiveIndex}
          onOpenPlugin={onOpenPlugin}
          onAddFiles={() => {
            skillSelector.closeMenu();
            fileInputRef.current?.click();
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.txt,.md,.csv,.json,.xml,.html,.htm,.yaml,.yml,.log"
          className="hidden"
          aria-label="选择文件和图片"
          onChange={(event) => {
            if (event.target.files?.length) onAddFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <div className="col-start-1 row-start-2 flex items-center gap-0.5">
          <IconTooltip label="添加">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="添加"
              aria-expanded={skillSelector.open}
              disabled={disabled || running}
              onClick={() => {
                setActiveComposerPopover(null);
                skillSelector.toggleMenu();
              }}
            >
              <Plus className="size-5" />
            </Button>
          </IconTooltip>
          <ExternalDataAccessControl
            compact={compact}
            value={externalDataApprovalMode}
            available={externalDataAvailable}
            showEnterpriseSettings={canManageExternalDataPolicy}
            open={activeComposerPopover === "access"}
            disabled={disabled || running}
            placement="top"
            onChange={onExternalDataApprovalModeChange}
            onOpenChange={(nextOpen) => {
              if (nextOpen) skillSelector.closeMenu();
              setActiveComposerPopover((current) =>
                nextOpen ? "access" : current === "access" ? null : current,
              );
            }}
          />
          <ProductLibraryPicker
            open={activeComposerPopover === "products"}
            disabled={disabled || running}
            placement="top"
            compact={compact}
            collisionBoundary={productPickerBoundary}
            mode={productContextMode}
            selectedProducts={selectedProducts}
            onOpenChange={(nextOpen) => {
              if (nextOpen) skillSelector.closeMenu();
              setActiveComposerPopover((current) =>
                nextOpen ? "products" : current === "products" ? null : current,
              );
            }}
            onModeChange={onProductContextModeChange}
            onSelectedProductsChange={onSelectedProductsChange}
            onManage={onOpenProductLibrary}
          />
        </div>
        <div className="col-span-3 col-start-1 row-start-1 min-w-0 px-3 pt-1">
          {selectedSkill ? (
            <div className="mb-1.5 flex min-w-0">
              <SelectedSkillChip skill={selectedSkill} onRemove={onSkillClear} />
            </div>
          ) : null}
          {productContextMode === "selected" && selectedProducts.length ? (
            <SelectedProductChips
              products={selectedProducts}
              compact={compact}
              disabled={disabled || running}
              onRemove={onRemoveSelectedProduct}
            />
          ) : null}
          {attachments.length || attachmentError ? (
            <ComposerAttachmentStrip
              attachments={attachments}
              error={attachmentError}
              onRemove={onRemoveAttachment}
            />
          ) : null}
          <textarea
            ref={inputRef}
            data-conversation-input
            rows={1}
            value={value}
            onChange={(event) => skillSelector.handleChange(event.target.value, event.target.selectionStart)}
            onKeyDown={(event) => {
              if (skillSelector.handleKeyDown(event)) return;
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229 &&
                !disabled &&
                (!running || canInterrupt)
              ) {
                event.preventDefault();
                if (value.trim() || attachments.length) void onSubmit();
              }
            }}
            placeholder={placeholder}
            className="cp-composer-textarea block min-h-[60px] max-h-[120px] w-full min-w-0 resize-none overflow-y-hidden border-0 bg-transparent px-2 py-1.5 text-[14px] leading-5 text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)]"
            aria-label={placeholder}
            disabled={disabled}
          />
        </div>
        <div className="col-start-3 row-start-2 flex items-center gap-1">
          <ModelAndReasoningControl
            compact={compact}
            models={models}
            loading={modelsLoading}
            selectedModel={selectedModel}
            reasoningEffort={reasoningEffort}
            open={activeComposerPopover === "model"}
            disabled={running || disabled}
            placement="top"
            onModelChange={onModelChange}
            onReasoningEffortChange={onReasoningEffortChange}
            onOpenChange={(nextOpen) => {
              if (nextOpen) skillSelector.closeMenu();
              setActiveComposerPopover((current) =>
                nextOpen ? "model" : current === "model" ? null : current,
              );
            }}
          />
          <IconTooltip label="语音输入暂不可用">
            <span className="inline-flex">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="语音输入暂不可用"
                disabled
              >
                <Mic />
              </Button>
            </span>
          </IconTooltip>
          {running && canInterrupt ? (
            <>
              {value.trim() ? (
                <IconTooltip label={runningSubmitMode === "steer" ? "调整当前方向" : "加入任务队列"}>
                  <Button
                    type="submit"
                    size="icon"
                    className="rounded-full"
                    aria-label={runningSubmitMode === "steer" ? "调整当前方向" : "加入任务队列"}
                    disabled={queueSubmitting || disabled}
                  >
                    {queueSubmitting ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                  </Button>
                </IconTooltip>
              ) : null}
              <IconTooltip label="停止">
                <Button type="button" size="icon" className="rounded-full" aria-label="停止" disabled={interrupting} onClick={onInterrupt}>
                  {interrupting ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-3.5 fill-current" />}
                </Button>
              </IconTooltip>
            </>
          ) : running ? (
            <IconTooltip label={compacting ? "正在整理上下文" : "正在启动任务"}>
              <Button type="button" size="icon" className="rounded-full" aria-label={compacting ? "正在整理上下文" : "正在启动任务"} disabled>
                <Loader2 className="size-4 animate-spin" />
              </Button>
            </IconTooltip>
          ) : (
            <IconTooltip label="发送">
              <Button type="submit" size="icon" className="rounded-full" aria-label="发送" disabled={disabled || (!value.trim() && !attachments.length)}>
                <ArrowUp />
              </Button>
            </IconTooltip>
          )}
        </div>
      </form>
    </>
  );
}

function getDistanceFromBottom(node: HTMLDivElement): number {
  return Math.max(0, node.scrollHeight - node.scrollTop - node.clientHeight);
}

function ConversationMinimap({
  state,
  scrollContainerRef,
  hoveredMarkerId,
  onHoveredMarkerChange,
}: {
  state: ConversationMinimapState;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  hoveredMarkerId: string | null;
  onHoveredMarkerChange: (markerId: string | null) => void;
}) {
  const [hoveredMarkerTopPercent, setHoveredMarkerTopPercent] = useState(50);
  if (!state.visible) {
    return null;
  }
  const hoveredMarker = state.markers.find((marker) => marker.id === hoveredMarkerId) ?? null;
  const hoveredMarkerIndex = hoveredMarker
    ? state.markers.findIndex((marker) => marker.id === hoveredMarker.id)
    : -1;

  function scrollToPosition(scrollPercent: number, behavior: ScrollBehavior = "auto") {
    const node = scrollContainerRef.current;
    if (!node) {
      return;
    }
    const maximum = Math.max(0, node.scrollHeight - node.clientHeight);
    node.scrollTo({ top: maximum * clampPercent(scrollPercent) / 100, behavior });
  }

  function handleTrackPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-minimap-marker]")) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    scrollToPosition(((event.clientY - rect.top) / Math.max(1, rect.height)) * 100);
  }

  function handleMarkerStackPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const stackRect = event.currentTarget.getBoundingClientRect();
    const railRect = event.currentTarget.parentElement?.getBoundingClientRect();
    const markerPitch = 10;
    const markerIndex = Math.min(
      state.markers.length - 1,
      Math.max(0, Math.round((event.clientY - stackRect.top - 5) / markerPitch)),
    );
    const closestMarker = state.markers[markerIndex];
    if (closestMarker && closestMarker.id !== hoveredMarkerId) {
      onHoveredMarkerChange(closestMarker.id);
    }
    if (railRect) {
      setHoveredMarkerTopPercent(
        Math.min(
          92,
          Math.max(8, ((event.clientY - railRect.top) / Math.max(1, railRect.height)) * 100),
        ),
      );
    }
  }

  function scrollToMarker(marker: ConversationMinimapMarker) {
    const node = scrollContainerRef.current;
    if (!node) {
      return;
    }
    node.scrollTo({
      top: Math.max(0, marker.offsetTop - node.clientHeight * 0.12),
      behavior: "smooth",
    });
  }

  function handleScrollbarKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const node = scrollContainerRef.current;
    if (!node) {
      return;
    }
    const deltaByKey: Partial<Record<string, number>> = {
      ArrowUp: -80,
      ArrowDown: 80,
      PageUp: -node.clientHeight * 0.8,
      PageDown: node.clientHeight * 0.8,
    };
    if (event.key === "Home") {
      event.preventDefault();
      node.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
      return;
    }
    const delta = deltaByKey[event.key];
    if (typeof delta === "number") {
      event.preventDefault();
      node.scrollBy({ top: delta, behavior: "smooth" });
    }
  }

  return (
    <aside
      className="pointer-events-none absolute bottom-4 left-3 top-4 z-30 hidden w-9 lg:block"
      aria-label="对话时间线导航"
    >
      <div
        role="scrollbar"
        tabIndex={0}
        aria-controls="commerce-conversation-scroll"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(state.scrollPercent)}
        className="pointer-events-auto relative h-full w-8 cursor-pointer rounded-[var(--cp-radius-xs)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--cp-focus)]"
        onPointerDown={handleTrackPointerDown}
        onKeyDown={handleScrollbarKeyDown}
      >
        <span
          className="pointer-events-none absolute left-[2px] w-px rounded-full bg-[var(--cp-border-subtle)]"
          style={{
            top: `${state.viewportStartPercent}%`,
            height: `${Math.max(1, state.viewportSizePercent)}%`,
          }}
          aria-hidden="true"
        />
        <div
          data-minimap-marker-stack
          className="absolute left-0 top-1/2 flex max-h-[50dvh] w-8 -translate-y-1/2 flex-col items-start gap-2 overflow-clip py-1"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={handleMarkerStackPointerMove}
          onPointerLeave={() => onHoveredMarkerChange(null)}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("[data-minimap-marker]")) {
              return;
            }
            if (hoveredMarker) {
              scrollToMarker(hoveredMarker);
            }
          }}
        >
          {state.markers.map((marker, markerIndex) => (
            <button
              key={marker.id}
              type="button"
              tabIndex={-1}
              data-minimap-marker
              className="relative h-0.5 w-8 shrink-0 bg-transparent p-0"
              aria-label={`跳转到${minimapKindLabel(marker.kind)}：${marker.preview}`}
              onFocus={(event) => {
                onHoveredMarkerChange(marker.id);
                const railRect = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                const markerRect = event.currentTarget.getBoundingClientRect();
                if (railRect) {
                  setHoveredMarkerTopPercent(
                    Math.min(
                      92,
                      Math.max(
                        8,
                        ((markerRect.top + markerRect.height / 2 - railRect.top) /
                          Math.max(1, railRect.height)) *
                          100,
                      ),
                    ),
                  );
                }
              }}
              onBlur={() => onHoveredMarkerChange(null)}
              onClick={() => scrollToMarker(marker)}
            >
              <span
                className={cn(
                  "pointer-events-none absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[var(--cp-border-strong)] transition-[width,background-color] duration-150 ease-out motion-reduce:transition-none",
                  hoveredMarkerId === marker.id && "bg-[var(--cp-text)]",
                )}
                style={{
                  width: `${calculateConversationMinimapMarkerWidth(markerIndex, hoveredMarkerIndex)}px`,
                }}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </div>

      {hoveredMarker ? (
        <div
          className="pointer-events-none absolute left-9 w-[260px] rounded-[8px] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] px-3 py-2.5 shadow-[var(--cp-shadow-popover)]"
          style={{
            top: `${hoveredMarkerTopPercent}%`,
            transform: "translateY(-50%)",
          }}
          role="status"
        >
          <div className="mb-1 text-[11px] text-[var(--cp-text-faint)]">
            {minimapKindLabel(hoveredMarker.kind)}
          </div>
          <div className="max-h-[92px] overflow-hidden whitespace-pre-wrap text-[13px] leading-5 text-[var(--cp-text-soft)]">
            {hoveredMarker.preview}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function minimapKindLabel(kind: ConversationMinimapMarker["kind"]): string {
  if (kind === "user") {
    return "用户消息";
  }
  if (kind === "assistant") {
    return "回复";
  }
  if (kind === "image") {
    return "生成图片";
  }
  if (kind === "status") {
    return "处理状态";
  }
  return "运行活动";
}

function readMinimapMarkerKind(value: string | undefined): ConversationMinimapMarker["kind"] | null {
  return value === "user" ||
    value === "assistant" ||
    value === "activity" ||
    value === "image" ||
    value === "status"
    ? value
    : null;
}

function normalizeMinimapPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 220)}…` : normalized;
}

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

function resizeTextarea(node: HTMLTextAreaElement, minHeight: number, maxHeight: number): number {
  node.style.height = "0px";
  const nextHeight = Math.min(Math.max(node.scrollHeight, minHeight), maxHeight);
  node.style.height = `${nextHeight}px`;
  node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  return nextHeight;
}

function ConversationTimelineMessage({
  message,
  skills,
  feedbackSubmitting,
  retryAvailable,
  retrying,
  retryDisabled,
  onMessageFeedback,
  onMessageRetry,
}: {
  message: ConversationMessage;
  skills: SkillInventoryItem[];
  feedbackSubmitting: boolean;
  retryAvailable: boolean;
  retrying: boolean;
  retryDisabled: boolean;
  onMessageFeedback: (
    messageId: string,
    rating: AgentMessageFeedbackRating | null,
  ) => Promise<boolean>;
  onMessageRetry: (messageId: string) => Promise<boolean>;
}) {
  const canvasNavigation = useCreativeCanvasNavigation();
  const canvasRefs = canvasNavigation?.refsForMessage(message.id) ?? [];
  const registerMessage = useCallback((element: HTMLDivElement | null) => {
    canvasNavigation?.registerConversationMessage(message.id, element);
  }, [canvasNavigation, message.id]);
  const preview = readConversationMessagePreview(message);
  return (
    <div
      ref={registerMessage}
      data-conversation-minimap-anchor
      data-minimap-prompt={message.role === "user" ? "" : undefined}
      data-minimap-id={`message-${message.id}`}
      data-minimap-kind={message.role}
      data-minimap-preview={preview}
    >
      <ConversationMessageView message={message} skills={skills} />
      {message.role === "assistant" && message.phase !== "commentary" && canvasRefs.length > 0 ? (
        <CreativeCanvasMessageLinks
          refs={canvasRefs}
          onFocus={(nodeId) => canvasNavigation?.requestCanvasFocus(nodeId)}
        />
      ) : null}
      {message.role === "assistant" &&
      message.phase !== "commentary" &&
      message.status === "completed" &&
      message.content.trim() ? (
        <AssistantMessageActions
          messageId={message.id}
          copyText={readAssistantResponseText(message)}
          feedback={message.feedback ?? null}
          feedbackSubmitting={feedbackSubmitting}
          retrying={retrying}
          retryDisabled={!retryAvailable || retryDisabled}
          onFeedback={onMessageFeedback}
          onRetry={onMessageRetry}
        />
      ) : null}
    </div>
  );
}

function CreativeCanvasMessageLinks({
  refs,
  onFocus,
}: {
  refs: CreativeCanvasMessageReference[];
  onFocus: (nodeId: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="本回复的画布内容">
      {refs.map((ref) => (
        <button
          key={ref.nodeId}
          type="button"
          className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-[var(--cp-radius-item)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-2.5 text-[11px] text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          onClick={() => onFocus(ref.nodeId)}
        >
          {ref.nodeType === "image" ? (
            <ImageIcon className="size-3.5 shrink-0" />
          ) : ref.nodeType === "table" ? (
            <ListRestart className="size-3.5 shrink-0" />
          ) : (
            <FileText className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{ref.title}</span>
          <LocateFixed className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function ComposerAttachmentStrip({
  attachments,
  error,
  onRemove,
}: {
  attachments: PendingAttachmentUpload[];
  error: string | null;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mb-2 min-w-0">
      {attachments.length ? (
        <div className="cp-flat-scrollbar flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="待发送附件">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative flex h-14 min-w-[156px] max-w-[220px] shrink-0 items-center gap-2 rounded-[8px] border border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] p-1.5 pr-8"
            >
              {attachment.kind === "image" ? (
                <img
                  src={attachment.url}
                  alt={attachment.name}
                  className="size-11 shrink-0 rounded-[6px] object-cover"
                />
              ) : (
                <span className="flex size-11 shrink-0 items-center justify-center rounded-[6px] bg-[var(--cp-surface)] text-[var(--cp-text-muted)]">
                  <FileText className="size-5" strokeWidth={1.7} />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-[var(--cp-text)]">{attachment.name}</span>
                <span className="mt-0.5 block text-[10px] text-[var(--cp-text-faint)]">{formatFileSize(attachment.size)}</span>
              </span>
              <button
                type="button"
                className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)]"
                aria-label={`移除附件 ${attachment.name}`}
                onClick={() => onRemove(attachment.id)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="m-0 mt-1 text-xs leading-5 text-[var(--cp-danger)]">{error}</p> : null}
    </div>
  );
}

function ConversationAttachmentList({ attachments }: { attachments: ConversationAttachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="mb-2 flex max-w-full flex-wrap justify-end gap-2" aria-label="消息附件">
      {attachments.map((attachment) =>
        attachment.kind === "image" ? (
          <a
            key={attachment.id}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-[8px] border border-[var(--cp-border)] bg-[var(--cp-surface)]"
            aria-label={`查看图片 ${attachment.name}`}
          >
            <img src={attachment.url} alt={attachment.name} className="h-[88px] w-[112px] object-cover" />
          </a>
        ) : (
          <a
            key={attachment.id}
            href={attachment.url}
            className="flex h-12 max-w-[240px] items-center gap-2 rounded-[8px] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-2.5 text-left no-underline"
            download={attachment.name}
          >
            <FileText className="size-5 shrink-0 text-[var(--cp-text-muted)]" strokeWidth={1.7} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-[var(--cp-text)]">{attachment.name}</span>
              <span className="block text-[10px] text-[var(--cp-text-faint)]">{formatFileSize(attachment.size)}</span>
            </span>
          </a>
        ),
      )}
    </div>
  );
}

function ConversationMessageView({
  message,
  skills,
}: {
  message: ConversationMessage;
  skills: SkillInventoryItem[];
}) {
  if (message.role === "user") {
    const content = readConversationUserContent(message.content);
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[75%] whitespace-pre-wrap rounded-[18px] bg-[var(--cp-user-message-bg)] px-4 py-2.5 text-sm leading-6 text-[var(--cp-user-message-text)]">
          <ConversationAttachmentList attachments={message.attachments ?? []} />
          {message.skillName ? (
            <SelectedSkillChip
              skill={{
                name: message.skillName,
                displayName: skills.find((skill) => skill.name === message.skillName)?.displayName,
              }}
              inlineMessage
            />
          ) : null}
          {content}
        </div>
        {message.variant === "steer" && message.delivery === "pending" ? (
          <span className="cp-running-shimmer pr-2 text-[11px] text-[var(--cp-text-faint)]">
            正在调整
          </span>
        ) : null}
      </div>
    );
  }

  if (!message.content) {
    return null;
  }

  if (message.artifactStatus === "missing_image") {
    return <MissingImageArtifactNotice />;
  }

  const marketResearchResponse = parseMarketResearchResponse(message.content);
  if (marketResearchResponse) return <MarketResearchReportView response={marketResearchResponse} />;
  const copywritingDraft = tryParseStructuredCopywritingDraft(message.content);
  if (copywritingDraft) return <CopywritingDraftResponse draft={copywritingDraft} />;
  const content = tryParseStructuredCopywritingAnswer(message.content) ?? message.content;

  return (
    <div
      className={cn(
        "text-[14px] leading-6 text-[var(--cp-text)]",
        message.phase === "commentary" && "text-[13px] font-medium leading-5 text-[var(--cp-text)]",
      )}
    >
      <AssistantMarkdown content={content} />
    </div>
  );
}

function MissingImageArtifactNotice() {
  return (
    <div className="flex items-start gap-2 text-[13px] leading-5 text-[var(--cp-warning)]" role="alert">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <div>
        <div className="font-medium">图片未生成</div>
        <p className="mb-0 mt-1 text-[var(--cp-text-muted)]">
          本轮只有图片说明，没有完成原生图片制品。请重新生成后再使用。
        </p>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function isAcceptedComposerFile(file: File): boolean {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  return new Set([
    ".png", ".jpg", ".jpeg", ".webp", ".pdf", ".docx", ".xlsx", ".txt", ".md", ".csv",
    ".json", ".xml", ".html", ".htm", ".yaml", ".yml", ".log",
  ]).has(extension);
}

function guessComposerFileMimeType(filename: string): string {
  const extension = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".json": "application/json",
    ".md": "text/markdown",
    ".xml": "application/xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
  };
  return mimeTypes[extension] ?? "text/plain";
}

function CopywritingDraftResponse({ draft }: { draft: CopywritingDraft }) {
  return (
    <article className="text-[14px] leading-6 text-[var(--cp-text)]" data-copywriting-delivery>
      <h2 className="mb-4 mt-0 text-[19px] font-semibold leading-7">{draft.title}</h2>
      <AssistantMarkdown content={draft.body} />
      {draft.callToAction ? (
        <div className="mt-5 border-t border-[var(--cp-border-subtle)] pt-4">
          <div className="mb-1 text-xs font-medium text-[var(--cp-text-muted)]">行动引导</div>
          <p className="m-0">{draft.callToAction}</p>
        </div>
      ) : null}
      {draft.complianceNotes.length ? (
        <div className="mt-5 flex items-start gap-2 border-t border-[var(--cp-border-subtle)] pt-4 text-xs leading-5 text-[var(--cp-warning)]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
          <div className="space-y-1">
            {draft.complianceNotes.map((note) => <p key={note} className="m-0">{note}</p>)}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function readConversationMessagePreview(message: ConversationMessage): string {
  if (message.role === "user") return readConversationUserContent(message.content);
  if (message.artifactStatus === "missing_image") return "图片未生成：本轮没有完成原生图片制品。";
  const marketResearchResponse = parseMarketResearchResponse(message.content);
  if (marketResearchResponse) {
    return marketResearchResponse.responseType === "report"
      ? `${marketResearchResponse.subject.title} ${marketResearchResponse.executiveSummary}`
      : marketResearchResponse.message;
  }
  const draft = tryParseStructuredCopywritingDraft(message.content);
  if (draft) return `${draft.title} ${draft.body}`;
  return tryParseStructuredCopywritingAnswer(message.content) ?? message.content;
}

function readAssistantResponseText(message: ConversationMessage): string {
  if (message.artifactStatus === "missing_image") {
    return "图片未生成\n本轮只有图片说明，没有完成原生图片制品。请重新生成后再使用。";
  }
  const marketResearchResponse = parseMarketResearchResponse(message.content);
  if (marketResearchResponse) {
    if (marketResearchResponse.responseType === "answer") return marketResearchResponse.message;
    return [
      marketResearchResponse.subject.title,
      marketResearchResponse.executiveSummary,
      marketResearchResponse.reportMarkdown,
      marketResearchResponse.message,
    ].filter(Boolean).join("\n\n");
  }
  const draft = tryParseStructuredCopywritingDraft(message.content);
  if (draft) {
    return [
      draft.title,
      draft.body,
      draft.callToAction ? `行动引导\n${draft.callToAction}` : "",
      draft.complianceNotes.length
        ? `合规备注\n${draft.complianceNotes.join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n");
  }
  return tryParseStructuredCopywritingAnswer(message.content) ?? message.content;
}

function readConversationUserContent(content: string): string {
  const followup = content.match(/用户后续消息：([\s\S]+)$/)?.[1]?.trim();
  if (followup) return followup;
  const legacyAdjustment = content.match(/调整要求：([\s\S]+)$/)?.[1]?.trim();
  if (legacyAdjustment) return legacyAdjustment;
  const goal = content.match(/用户目标：([^\n]+)/)?.[1]?.trim();
  if (goal) return goal;
  return readVisibleAttachmentMessage(readExplicitSkillMessage(content).content);
}

function ActivityRow({ activity }: { activity: AgentActivity }) {
  const running = activity.status === "running";
  const sources = activity.kind === "search" ? activity.sources ?? [] : [];
  const displayLabel = searchActivityLabel(activity) ?? activity.label;
  const previewDetail = sources.length
    ? sources.map((source) => source.title || sourceHostname(source.url)).join("、")
    : activity.detail;
  return (
    <div
      data-agent-activity
      data-conversation-minimap-anchor
      data-minimap-id={`activity-${activity.id}`}
      data-minimap-kind="activity"
      data-minimap-preview={`${displayLabel}${previewDetail ? ` ${previewDetail}` : ""}`}
      data-activity-status={activity.status}
      className="min-h-8 py-1 text-[13px] text-[var(--cp-text-faint)]"
    >
      <div className="flex min-h-7 items-center gap-2">
        {activity.status === "failed" ? (
          <CircleAlert className="size-4 shrink-0 text-[var(--cp-danger)]" />
        ) : null}
        <span className={cn("flex min-w-0 items-center gap-2 overflow-hidden", running && "cp-running-shimmer")}>
          <span className="shrink-0">{displayLabel}</span>
          {activity.detail ? <span className="min-w-0 truncate text-[11px]">{activity.detail}</span> : null}
        </span>
        {activity.durationMs ? (
          <span className="ml-auto shrink-0 text-[11px]">{formatCompactDuration(activity.durationMs)}</span>
        ) : null}
      </div>
      {activity.research ? (
        <div className="mt-2 max-w-[560px] text-[var(--cp-text)]">
          <ResearchToolReceiptView receipt={activity.research} />
        </div>
      ) : null}
      {sources.length ? (
        <div className="mt-0.5 space-y-0.5">
          {sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={source.url}
              className="flex min-h-7 min-w-0 items-center gap-2 rounded-[var(--cp-radius-item)] px-1.5 text-[12px] text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
            >
              <ExternalLink className="size-3.5 shrink-0 text-[var(--cp-text-faint)]" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate">{source.title || sourceHostname(source.url)}</span>
              {source.title ? (
                <span className="max-w-[34%] shrink-0 truncate text-[11px] text-[var(--cp-text-faint)]">
                  {sourceHostname(source.url)}
                </span>
              ) : null}
            </a>
          ))}
        </div>
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
        data-conversation-minimap-anchor
        data-minimap-id={`activity-disclosure-${activities[0]?.id ?? "empty"}-${activities.at(-1)?.id ?? "empty"}`}
        data-minimap-kind="activity"
        data-minimap-preview={summary}
        className="flex min-h-9 w-full items-center gap-2 py-1.5 text-left text-[13px] text-[var(--cp-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className={running ? "cp-running-shimmer" : undefined}>{summary}</span>
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
    if (activities.some((activity) => activity.kind === "compact" && activity.status === "running")) {
      return "正在整理上下文";
    }
    const searchSummary = summarizeSearchActivities(activities);
    if (searchSummary) return searchSummary;
    return "正在调用工具";
  }
  if (activities.some((activity) => activity.research?.kind === "evidence")) {
    return "市场证据与数据回执已就绪";
  }
  if (activities.some((activity) => activity.research?.kind === "plan")) {
    return "免费研究计划与报价已就绪";
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
    return summarizeSearchActivities(activities) ?? "完成了搜索";
  }
  if (kinds.has("compact")) {
    return "已整理上下文";
  }
  return "调用了工具";
}

function QueuedSubmissionList({
  messages,
  operationId,
  onReturnToComposer,
  onDelete,
  onSteer,
  onClear,
}: {
  messages: QueuedMessage[];
  operationId: string | null;
  onReturnToComposer: (message: QueuedMessage) => void;
  onDelete: (queuedSubmissionId: string) => Promise<boolean>;
  onSteer: (queuedSubmissionId: string) => Promise<boolean>;
  onClear: () => Promise<void>;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!openMenuId) {
      return;
    }
    function closeOnOutsideClick(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !menuButtonRefs.current.get(openMenuId as string)?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpenMenuId(null);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenuId]);

  function toggleMenu(messageId: string) {
    if (openMenuId === messageId) {
      setOpenMenuId(null);
      return;
    }
    const rect = menuButtonRefs.current.get(messageId)?.getBoundingClientRect();
    if (rect) {
      const width = 156;
      const height = 76;
      const belowTop = rect.bottom + 6;
      const top = belowTop + height <= window.innerHeight - 8 ? belowTop : rect.top - height - 6;
      setMenuPosition({
        left: Math.min(rect.right - width, window.innerWidth - width - 8),
        top: Math.max(8, top),
      });
    }
    setOpenMenuId(messageId);
  }

  return (
    <div className="relative z-10 mx-auto -mb-px max-h-[148px] w-[calc(100%-32px)] max-w-[736px] overflow-y-auto rounded-[18px] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] px-2 py-1">
      {messages.map((message) => {
        const busy = operationId === message.id;
        return (
          <div
            key={message.id}
            data-queued-submission-id={message.id}
            className="flex h-7 items-center gap-2 px-1.5 text-[13px] text-[var(--cp-text-soft)]"
          >
            <ListRestart className="size-3.5 shrink-0 text-[var(--cp-text-faint)]" strokeWidth={1.6} />
            <span className="min-w-0 flex-1 truncate">{message.content}</span>
            <button
              type="button"
              className="flex h-7 shrink-0 items-center gap-1 rounded-[var(--cp-radius-xs)] px-1.5 text-[12px] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cp-focus)]"
              disabled={busy}
              onClick={() => void onSteer(message.id)}
            >
              <CornerDownRight className="size-3" strokeWidth={1.6} />
              <span>调整方向</span>
            </button>
            <IconTooltip label="删除排队消息">
              <Button type="button" variant="ghost" size="icon" className="size-6 rounded-[var(--cp-radius-xs)] text-[var(--cp-text-faint)]" aria-label="删除排队消息" disabled={busy} onClick={() => void onDelete(message.id)}>
                <Trash2 className="size-3.5" strokeWidth={1.6} />
              </Button>
            </IconTooltip>
            <IconTooltip label="更多排队操作">
              <Button
                ref={(node) => {
                  if (node) {
                    menuButtonRefs.current.set(message.id, node);
                  } else {
                    menuButtonRefs.current.delete(message.id);
                  }
                }}
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  "size-6 rounded-[var(--cp-radius-xs)] text-[var(--cp-text-faint)] focus-visible:ring-1 focus-visible:ring-offset-0",
                  openMenuId === message.id && "bg-[var(--cp-bg-muted)]",
                )}
                aria-label="更多排队操作"
                aria-expanded={openMenuId === message.id}
                aria-haspopup="menu"
                disabled={busy}
                onClick={() => toggleMenu(message.id)}
              >
                <Ellipsis className="size-3.5" />
              </Button>
            </IconTooltip>
          </div>
        );
      })}
      {openMenuId
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="排队消息操作"
              className="fixed z-[70] w-[156px] rounded-[10px] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-1 shadow-[var(--cp-shadow-soft)]"
              style={{ left: menuPosition.left, top: menuPosition.top }}
            >
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center gap-2 rounded-[var(--cp-radius-xs)] px-2.5 text-left text-[13px] hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cp-focus)]"
                onClick={() => {
                  const message = messages.find((item) => item.id === openMenuId);
                  if (message) {
                    setOpenMenuId(null);
                    void onReturnToComposer(message);
                  }
                }}
              >
                <Pencil className="size-4" strokeWidth={1.8} />
                编辑消息
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex h-8 w-full items-center gap-2 rounded-[var(--cp-radius-xs)] px-2.5 text-left text-[13px] hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cp-focus)]"
                onClick={() => {
                  setOpenMenuId(null);
                  void onClear();
                }}
              >
                <ListX className="size-4" strokeWidth={1.8} />
                关闭排队
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ProcessingStatus({
  running,
  compacting,
  durationMs,
  startedAt,
}: {
  running: boolean;
  compacting: boolean;
  durationMs: number | null;
  startedAt: number | null;
}) {
  const [elapsedMs, setElapsedMs] = useState(() =>
    startedAt ? Math.max(0, Date.now() - startedAt) : 0,
  );
  useEffect(() => {
    if (!running) {
      return;
    }
    const updateElapsed = () => {
      const nextElapsed = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
      setElapsedMs((currentElapsed) => Math.max(currentElapsed, nextElapsed));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  if (!running && durationMs === null) {
    return null;
  }
  const elapsed = durationMs ?? elapsedMs;
  return (
    <div
      data-conversation-minimap-anchor
      data-minimap-id={`processing-${startedAt ?? "completed"}`}
      data-minimap-kind="status"
      data-minimap-preview={
        running
          ? `${compacting ? "正在整理上下文" : "正在处理"} ${formatDuration(elapsed)}`
          : `已处理 ${formatDuration(elapsed)}`
      }
      className="min-h-5 text-sm text-[var(--cp-text-muted)]"
      aria-live="polite"
    >
      {running ? (
        <span className="cp-running-shimmer">
          {compacting ? "正在整理上下文" : "正在处理"} {formatDuration(elapsed)}
        </span>
      ) : (
        `已处理 ${formatDuration(elapsed)}`
      )}
    </div>
  );
}

function GeneratedImageCard({ image }: { image: GeneratedImageItem }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!previewOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePreview();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [previewOpen]);

  function closePreview() {
    setPreviewOpen(false);
    window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
  }

  return (
    <div
      data-conversation-minimap-anchor
      data-minimap-id={`image-${image.id}`}
      data-minimap-kind="image"
      data-minimap-preview="AI 生成图片"
      className="grid gap-3 sm:grid-cols-2"
    >
      <button
        ref={previewTriggerRef}
        type="button"
        className="group block aspect-square w-full overflow-hidden rounded-[var(--cp-radius-item)] border border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] focus-visible:ring-offset-2"
        aria-label="预览生成图片"
        onClick={() => setPreviewOpen(true)}
      >
        {/* Generated provider images have dynamic dimensions and are served by an authenticated route. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt="AI 生成内容"
          className="block size-full object-cover transition-opacity duration-[var(--cp-duration-fast)] group-hover:opacity-95"
        />
      </button>
      {previewOpen
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="图片预览"
              className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(0,0,0,0.82)] p-4 md:p-8"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                  closePreview();
                }
              }}
            >
              <button
                type="button"
                className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-[rgba(24,24,24,0.82)] text-white transition-colors hover:bg-[rgba(40,40,40,0.92)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:right-6 md:top-6"
                aria-label="关闭图片预览"
                onClick={closePreview}
                autoFocus
              >
                <X className="size-5" strokeWidth={1.8} />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt="生成图片预览"
                className="max-h-[calc(100dvh-64px)] max-w-[calc(100vw-32px)] object-contain md:max-h-[calc(100dvh-96px)] md:max-w-[calc(100vw-96px)]"
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function WorkOutputPanel({
  images,
  sources,
  activities,
  reportReceipts,
}: {
  images: GeneratedImageItem[];
  sources: WebSource[];
  activities: AgentActivity[];
  reportReceipts: MarketResearchReceipt[];
}) {
  return (
    <aside className="absolute right-6 top-2 hidden max-h-[calc(100dvh-96px)] w-[300px] overflow-y-auto rounded-[var(--cp-radius-popover)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-5 shadow-[var(--cp-shadow-soft)] 2xl:block">
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
        <div className="mt-3 text-sm text-[var(--cp-text-faint)]">当前任务没有文件或图片产物</div>
      )}
      <div className="my-4 h-px bg-[var(--cp-border-subtle)]" />
      <ResearchEvidencePanel
        activities={activities}
        reportReceipts={reportReceipts}
        webSources={sources}
      />
    </aside>
  );
}

function sourceHostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
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

export type SidebarProps = {
  user: AuthUser | null;
  activeView: WorkbenchView;
  canOpenEnterpriseAdmin: boolean;
  threads: AgentThreadSummary[];
  activeThreadId: string | null;
  navigationLocked: boolean;
  deletingThreadIds: Set<string>;
  selectionMode: boolean;
  selectedThreadIds: Set<string>;
  onNewTask: () => void;
  onOpenThread: (thread: AgentThreadSummary) => void;
  onToggleSelectionMode: () => void;
  onToggleThreadSelection: (threadId: string) => void;
  onRequestThreadDeletion: (threadIds: string[]) => void;
  onOpenProductInsights: () => void;
  onOpenCreative: () => void;
  onOpenPlugins: () => void;
  onOpenSkills: () => void;
  onOpenAuth: () => void;
  onLogout: () => Promise<void>;
  mobile?: boolean;
  onNavigate?: () => void;
};

export function runSidebarNavigation(action: () => void, onNavigate?: () => void) {
  action();
  onNavigate?.();
}

export function Sidebar({
  user,
  activeView,
  canOpenEnterpriseAdmin,
  threads,
  activeThreadId,
  navigationLocked,
  deletingThreadIds,
  selectionMode,
  selectedThreadIds,
  onNewTask,
  onOpenThread,
  onToggleSelectionMode,
  onToggleThreadSelection,
  onRequestThreadDeletion,
  onOpenProductInsights,
  onOpenCreative,
  onOpenPlugins,
  onOpenSkills,
  onOpenAuth,
  onLogout,
  mobile = false,
  onNavigate,
}: SidebarProps) {
  const [openSidebarFlyout, setOpenSidebarFlyout] = useState<SidebarFlyoutId | null>(null);
  const [sidebarFlyoutPosition, setSidebarFlyoutPosition] = useState({ left: 0, top: 0 });
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarFlyoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openSidebarFlyout) {
      return;
    }

    function activeButton() {
      return moreButtonRef.current;
    }

    function closeSidebarFlyout(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !activeButton()?.contains(target) &&
        !sidebarFlyoutRef.current?.contains(target)
      ) {
        setOpenSidebarFlyout(null);
      }
    }

    function closeSidebarFlyoutOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenSidebarFlyout(null);
      }
    }

    function positionSidebarFlyout() {
      const button = activeButton();
      if (!button) {
        return;
      }
      const rect = button.getBoundingClientRect();
      const menuWidth = 252;
      const menuHeight = moreNavItems.length * 40 + 16;
      setSidebarFlyoutPosition({
        left: Math.min(rect.right + 10, window.innerWidth - menuWidth - 8),
        top: Math.min(rect.top, window.innerHeight - menuHeight - 8),
      });
    }

    document.addEventListener("pointerdown", closeSidebarFlyout);
    window.addEventListener("keydown", closeSidebarFlyoutOnEscape);
    window.addEventListener("resize", positionSidebarFlyout);
    window.addEventListener("scroll", positionSidebarFlyout, true);
    return () => {
      document.removeEventListener("pointerdown", closeSidebarFlyout);
      window.removeEventListener("keydown", closeSidebarFlyoutOnEscape);
      window.removeEventListener("resize", positionSidebarFlyout);
      window.removeEventListener("scroll", positionSidebarFlyout, true);
    };
  }, [openSidebarFlyout]);

  function toggleSidebarFlyout() {
    if (openSidebarFlyout === "more") {
      setOpenSidebarFlyout(null);
      return;
    }
    const button = moreButtonRef.current;
    const rect = button?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 252;
      const menuHeight = moreNavItems.length * 40 + 16;
      setSidebarFlyoutPosition({
        left: Math.min(rect.right + 10, window.innerWidth - menuWidth - 8),
        top: Math.min(rect.top, window.innerHeight - menuHeight - 8),
      });
    }
    setOpenSidebarFlyout("more");
  }

  function openMoreNavigationItem(label: string) {
    setOpenSidebarFlyout(null);
    if (label === "插件") {
      runSidebarNavigation(onOpenPlugins, onNavigate);
    } else if (label === "技能") {
      runSidebarNavigation(onOpenSkills, onNavigate);
    }
  }

  const moreMenuItems = moreNavItems.map((item) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-left text-sm text-[var(--cp-text-soft)] transition-colors duration-[var(--cp-duration-fast)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
        item.label === "插件" && activeView === "plugins" && "bg-[var(--cp-surface-hover)] text-[var(--cp-text)]",
        item.label === "技能" && activeView === "skills" && "bg-[var(--cp-surface-hover)] text-[var(--cp-text)]",
        item.disabledReason && "cursor-not-allowed opacity-45",
      )}
      disabled={Boolean(item.disabledReason)}
      aria-label={item.disabledReason ? `${item.label}：${item.disabledReason}` : item.label}
      title={item.disabledReason ?? undefined}
      onClick={() => openMoreNavigationItem(item.label)}
    >
      <item.icon className="size-[18px] shrink-0" strokeWidth={1.8} />
      <span className="truncate">{item.label}</span>
      {item.disabledReason ? <span className="sr-only">{item.disabledReason}</span> : null}
    </button>
  ));

  return (
    <aside
      className={cn(
        "w-[var(--cp-sidebar-width)] shrink-0 flex-col border-r border-[var(--cp-border)] bg-[var(--cp-sidebar)]",
        mobile ? "flex h-full max-w-full" : "hidden md:flex",
      )}
      data-sidebar-variant={mobile ? "mobile" : "desktop"}
    >
      <div className={cn("flex h-[56px] shrink-0 items-center px-4", mobile && "pr-12")}>
        <div className="min-w-0 text-[18px] font-semibold leading-none text-[var(--cp-text)]">Commerce Pilot</div>
      </div>

      <nav className="shrink-0 space-y-1 px-2" aria-label="主要导航">
        {primaryNavItems.map((item) => {
          const isNewTask = item.label === "新任务";
          const isProductInsights = item.label === "商品决策";
          const isCreativeSpace = item.label === "创作空间";
          return (
            <button
              key={item.label}
              type="button"
              className={cn(
                "flex h-[var(--cp-sidebar-item-height)] w-full shrink-0 items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-left text-sm text-[var(--cp-text-soft)] transition-colors duration-[var(--cp-duration-fast)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                isNewTask && activeView === "workbench" && !activeThreadId && "bg-[var(--cp-surface-hover)] text-[var(--cp-text)]",
                isCreativeSpace && activeView === "creative" &&
                  "bg-[var(--cp-surface-hover)] text-[var(--cp-text)]",
                ((navigationLocked && isNewTask) || item.disabledReason) && "cursor-not-allowed opacity-50",
              )}
              disabled={(navigationLocked && isNewTask) || Boolean(item.disabledReason)}
              aria-label={item.disabledReason ? `${item.label}：${item.disabledReason}` : item.label}
              title={item.disabledReason ?? undefined}
              onClick={() => {
                const action = isNewTask
                  ? onNewTask
                  : isProductInsights
                    ? onOpenProductInsights
                    : isCreativeSpace
                      ? onOpenCreative
                      : null;
                if (!action) return;
                runSidebarNavigation(action, onNavigate);
              }}
            >
              <item.icon className="size-[var(--cp-sidebar-icon-size)] shrink-0" strokeWidth={1.8} />
              <span className="truncate">{item.label}</span>
              {item.disabledReason ? <span className="sr-only">{item.disabledReason}</span> : null}
            </button>
          );
        })}

        <div className="shrink-0">
          <button
            ref={moreButtonRef}
            type="button"
            className={cn(
              "flex h-[var(--cp-sidebar-item-height)] w-full shrink-0 items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-left text-sm text-[var(--cp-text-soft)] transition-colors duration-[var(--cp-duration-fast)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
              (openSidebarFlyout === "more" || activeView === "plugins" || activeView === "skills") &&
                "bg-[var(--cp-surface-hover)] text-[var(--cp-text)]",
            )}
            aria-expanded={openSidebarFlyout === "more"}
            aria-haspopup="menu"
            aria-controls="sidebar-more-navigation"
            onClick={toggleSidebarFlyout}
          >
            <Ellipsis className="size-[var(--cp-sidebar-icon-size)] shrink-0" strokeWidth={1.8} />
            <span className="truncate">更多</span>
          </button>

        </div>
      </nav>

      {openSidebarFlyout && mobile ? (
        <div
          ref={sidebarFlyoutRef}
          id="sidebar-more-navigation"
          role="menu"
          aria-label="更多功能"
          className="mx-2 mt-1 rounded-[var(--cp-radius-popover)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-2"
        >
          {moreMenuItems}
        </div>
      ) : null}

      {openSidebarFlyout && !mobile
          ? createPortal(
              <div
                ref={sidebarFlyoutRef}
                id="sidebar-more-navigation"
                role="menu"
                aria-label="更多功能"
                className="fixed z-50 w-[252px] rounded-[var(--cp-radius-popover)] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-2 shadow-[var(--cp-shadow-popover)]"
                style={{ left: sidebarFlyoutPosition.left, top: sidebarFlyoutPosition.top }}
              >
                {moreMenuItems}
              </div>,
              document.body,
            )
          : null}

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2" aria-label="最近任务">
        {threads.length ? (
          <SidebarThreadTree
            threads={threads}
            activeView={activeView}
            activeThreadId={activeThreadId}
            navigationLocked={navigationLocked}
            deletingThreadIds={deletingThreadIds}
            selectionMode={selectionMode}
            selectedThreadIds={selectedThreadIds}
            onOpenThread={(thread) => {
              runSidebarNavigation(() => onOpenThread(thread), onNavigate);
            }}
            onToggleSelectionMode={onToggleSelectionMode}
            onToggleThreadSelection={onToggleThreadSelection}
            onRequestThreadDeletion={onRequestThreadDeletion}
          />
        ) : null}
      </nav>

      <div className="shrink-0 px-3 pb-3">
        {user ? (
          <AuthenticatedSidebarFooter
            user={user}
            canOpenEnterpriseAdmin={canOpenEnterpriseAdmin}
            onLogout={async () => {
              onNavigate?.();
              await onLogout();
            }}
          />
        ) : (
          <UnauthenticatedSidebarFooter
            onOpenAuth={() => {
              onNavigate?.();
              onOpenAuth();
            }}
          />
        )}
      </div>
    </aside>
  );
}

function SidebarThreadTree({
  threads,
  activeView,
  activeThreadId,
  navigationLocked,
  deletingThreadIds,
  selectionMode,
  selectedThreadIds,
  onOpenThread,
  onToggleSelectionMode,
  onToggleThreadSelection,
  onRequestThreadDeletion,
}: {
  threads: AgentThreadSummary[];
  activeView: WorkbenchView;
  activeThreadId: string | null;
  navigationLocked: boolean;
  deletingThreadIds: Set<string>;
  selectionMode: boolean;
  selectedThreadIds: Set<string>;
  onOpenThread: (thread: AgentThreadSummary) => void;
  onToggleSelectionMode: () => void;
  onToggleThreadSelection: (threadId: string) => void;
  onRequestThreadDeletion: (threadIds: string[]) => void;
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TaskCategory>>(() => new Set());
  const groupedThreads = useMemo(() => {
    const groups = new Map<TaskCategory, AgentThreadSummary[]>();
    for (const definition of taskGroupDefinitions) groups.set(definition.category, []);
    for (const thread of threads) {
      const category = resolveTaskCategory(thread);
      groups.get(category)?.push(thread);
    }
    return groups;
  }, [threads]);

  useEffect(() => {
    const activeThread = threads.find((thread) => thread.threadId === activeThreadId);
    if (!activeThread) return;
    const activeCategory = resolveTaskCategory(activeThread);
    setCollapsedGroups((current) => {
      if (!current.has(activeCategory)) return current;
      const next = new Set(current);
      next.delete(activeCategory);
      return next;
    });
  }, [activeThreadId, threads]);

  return (
    <div className="relative mt-5 min-h-full px-1" aria-label="最近任务分类">
      <div className="mb-1 flex h-7 items-center justify-between px-2">
        <span className="text-xs font-medium text-[var(--cp-text-faint)]">最近</span>
        <IconTooltip label={selectionMode ? "退出批量删除" : "批量删除"}>
          <button
            type="button"
            className={cn(
              "flex size-7 items-center justify-center rounded-[var(--cp-radius-xs)] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)]",
              selectionMode && "bg-[var(--cp-surface-hover)] text-[var(--cp-text)]",
            )}
            aria-label={selectionMode ? "退出批量删除" : "批量删除"}
            onClick={onToggleSelectionMode}
          >
            {selectionMode ? <X className="size-3.5" /> : <ListX className="size-3.5" />}
          </button>
        </IconTooltip>
      </div>
      <div className="space-y-1">
        {taskGroupDefinitions.map((definition) => {
          const items = groupedThreads.get(definition.category) ?? [];
          if (!items.length) return null;
          const collapsed = collapsedGroups.has(definition.category);
          const Icon = definition.icon;
          return (
            <div key={definition.category} data-task-category={definition.category}>
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-left text-xs font-medium text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                aria-expanded={!collapsed}
                onClick={() =>
                  setCollapsedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(definition.category)) next.delete(definition.category);
                    else next.add(definition.category);
                    return next;
                  })
                }
              >
                {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                <Icon className="size-3.5" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate">{definition.label}</span>
                <span className="text-[11px] font-normal text-[var(--cp-text-faint)]">{items.length}</span>
              </button>
              {!collapsed ? (
                <div className="ml-5 space-y-0.5 border-l border-[var(--cp-border-subtle)] pl-1.5">
                  {items.map((thread) => {
                    const active =
                      thread.threadId === activeThreadId &&
                      activeView === "workbench";
                    const deleting = deletingThreadIds.has(thread.threadId);
                    const selected = selectedThreadIds.has(thread.threadId);
                    return (
                      <div
                        key={thread.threadId}
                        data-thread-id={thread.threadId}
                        data-thread-status={thread.status}
                        className={cn(
                          "group flex h-[var(--cp-sidebar-item-height)] w-full items-center rounded-[var(--cp-radius-item)] transition-colors hover:bg-[var(--cp-surface-hover)]",
                          active && "bg-[var(--cp-surface-hover)]",
                          deleting && "opacity-55",
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            "flex min-w-0 flex-1 items-center self-stretch rounded-[var(--cp-radius-item)] px-2 text-left text-[13px] text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                            ((navigationLocked && thread.threadId !== activeThreadId) || deleting) && "cursor-not-allowed",
                          )}
                          disabled={(navigationLocked && thread.threadId !== activeThreadId) || deleting}
                          onClick={() => selectionMode ? onToggleThreadSelection(thread.threadId) : onOpenThread(thread)}
                        >
                          {selectionMode ? (
                            <span
                              className={cn(
                                "mr-2 flex size-4 shrink-0 items-center justify-center rounded-full border",
                                selected
                                  ? "border-[var(--cp-text)] bg-[var(--cp-text)] text-white"
                                  : "border-[var(--cp-border-strong)]",
                              )}
                              aria-hidden="true"
                            >
                              {selected ? <Check className="size-2.5" strokeWidth={2.5} /> : null}
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                          {thread.status === "running" && !deleting ? (
                            <Loader2 data-thread-spinner className="ml-2 size-3.5 shrink-0 animate-spin text-[var(--cp-text-muted)]" />
                          ) : thread.status === "failed" && !deleting ? (
                            <CircleAlert className="ml-2 size-3.5 shrink-0 text-[var(--cp-danger)]" strokeWidth={1.8} />
                          ) : null}
                        </button>
                        <IconTooltip label={deleting ? "正在后台删除" : "永久删除任务"}>
                          <button
                            type="button"
                            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-[var(--cp-radius-xs)] text-[var(--cp-text-faint)] opacity-70 hover:bg-[var(--cp-bg-muted)] hover:text-[var(--cp-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                            aria-label={deleting ? "正在后台删除" : `永久删除 ${thread.title}`}
                            disabled={deleting}
                            onClick={() => onRequestThreadDeletion([thread.threadId])}
                          >
                            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          </button>
                        </IconTooltip>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {selectionMode ? (
        <div className="sticky bottom-0 mt-3 flex items-center justify-between border-t border-[var(--cp-border-subtle)] bg-[var(--cp-sidebar)] px-2 py-2">
          <span className="text-xs text-[var(--cp-text-muted)]">已选 {selectedThreadIds.size} 个</span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!selectedThreadIds.size}
            onClick={() => onRequestThreadDeletion([...selectedThreadIds])}
          >
            <Trash2 className="size-3.5" />
            删除所选
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AuthenticatedSidebarFooter({
  user,
  canOpenEnterpriseAdmin,
  onLogout,
}: {
  user: AuthUser;
  canOpenEnterpriseAdmin: boolean;
  onLogout: () => Promise<void>;
}) {
  const initial = user.name.trim().slice(0, 1).toUpperCase() || "用";

  return (
    <div className="border-t border-[var(--cp-border-subtle)] pt-2">
      {canOpenEnterpriseAdmin ? (
        <Link
          href="/enterprise/admin"
          className="mb-1 flex h-[var(--cp-sidebar-item-height)] items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-sm text-[var(--cp-text-soft)] transition-colors hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
        >
          <Building2 className="size-[var(--cp-sidebar-icon-size)]" strokeWidth={1.8} />
          <span className="truncate">企业管理</span>
        </Link>
      ) : null}
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
    </div>
  );
}

function ThreadDeletionDialog({
  threadIds,
  threads,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  threadIds: string[];
  threads: AgentThreadSummary[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const titles = threadIds.map(
    (threadId) => threads.find((thread) => thread.threadId === threadId)?.title ?? "未命名任务",
  );
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting]);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(0,0,0,0.38)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="thread-deletion-title"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-[440px] rounded-[var(--cp-radius-popover)] bg-[var(--cp-surface)] p-6 shadow-[var(--cp-shadow-popover)]">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--cp-danger-bg)] text-[var(--cp-danger)]">
            <Trash2 className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="thread-deletion-title" className="m-0 text-lg font-semibold">永久删除 {threadIds.length} 个任务？</h2>
            <p className="mb-0 mt-2 text-sm leading-6 text-[var(--cp-text-muted)]">
              任务将进入后台删除队列。对话、生成图片、附件、视频、来源缓存和其他关联产物都会永久删除，无法恢复。
            </p>
          </div>
        </div>
        <div className="mt-5 max-h-32 overflow-y-auto border-y border-[var(--cp-border-subtle)] py-2">
          {titles.map((title, index) => (
            <div key={`${threadIds[index]}:${index}`} className="truncate px-1 py-1.5 text-sm text-[var(--cp-text-soft)]">
              {title}
            </div>
          ))}
        </div>
        {error ? <p className="mb-0 mt-3 text-xs text-[var(--cp-danger)]">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>取消</Button>
          <Button type="button" variant="destructive" disabled={submitting} onClick={() => void onConfirm()}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {submitting ? "正在加入后台任务" : "永久删除"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function MobileTopbar({
  user,
  onOpenAuth,
  onLogout,
  renderNavigation,
}: {
  user: AuthUser | null;
  onOpenAuth: () => void;
  onLogout: () => Promise<void>;
  renderNavigation: (onNavigate: () => void) => ReactNode;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--cp-border)] bg-[rgba(255,255,255,0.96)] px-3 md:hidden">
      <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="打开导航"
            aria-expanded={navigationOpen}
          >
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent
          className="inset-y-0 left-0 right-auto h-dvh max-h-none rounded-none border-y-0 border-l-0 border-r p-0 [&>div:first-child]:hidden"
          style={{ width: "min(88vw, var(--cp-sidebar-width))" }}
          aria-label="移动导航"
        >
          <SheetTitle className="sr-only">Commerce Pilot 导航</SheetTitle>
          <SheetDescription className="sr-only">打开工作台、商品决策、创作空间、插件、技能和最近任务。</SheetDescription>
          {renderNavigation(() => setNavigationOpen(false))}
        </SheetContent>
      </Sheet>
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
  allowPublicRegistration,
}: {
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  allowPublicRegistration: boolean;
}) {
  return (
    <div className="pointer-events-auto absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
      <Button asChild variant="ghost" size="md" className="h-10 rounded-full px-4">
        <Link href="/enterprise">Enterprise</Link>
      </Button>
      <Button type="button" size="md" className="h-10 rounded-full px-5" onClick={onOpenLogin}>
        登录
      </Button>
      {allowPublicRegistration ? (
        <Button
          type="button"
          variant="subtle"
          size="md"
          className="h-10 rounded-full bg-[var(--cp-surface)] px-5 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)] hover:bg-[var(--cp-surface)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.1),0_0_0_1px_rgba(0,0,0,0.05)]"
          onClick={onOpenRegister}
        >
          本地注册
        </Button>
      ) : (
        <Button asChild variant="subtle" size="md" className="h-10 rounded-full px-5">
          <Link href="/enterprise#contact-sales">联系销售</Link>
        </Button>
      )}
    </div>
  );
}

function UnauthenticatedSidebarFooter({ onOpenAuth }: { onOpenAuth: () => void }) {
  return (
    <div className="border-t border-[var(--cp-border-subtle)] pt-3">
      <div className="space-y-1">
        <SidebarUtilityItem
          icon={Sparkles}
          label="查看套餐和定价"
          trailingIcon={ChevronRight}
          href="/enterprise"
        />
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
  href,
}: {
  icon: typeof Sparkles;
  label: string;
  trailingIcon?: typeof ExternalLink;
  href?: string;
}) {
  const className =
    "flex h-9 w-full items-center gap-3 rounded-[var(--cp-radius-item)] px-2 text-left text-sm text-[var(--cp-text-soft)] transition-colors hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]";
  const content = (
    <>
      <Icon className="size-4 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {TrailingIcon ? <TrailingIcon className="size-3.5 shrink-0 text-[var(--cp-text-muted)]" strokeWidth={1.8} /> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={className}>
      {content}
    </button>
  );
}

function AuthDialog({
  initialMode,
  allowPublicRegistration,
  onClose,
  onAuthenticated,
}: {
  initialMode: AuthMode;
  allowPublicRegistration: boolean;
  onClose: () => void;
  onAuthenticated: () => Promise<void>;
}) {
  const [authMode, setAuthMode] = useState<AuthMode>(allowPublicRegistration ? initialMode : "login");
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

        {allowPublicRegistration ? (
          <p className="mb-0 mt-5 text-sm text-[var(--cp-text-muted)]">
            {authMode === "login" ? "还没有本地测试账号？" : "已经有账号？"}
            <button
              type="button"
              className="ml-1 font-medium text-[var(--cp-text)] underline underline-offset-4"
              onClick={() => switchAuthMode(authMode === "login" ? "register" : "login")}
            >
              {authMode === "login" ? "本地注册" : "登录"}
            </button>
          </p>
        ) : (
          <p className="mb-0 mt-5 text-sm text-[var(--cp-text-muted)]">
            新企业请先<Link href="/enterprise#contact-sales" className="ml-1 font-medium underline underline-offset-4">联系销售</Link>；成员请使用邀请链接创建账号。
          </p>
        )}
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

        <IconTooltip label="语音输入暂不可用">
          <span className="inline-flex">
            <Button type="button" variant="ghost" size="icon" className="size-9 rounded-full" aria-label="语音输入暂不可用" disabled>
              <Mic className="size-[18px]" />
            </Button>
          </span>
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
      <Link
        href="/enterprise"
        className="mt-4 rounded-[var(--cp-radius-item)] px-2 py-1 text-sm text-[var(--cp-text-muted)] underline decoration-[var(--cp-border-strong)] underline-offset-4 hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
      >
        了解 Enterprise
      </Link>
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
  externalDataAvailable,
  externalDataApprovalMode,
  canManageExternalDataPolicy,
  productContextMode,
  selectedProducts,
  plugins,
  pluginsLoading,
  skills,
  skillsLoading,
  selectedSkill,
  attachments,
  attachmentError,
  onChange,
  onSubmit,
  onModelChange,
  onReasoningEffortChange,
  onExternalDataApprovalModeChange,
  onProductContextModeChange,
  onSelectedProductsChange,
  onRemoveSelectedProduct,
  onOpenProductLibrary,
  onOpenPlugin,
  onSkillSelect,
  onSkillClear,
  onAddFiles,
  onRemoveAttachment,
}: {
  mode: WorkMode;
  value: string;
  submittedDraft: string | null;
  runtimeStatus: RuntimeStatus;
  models: ProviderModelSummary[];
  modelsLoading: boolean;
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  externalDataAvailable: boolean;
  externalDataApprovalMode: ExternalDataApprovalMode;
  canManageExternalDataPolicy: boolean;
  productContextMode: ProductContextMode;
  selectedProducts: ProductSummary[];
  plugins: CommercePluginInventoryItem[];
  pluginsLoading: boolean;
  skills: SkillInventoryItem[];
  skillsLoading: boolean;
  selectedSkill: SkillInventoryItem | null;
  attachments: PendingAttachmentUpload[];
  attachmentError: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  onExternalDataApprovalModeChange: (mode: ExternalDataApprovalMode) => void;
  onProductContextModeChange: (mode: ProductContextMode) => void;
  onSelectedProductsChange: (products: ProductSummary[]) => void;
  onRemoveSelectedProduct: (productId: string) => void;
  onOpenProductLibrary: () => void;
  onOpenPlugin: (plugin: CommercePluginInventoryItem) => void;
  onSkillSelect: (skill: SkillInventoryItem) => void;
  onSkillClear: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
}) {
  const placeholder =
    mode === "work" ? "处理订单、库存、商品、售后或报表事务" : "询问电商运营、系统配置或数据问题";
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const composerRootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [compactComposerControls, setCompactComposerControls] = useState(false);
  const [activeComposerPopover, setActiveComposerPopover] = useState<ComposerPopoverId | null>(null);
  const skillSelector = useComposerSkillSelector({
    value,
    skills,
    selectedSkill,
    disabled: false,
    inputRef: composerInputRef,
    rootRef: composerRootRef,
    onChange,
    onSelect: onSkillSelect,
  });

  useEffect(() => {
    if (skillSelector.open) setActiveComposerPopover(null);
  }, [skillSelector.open]);

  useEffect(() => {
    if (composerInputRef.current) {
      resizeTextarea(composerInputRef.current, 68, 180);
    }
  }, [value]);

  useLayoutEffect(() => {
    const composer = composerRootRef.current;
    if (!composer || typeof ResizeObserver === "undefined") return;
    const update = (width: number) => setCompactComposerControls(shouldCompactComposerControls(width));
    update(composer.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full">
      <div
        ref={composerRootRef}
        className="relative min-h-[var(--cp-composer-min-height)] rounded-[var(--cp-radius-composer)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-5 py-4 shadow-[var(--cp-shadow-composer)] transition-[border-color,box-shadow] duration-[var(--cp-duration-base)] focus-within:border-[var(--cp-border-strong)] focus-within:shadow-[var(--cp-shadow-composer)]"
      >
        <ComposerAddMenu
          open={skillSelector.open}
          placement="below"
          source={skillSelector.source}
          query={skillSelector.query}
          plugins={plugins}
          pluginsLoading={pluginsLoading}
          skills={skillSelector.filteredSkills}
          activeIndex={skillSelector.activeIndex}
          loading={skillsLoading}
          selectedSkill={selectedSkill}
          onSelect={skillSelector.selectSkill}
          onActiveIndexChange={skillSelector.setActiveIndex}
          onOpenPlugin={onOpenPlugin}
          onAddFiles={() => {
            skillSelector.closeMenu();
            fileInputRef.current?.click();
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.txt,.md,.csv,.json,.xml,.html,.htm,.yaml,.yml,.log"
          className="hidden"
          aria-label="选择文件和图片"
          onChange={(event) => {
            if (event.target.files?.length) onAddFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {selectedSkill ? (
          <div className="mb-3 flex min-w-0">
            <SelectedSkillChip skill={selectedSkill} onRemove={onSkillClear} />
          </div>
        ) : null}
        {productContextMode === "selected" && selectedProducts.length ? (
          <SelectedProductChips products={selectedProducts} onRemove={onRemoveSelectedProduct} />
        ) : null}
        {attachments.length || attachmentError ? (
          <ComposerAttachmentStrip attachments={attachments} error={attachmentError} onRemove={onRemoveAttachment} />
        ) : null}
        <textarea
          ref={composerInputRef}
          data-composer-input
          value={value}
          onChange={(event) => skillSelector.handleChange(event.target.value, event.target.selectionStart)}
          onKeyDown={(event) => {
            if (skillSelector.handleKeyDown(event)) return;
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
          className="block min-h-[68px] max-h-[180px] w-full resize-none overflow-y-hidden border-0 bg-transparent p-0 text-[14px] leading-relaxed text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)]"
          aria-label="任务输入"
        />

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            <IconTooltip label="添加">
              <Button
                type="button"
                variant="ghost"
                size="composerIcon"
                aria-label="添加"
                aria-expanded={skillSelector.open}
                onClick={() => {
                  setActiveComposerPopover(null);
                  skillSelector.toggleMenu();
                }}
              >
                <Plus className="size-5" />
              </Button>
            </IconTooltip>
            <ExternalDataAccessControl
              compact={compactComposerControls}
              value={externalDataApprovalMode}
              available={externalDataAvailable}
              showEnterpriseSettings={canManageExternalDataPolicy}
              open={activeComposerPopover === "access"}
              placement="bottom"
              onChange={onExternalDataApprovalModeChange}
              onOpenChange={(nextOpen) => {
                if (nextOpen) skillSelector.closeMenu();
                setActiveComposerPopover((current) =>
                  nextOpen ? "access" : current === "access" ? null : current,
                );
              }}
            />
            <ProductLibraryPicker
              compact={compactComposerControls}
              open={activeComposerPopover === "products"}
              placement="bottom"
              mode={productContextMode}
              selectedProducts={selectedProducts}
              onOpenChange={(nextOpen) => {
                if (nextOpen) skillSelector.closeMenu();
                setActiveComposerPopover((current) =>
                  nextOpen ? "products" : current === "products" ? null : current,
                );
              }}
              onModeChange={onProductContextModeChange}
              onSelectedProductsChange={onSelectedProductsChange}
              onManage={onOpenProductLibrary}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <ModelAndReasoningControl
              compact={compactComposerControls}
              models={models}
              loading={modelsLoading}
              selectedModel={selectedModel}
              reasoningEffort={reasoningEffort}
              open={activeComposerPopover === "model"}
              onModelChange={onModelChange}
              onReasoningEffortChange={onReasoningEffortChange}
              onOpenChange={(nextOpen) => {
                if (nextOpen) skillSelector.closeMenu();
                setActiveComposerPopover((current) =>
                  nextOpen ? "model" : current === "model" ? null : current,
                );
              }}
            />

            <IconTooltip label="语音输入暂不可用">
              <span className="inline-flex">
                <Button type="button" variant="ghost" size="composerIcon" aria-label="语音输入暂不可用" className="rounded-full" disabled>
                  <Mic />
                </Button>
              </span>
            </IconTooltip>

            <IconTooltip label="提交">
              <Button
                type="button"
                size="composerIcon"
                aria-label="提交"
                disabled={!value.trim() && !attachments.length}
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

const externalDataApprovalOptions: Array<{
  value: ExternalDataApprovalMode;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof LockKeyhole;
}> = [
  {
    value: "always_ask",
    label: "每次调用前询问",
    shortLabel: "请求访问",
    description: "每次收费调用都先确认",
    icon: CircleAlert,
  },
  {
    value: "task",
    label: "本任务内允许",
    shortLabel: "任务访问",
    description: "当前任务按企业上限自动调用",
    icon: CheckCircle2,
  },
  {
    value: "policy",
    label: "按企业策略自动调用",
    shortLabel: "策略访问",
    description: "按平台、接口、费率和单次上限执行",
    icon: LockKeyhole,
  },
];

function ExternalDataAccessControl({
  compact = false,
  value,
  available,
  showEnterpriseSettings,
  open,
  disabled = false,
  placement,
  onChange,
  onOpenChange,
}: {
  compact?: boolean;
  value: ExternalDataApprovalMode;
  available: boolean;
  showEnterpriseSettings: boolean;
  open: boolean;
  disabled?: boolean;
  placement: "top" | "bottom";
  onChange: (mode: ExternalDataApprovalMode) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = externalDataApprovalOptions.find((option) => option.value === value) ?? externalDataApprovalOptions[0];

  useEffect(() => {
    if (!open) return;
    function closeOnPointer(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", closeOnPointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (disabled) onOpenChange(false);
  }, [disabled, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cn(
          "flex h-9 items-center rounded-full text-xs text-[var(--cp-text-muted)] transition-colors hover:bg-[var(--cp-bg-subtle)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "w-9 justify-center p-0" : "gap-1.5 px-2.5 max-sm:w-9 max-sm:justify-center max-sm:p-0 sm:px-3",
        )}
        aria-label={`外部 API 调用权限：${available ? selected.label : "外部数据待配置"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        <selected.icon className="size-4 shrink-0" strokeWidth={1.8} />
        {!compact ? <span className="whitespace-nowrap max-sm:hidden">{available ? selected.shortLabel : "访问"}</span> : null}
        {!compact ? <ChevronDown className="size-3.5 shrink-0 max-sm:hidden" strokeWidth={1.8} /> : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="外部 API 调用权限"
          className={cn(
            "absolute left-0 z-50 w-[min(328px,calc(100vw-32px))] rounded-[12px] border border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] p-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.08)] max-sm:-left-12",
            placement === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          )}
        >
          <div className="flex h-8 items-center justify-between gap-4 px-2">
            <span className="text-xs font-medium text-[var(--cp-text)]">外部 API 调用权限</span>
            {showEnterpriseSettings ? (
              <Link
                href="/enterprise/admin#external-data"
                className="text-[11px] text-[var(--cp-text-muted)] underline decoration-[var(--cp-border-strong)] underline-offset-4 hover:text-[var(--cp-text)]"
              >
                企业设置
              </Link>
            ) : null}
          </div>
          {externalDataApprovalOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              disabled={!available}
              className={cn(
                "grid min-h-[46px] w-full grid-cols-[20px_minmax(0,1fr)_18px] items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:cursor-not-allowed disabled:opacity-45",
                value === option.value && available && "bg-[var(--cp-bg-subtle)]",
              )}
              onClick={() => {
                onChange(option.value);
                onOpenChange(false);
              }}
            >
              <option.icon className="size-4 text-[var(--cp-text-muted)]" strokeWidth={1.8} />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-5 text-[var(--cp-text)]">{option.label}</span>
                <span className="block truncate whitespace-nowrap text-[11px] leading-4 text-[var(--cp-text-muted)]">{option.description}</span>
              </span>
              {value === option.value && available ? <Check className="size-4" strokeWidth={2} /> : null}
            </button>
          ))}
          <p className="mb-0 mt-1 truncate whitespace-nowrap border-t border-[var(--cp-border-subtle)] px-2 pt-1.5 text-[10px] leading-4 text-[var(--cp-text-faint)]">
            任何模式都不授权电脑控制、本机文件访问或任意网络请求。
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ModelAndReasoningControl({
  compact = false,
  models,
  loading,
  selectedModel,
  reasoningEffort,
  open,
  disabled = false,
  placement = "bottom",
  onModelChange,
  onReasoningEffortChange,
  onOpenChange,
}: {
  compact?: boolean;
  models: ProviderModelSummary[];
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
      onOpenChange(false);
      setSubmenu(null);
    }
  }, [disabled, onOpenChange]);

  useEffect(() => {
    if (!open) setSubmenu(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function closeOnOutsidePointer(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onOpenChange(false);
        setSubmenu(null);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
        setSubmenu(null);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);

  function toggleControl() {
    if (disabled) {
      return;
    }
    onOpenChange(!open);
    setPanel(reasoningSupported ? "quick" : "advanced");
    setSubmenu(reasoningSupported ? null : "model");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cn(
          "flex h-9 items-center rounded-full bg-[var(--cp-bg-subtle)] text-sm text-[var(--cp-text)] transition-colors hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:cursor-not-allowed disabled:text-[var(--cp-text-muted)] disabled:opacity-70 disabled:hover:bg-[var(--cp-bg-subtle)]",
          compact ? "w-9 justify-center p-0" : "max-w-[210px] gap-1.5 px-4 max-sm:w-9 max-sm:justify-center max-sm:p-0",
        )}
        aria-label={disabled ? "任务运行中不可切换模型" : "模型和推理设置"}
        aria-expanded={!disabled && open}
        aria-haspopup="menu"
        disabled={disabled}
        title={disabled ? "任务运行中不可切换模型" : undefined}
        onClick={toggleControl}
      >
        <Sparkles className={cn("size-4", !compact && "sm:hidden")} strokeWidth={1.8} aria-hidden="true" />
        {!compact ? <span className="truncate font-medium max-sm:hidden">{loading ? "加载模型" : formatModelName(selectedModel)}</span> : null}
        {!compact && reasoningSupported ? (
          <span className="shrink-0 font-medium max-sm:hidden" style={{ color: effortOption.color }}>
            {effortLabel}
          </span>
        ) : null}
        {!compact ? <ChevronDown className="size-3.5 shrink-0 text-[var(--cp-text-faint)] max-sm:hidden" strokeWidth={1.8} /> : null}
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

async function getThreadDeletionJobStatus(jobId: string): Promise<ThreadDeletionJobView> {
  const response = await fetch(`/api/agent/thread-deletions/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as { job?: ThreadDeletionJobView; error?: string } | null;
  if (!response.ok || !payload?.job) throw new Error(payload?.error || "无法读取后台删除任务。");
  return payload.job;
}

async function getActiveThreadDeletionJobs(): Promise<ThreadDeletionJobView[]> {
  const response = await fetch("/api/agent/thread-deletions", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { jobs?: ThreadDeletionJobView[]; error?: string } | null;
  if (!response.ok || !Array.isArray(payload?.jobs)) throw new Error(payload?.error || "无法读取后台删除任务。");
  return payload.jobs;
}

async function getEnterpriseNavigationContext(): Promise<EnterpriseNavigationContextResponse> {
  const response = await fetch("/api/enterprise/context", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Enterprise navigation access is unavailable.");
  }
  const payload = (await response.json()) as Partial<EnterpriseNavigationContextResponse>;
  return {
    permissions: Array.isArray(payload.permissions)
      ? payload.permissions.filter((permission): permission is string => typeof permission === "string")
      : [],
  };
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
    if (data?.managedMcp?.state === "failed") {
      return {
        label: "Web Search 未就绪",
        shortLabel: "搜索不可用",
        dotClass: "bg-[var(--cp-danger)]",
        icon: CircleAlert,
        iconClass: "text-[var(--cp-danger)]",
        loading: false,
      };
    }
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
