"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CircleAlert,
  Crosshair,
  FileText,
  Focus,
  Image as ImageIcon,
  LoaderCircle,
  Lock,
  Move,
  Plus,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  Table2,
  Trash2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MiniMap,
  NodeResizer,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnMoveEnd,
} from "@xyflow/react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AssistantMarkdown } from "@/components/agent/assistant-markdown";
import { Button } from "@/components/ui/button";
import type {
  ConversationMessage,
  GeneratedImageItem,
} from "@/lib/agent/use-agent-thread";
import type {
  CreativeCanvasImageTextLayer,
  CreativeCanvasLayout,
  CreativeCanvasNodeContent,
  CreativeCanvasNodeRecord,
  CreativeCanvasTableContent,
} from "@/lib/creative/creative-canvas-types";
import { useCreativeCanvasNavigation } from "@/lib/creative/creative-canvas-navigation";
import { useCreativeCanvas } from "@/lib/creative/use-creative-canvas";
import { cn } from "@/lib/utils";

type CanvasNodeData = {
  record: CreativeCanvasNodeRecord;
  saving: boolean;
  onSaveContent: (nodeId: string, content: CreativeCanvasNodeContent) => Promise<CreativeCanvasNodeRecord | null>;
  onSaveLayout: (nodeId: string, layout: CreativeCanvasLayout) => Promise<void>;
  onRestoreRevision: (nodeId: string, revisionId: string) => Promise<CreativeCanvasNodeRecord | null>;
} & Record<string, unknown>;

type CanvasFlowNode = Node<CanvasNodeData, "document" | "image" | "table">;

const nodeTypes = {
  document: CreativeDocumentNode,
  image: CreativeImageNode,
  table: CreativeTableNode,
};

export function CreativeInfiniteCanvas({
  threadId,
  messages,
  images,
  running = false,
  mobileVisible = false,
}: {
  threadId: string | null;
  messages: readonly ConversationMessage[];
  images: readonly GeneratedImageItem[];
  running?: boolean;
  mobileVisible?: boolean;
}) {
  const sourceSignature = useMemo(() => [
    ...messages
      .filter((message) => message.role === "assistant" && message.status === "completed" && message.phase !== "commentary")
      .map((message) => `${message.id}:${message.sequence}`),
    ...images.map((image) => `${image.id}:${image.sequence}`),
  ].join("|"), [images, messages]);
  const canvas = useCreativeCanvas({ threadId, sourceSignature });

  return (
    <section
      className={cn(
        "relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--cp-bg)] xl:flex xl:h-auto",
        mobileVisible ? "flex" : "hidden",
      )}
      aria-label="创作画布"
      aria-live="polite"
    >
      <CreativeCanvasSurface
        key={threadId ?? "creative-canvas-empty"}
        threadId={threadId}
        state={canvas.state}
        loading={canvas.loading}
        error={canvas.error}
        running={running}
        savingNodeIds={canvas.savingNodeIds}
        onRefresh={canvas.refresh}
        onSaveContent={canvas.saveNodeContent}
        onSaveLayout={canvas.saveNodeLayout}
        onRestoreRevision={canvas.restoreNodeRevision}
        onSaveViewport={canvas.saveViewport}
      />
    </section>
  );
}

export function CreativeCanvasSurface(props: Parameters<typeof CreativeCanvasFlow>[0]) {
  return (
    <ReactFlowProvider>
      <CreativeCanvasFlow {...props} />
    </ReactFlowProvider>
  );
}

function CreativeCanvasFlow({
  threadId,
  state,
  loading,
  error,
  running,
  savingNodeIds,
  onRefresh,
  onSaveContent,
  onSaveLayout,
  onRestoreRevision,
  onSaveViewport,
}: {
  threadId: string | null;
  state: ReturnType<typeof useCreativeCanvas>["state"];
  loading: boolean;
  error: string | null;
  running: boolean;
  savingNodeIds: ReadonlySet<string>;
  onRefresh: () => Promise<void>;
  onSaveContent: ReturnType<typeof useCreativeCanvas>["saveNodeContent"];
  onSaveLayout: ReturnType<typeof useCreativeCanvas>["saveNodeLayout"];
  onRestoreRevision: ReturnType<typeof useCreativeCanvas>["restoreNodeRevision"];
  onSaveViewport: ReturnType<typeof useCreativeCanvas>["saveViewport"];
}) {
  const navigation = useCreativeCanvasNavigation();
  const publishMessageRefs = navigation?.publishMessageRefs;
  const focusConversationMessage = navigation?.focusConversationMessage;
  const focusRequest = navigation?.focusRequest;
  const reactFlow = useReactFlow<CanvasFlowNode>();
  const [nodes, setNodes] = useState<CanvasFlowNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const initializedViewportRef = useRef(false);

  useEffect(() => {
    const nextNodes = (state?.nodes ?? []).map<CanvasFlowNode>((record) => ({
      id: record.id,
      type: record.nodeType,
      position: { x: record.layout.x, y: record.layout.y },
      style: { width: record.layout.width, height: record.layout.height },
      zIndex: record.layout.zIndex,
      draggable: !record.layout.locked,
      selected: record.id === selectedNodeId,
      data: {
        record,
        saving: savingNodeIds.has(record.id),
        onSaveContent,
        onSaveLayout,
        onRestoreRevision,
      },
    }));
    setNodes(nextNodes);
  }, [
    onSaveContent,
    onSaveLayout,
    onRestoreRevision,
    savingNodeIds,
    selectedNodeId,
    state?.nodes,
  ]);

  useEffect(() => {
    publishMessageRefs?.(state?.messageRefs ?? []);
    return () => publishMessageRefs?.([]);
  }, [publishMessageRefs, state?.messageRefs]);

  useEffect(() => {
    if (!state || initializedViewportRef.current || !nodes.length) return;
    initializedViewportRef.current = true;
    if (state.viewport) {
      void reactFlow.setViewport(state.viewport, { duration: 0 });
    } else {
      void reactFlow.fitView({ padding: 0.18, maxZoom: 1, duration: 0 });
    }
  }, [nodes.length, reactFlow, state]);

  useEffect(() => {
    const request = focusRequest;
    if (!request || !nodes.some((node) => node.id === request.nodeId)) return;
    setSelectedNodeId(request.nodeId);
    void reactFlow.fitView({
      nodes: [{ id: request.nodeId }],
      padding: 0.28,
      minZoom: 0.55,
      maxZoom: 1.08,
      duration: 380,
    });
  }, [focusRequest, nodes, reactFlow]);

  const handleNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const handleNodeDragStop = useCallback((_: unknown, node: CanvasFlowNode) => {
    const record = state?.nodes.find((entry) => entry.id === node.id);
    if (!record) return;
    void onSaveLayout(node.id, {
      ...record.layout,
      x: node.position.x,
      y: node.position.y,
    });
  }, [onSaveLayout, state?.nodes]);

  const handleMoveEnd = useCallback<OnMoveEnd>((_, viewport) => {
    void onSaveViewport(viewport);
  }, [onSaveViewport]);

  return (
    <div className="relative h-full min-h-0 w-full" data-creative-infinite-canvas>
      <ReactFlow<CanvasFlowNode>
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_, node) => {
          setSelectedNodeId(node.id);
          if (node.data.record.messageItemId) {
            focusConversationMessage?.(node.data.record.messageItemId);
          }
        }}
        onPaneClick={() => setSelectedNodeId(null)}
        onMoveEnd={handleMoveEnd}
        minZoom={0.1}
        maxZoom={2.2}
        panOnScroll
        selectionOnDrag
        panOnDrag={[1, 2]}
        nodesFocusable
        colorMode="light"
        aria-label="电商创作画布"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--cp-border-strong)" />
        <MiniMap
          pannable
          zoomable
          nodeColor="var(--cp-bg-muted)"
          nodeStrokeColor="var(--cp-border-strong)"
          maskColor="var(--cp-bg)"
          className="!border !border-[var(--cp-border)] !bg-[var(--cp-surface)] !shadow-[var(--cp-shadow-soft)]"
          aria-label="画布缩略图"
        />
        <CanvasToolbar
          disabled={!threadId}
          loading={loading}
          running={running}
          error={error}
          sourceHistoryComplete={state?.sourceHistoryComplete ?? true}
          onRefresh={onRefresh}
        />
      </ReactFlow>
    </div>
  );
}

function CanvasToolbar({
  disabled,
  loading,
  running,
  error,
  sourceHistoryComplete,
  onRefresh,
}: {
  disabled: boolean;
  loading: boolean;
  running: boolean;
  error: string | null;
  sourceHistoryComplete: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const viewport = useViewport();
  return (
    <Panel position="top-left" className="!m-3">
      <div className="flex max-w-[min(620px,calc(100vw-40px))] flex-wrap items-center gap-1 rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] p-1 shadow-[var(--cp-shadow-soft)]">
        <span className="px-2 text-xs font-medium text-[var(--cp-text)]">创作画布</span>
        <span className="mx-0.5 h-5 w-px bg-[var(--cp-border)]" aria-hidden="true" />
        <CanvasToolButton label="缩小" disabled={disabled} onClick={() => void zoomOut({ duration: 160 })}>
          <ZoomOut className="size-3.5" />
        </CanvasToolButton>
        <button
          type="button"
          className="h-8 min-w-12 rounded-[7px] px-2 text-[11px] tabular-nums text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] disabled:opacity-40"
          disabled={disabled}
          aria-label="适应画布"
          onClick={() => void fitView({ padding: 0.18, maxZoom: 1, duration: 220 })}
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <CanvasToolButton label="放大" disabled={disabled} onClick={() => void zoomIn({ duration: 160 })}>
          <ZoomIn className="size-3.5" />
        </CanvasToolButton>
        <CanvasToolButton label="适应全部节点" disabled={disabled} onClick={() => void fitView({ padding: 0.18, maxZoom: 1, duration: 220 })}>
          <Focus className="size-3.5" />
        </CanvasToolButton>
        <CanvasToolButton label="重新读取画布" disabled={loading} onClick={() => void onRefresh()}>
          {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        </CanvasToolButton>
        {running ? (
          <span className="cp-running-shimmer px-2 text-[11px] text-[var(--cp-text-muted)]">Agent 正在创作</span>
        ) : null}
        {!sourceHistoryComplete ? (
          <span className="flex min-w-0 items-center gap-1 px-2 text-[11px] text-[var(--cp-warning)]" role="status">
            <CircleAlert className="size-3.5 shrink-0" />
            <span className="truncate">历史较长，未加载资产已安全保留</span>
          </span>
        ) : null}
        {error ? (
          <span className="flex min-w-0 items-center gap-1 px-2 text-[11px] text-[var(--cp-danger)]" role="status">
            <CircleAlert className="size-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

function CanvasToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex size-8 items-center justify-center rounded-[7px] text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:opacity-40"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CreativeNodeFrame({
  node,
  selected,
  children,
  icon,
  onResize,
  onToggleLock,
  onRestore,
}: {
  node: CreativeCanvasNodeRecord;
  selected: boolean;
  children: React.ReactNode;
  icon: React.ReactNode;
  onResize: (width: number, height: number) => void;
  onToggleLock: () => void;
  onRestore: (() => void) | null;
}) {
  const navigation = useCreativeCanvasNavigation();
  return (
    <article
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-[var(--cp-radius-panel)] border bg-[var(--cp-surface)] shadow-[var(--cp-shadow-soft)]",
        selected ? "border-[var(--cp-text)] ring-2 ring-black/10" : "border-[var(--cp-border)]",
      )}
      data-creative-canvas-node={node.nodeType}
      aria-label={node.title}
    >
      <NodeResizer
        minWidth={240}
        minHeight={180}
        isVisible={selected && !node.layout.locked}
        lineClassName="!border-[var(--cp-border-strong)]"
        handleClassName="!size-2.5 !border !border-[var(--cp-border-strong)] !bg-[var(--cp-surface)]"
        onResizeEnd={(_, params) => onResize(params.width, params.height)}
      />
      <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--cp-border-subtle)] px-3 py-2">
        <span className="text-[var(--cp-text-muted)]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-[var(--cp-text)]">{node.title}</span>
          <span className="mt-0.5 block truncate text-[10px] text-[var(--cp-text-faint)]">
            第 {node.revision.number} 版 · {node.revision.origin === "harness" ? "Agent 产出" : "人工修改"}
          </span>
        </span>
        {onRestore ? (
          <button
            type="button"
            className="nodrag nopan flex size-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
            aria-label="恢复上一版"
            title="恢复上一版"
            onClick={onRestore}
          >
            <RotateCcw className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          className="nodrag nopan flex size-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          aria-label={node.layout.locked ? "解锁节点" : "锁定节点"}
          title={node.layout.locked ? "解锁节点" : "锁定节点"}
          onClick={onToggleLock}
        >
          {node.layout.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
        </button>
        {node.messageItemId ? (
          <button
            type="button"
            className="nodrag nopan flex size-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
            aria-label="在对话中定位"
            title="在对话中定位"
            onClick={() => node.messageItemId && navigation?.focusConversationMessage(node.messageItemId)}
          >
            <Crosshair className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          className="nodrag nopan flex size-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          aria-label="在对话中修改此节点"
          title="在对话中修改此节点"
          onClick={() => navigation?.requestNodeRevision({
            nodeId: node.id,
            title: node.title,
            nodeType: node.nodeType,
            deliverableType: node.deliverableType,
          })}
        >
          <Sparkles className="size-3.5" />
        </button>
      </header>
      {children}
    </article>
  );
}

function CreativeDocumentNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const record = data.record;
  const [content, setContent, save] = useNodeDraft(record, data.onSaveContent);
  const [editing, setEditing] = useState(false);
  if (content.kind !== "document") return null;
  return (
    <CreativeNodeFrame
      node={record}
      selected={selected}
      icon={<FileText className="size-4" />}
      onResize={(width, height) => void saveNodeSize(data, width, height)}
      onToggleLock={() => void data.onSaveLayout(record.id, { ...record.layout, locked: !record.layout.locked })}
      onRestore={record.previousRevisionId ? () => void data.onRestoreRevision(record.id, record.previousRevisionId as string) : null}
    >
      <div className="nodrag nopan min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              if (editing) save();
              setEditing((current) => !current);
            }}
          >
            {editing ? <Save className="size-3.5" /> : <Pencil className="size-3.5" />}
            {editing ? "完成" : "编辑"}
          </Button>
        </div>
        {editing ? (
          <>
            <input
              className="w-full border-0 bg-transparent p-0 text-[20px] font-semibold leading-7 text-[var(--cp-text)] outline-none"
              aria-label="文案标题"
              value={content.title}
              onChange={(event) => setContent({ ...content, title: event.target.value })}
              onBlur={save}
            />
            <textarea
              className="mt-4 min-h-[140px] w-full resize-none border-0 bg-transparent p-0 text-[14px] leading-6 text-[var(--cp-text-soft)] outline-none"
              aria-label="文案正文"
              value={content.body}
              onChange={(event) => setContent({ ...content, body: event.target.value })}
              onBlur={save}
            />
            <input
              className="mt-3 w-full border-t border-[var(--cp-border-subtle)] bg-transparent px-0 pb-0 pt-3 text-[13px] font-medium text-[var(--cp-text)] outline-none"
              aria-label="行动引导"
              placeholder="行动引导"
              value={content.callToAction}
              onChange={(event) => setContent({ ...content, callToAction: event.target.value })}
              onBlur={save}
            />
          </>
        ) : (
          <article className="text-[14px] leading-6 text-[var(--cp-text-soft)]">
            <h2 className="mb-4 mt-0 text-[20px] font-semibold leading-7 text-[var(--cp-text)]">{content.title}</h2>
            <AssistantMarkdown content={content.body} />
            {content.callToAction ? (
              <div className="mt-4 border-t border-[var(--cp-border-subtle)] pt-3 text-[13px] font-medium text-[var(--cp-text)]">
                {content.callToAction}
              </div>
            ) : null}
          </article>
        )}
        {content.complianceNotes.length ? (
          <div className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-[var(--cp-warning)]">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{content.complianceNotes.join("；")}</span>
          </div>
        ) : null}
      </div>
      <NodeSaveFooter saving={data.saving} channel={record.channel} />
    </CreativeNodeFrame>
  );
}

function CreativeImageNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const record = data.record;
  const [content, setContent, save] = useNodeDraft(record, data.onSaveContent);
  if (content.kind !== "image") return null;

  const updateLayer = (layerId: string, update: Partial<CreativeCanvasImageTextLayer>) => {
    setContent({
      ...content,
      textLayers: content.textLayers.map((layer) => layer.id === layerId ? { ...layer, ...update } : layer),
    });
  };
  const addTextLayer = () => {
    const next: CreativeCanvasImageTextLayer = {
      id: `text-${Date.now().toString(36)}`,
      text: "输入图片文案",
      x: 8,
      y: 8,
      width: 48,
      fontSize: 28,
      align: "left",
    };
    const updated = { ...content, textLayers: [...content.textLayers, next] };
    setContent(updated);
    void data.onSaveContent(record.id, updated);
  };

  return (
    <CreativeNodeFrame
      node={record}
      selected={selected}
      icon={<ImageIcon className="size-4" />}
      onResize={(width, height) => void saveNodeSize(data, width, height)}
      onToggleLock={() => void data.onSaveLayout(record.id, { ...record.layout, locked: !record.layout.locked })}
      onRestore={record.previousRevisionId ? () => void data.onRestoreRevision(record.id, record.previousRevisionId as string) : null}
    >
      <div className="nodrag nopan relative min-h-0 flex-1 overflow-hidden bg-[var(--cp-bg-subtle)]" data-canvas-image-stage>
        {/* Native Harness image URLs are tenant-checked BFF routes. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={content.image.url}
          alt={content.title}
          className="pointer-events-none h-full w-full select-none object-contain"
        />
        {content.textLayers.map((layer) => (
          <ImageTextLayerEditor
            key={layer.id}
            layer={layer}
            onChange={(update) => updateLayer(layer.id, update)}
            onCommit={save}
            onDelete={() => {
              const updated = { ...content, textLayers: content.textLayers.filter((entry) => entry.id !== layer.id) };
              setContent(updated);
              void data.onSaveContent(record.id, updated);
            }}
          />
        ))}
        <Button
          type="button"
          variant="subtle"
          size="sm"
          className="nodrag nopan absolute bottom-2 left-2 h-8 rounded-[8px] px-2 text-[11px]"
          onClick={addTextLayer}
        >
          <Plus className="size-3.5" />
          添加文字
        </Button>
      </div>
      <div className="nodrag nopan flex shrink-0 items-center gap-1 border-t border-[var(--cp-border-subtle)] px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--cp-text-faint)]">
          原生图片不可覆盖 · {content.textLayers.length} 个文字图层
        </span>
        {data.saving ? <LoaderCircle className="size-3 animate-spin text-[var(--cp-text-faint)]" /> : <Save className="size-3 text-[var(--cp-text-faint)]" />}
      </div>
    </CreativeNodeFrame>
  );
}

function ImageTextLayerEditor({
  layer,
  onChange,
  onCommit,
  onDelete,
}: {
  layer: CreativeCanvasImageTextLayer;
  onChange: (update: Partial<CreativeCanvasImageTextLayer>) => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number } | null>(null);
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: layer.x, y: layer.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveLayer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const stage = event.currentTarget.closest("[data-canvas-image-stage]");
    if (!drag || !stage || drag.pointerId !== event.pointerId) return;
    const bounds = stage.getBoundingClientRect();
    onChange({
      x: Math.min(100 - layer.width, Math.max(0, drag.x + ((event.clientX - drag.startX) / bounds.width) * 100)),
      y: Math.min(92, Math.max(0, drag.y + ((event.clientY - drag.startY) / bounds.height) * 100)),
    });
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    onCommit();
  };
  return (
    <div
      className="absolute min-w-[84px] border border-dashed border-[var(--cp-text)] bg-white/75 p-1 text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)] backdrop-blur-[1px]"
      style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%` }}
      data-image-text-layer
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <button
          type="button"
          className="nodrag nopan flex size-5 cursor-move items-center justify-center rounded-[5px] bg-[var(--cp-text)] text-[var(--cp-text-inverse)]"
          aria-label="移动文字图层"
          onPointerDown={beginDrag}
          onPointerMove={moveLayer}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <Move className="size-3" />
        </button>
        <button
          type="button"
          className="nodrag nopan flex size-5 items-center justify-center rounded-[5px] text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)]"
          aria-label="删除文字图层"
          onClick={onDelete}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <textarea
        className="nodrag nopan block min-h-12 w-full resize-none border-0 bg-transparent p-0 font-medium leading-tight outline-none"
        style={{ fontSize: `${layer.fontSize}px`, textAlign: layer.align }}
        aria-label="图片文字"
        value={layer.text}
        onChange={(event) => onChange({ text: event.target.value })}
        onBlur={onCommit}
      />
      <div className="mt-1 flex items-center gap-0.5">
        {(["left", "center", "right"] as const).map((align) => (
          <button
            key={align}
            type="button"
            className={cn(
              "nodrag nopan flex size-5 items-center justify-center rounded-[5px] text-[var(--cp-text-muted)]",
              layer.align === align && "bg-[var(--cp-surface-hover)] text-[var(--cp-text)]",
            )}
            aria-label={align === "left" ? "左对齐" : align === "center" ? "居中" : "右对齐"}
            onClick={() => { onChange({ align }); queueMicrotask(onCommit); }}
          >
            {align === "left" ? <AlignLeft className="size-3" /> : align === "center" ? <AlignCenter className="size-3" /> : <AlignRight className="size-3" />}
          </button>
        ))}
        <input
          type="number"
          min={12}
          max={72}
          className="nodrag nopan ml-auto h-5 w-10 rounded-[5px] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-1 text-[10px]"
          aria-label="文字字号"
          value={layer.fontSize}
          onChange={(event) => onChange({ fontSize: Math.min(72, Math.max(12, Number(event.target.value) || 12)) })}
          onBlur={onCommit}
        />
      </div>
    </div>
  );
}

function CreativeTableNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const record = data.record;
  const [content, setContent, save] = useNodeDraft(record, data.onSaveContent);
  if (content.kind !== "table") return null;

  const persist = (updated: CreativeCanvasTableContent) => {
    setContent(updated);
    void data.onSaveContent(record.id, updated);
  };
  const updateCell = (rowId: string, columnIndex: number, value: string) => {
    setContent({
      ...content,
      rows: content.rows.map((row) => row.id === rowId
        ? { ...row, cells: row.cells.map((cell, index) => index === columnIndex ? value : cell) }
        : row),
    });
  };

  return (
    <CreativeNodeFrame
      node={record}
      selected={selected}
      icon={<Table2 className="size-4" />}
      onResize={(width, height) => void saveNodeSize(data, width, height)}
      onToggleLock={() => void data.onSaveLayout(record.id, { ...record.layout, locked: !record.layout.locked })}
      onRestore={record.previousRevisionId ? () => void data.onRestoreRevision(record.id, record.previousRevisionId as string) : null}
    >
      <div className="nodrag nopan min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[620px] border-collapse text-left text-[12px] leading-5">
          <thead className="sticky top-0 z-10 bg-[var(--cp-bg-subtle)]">
            <tr>
              {content.columns.map((column, columnIndex) => (
                <th key={`${columnIndex}-${column}`} className="border-b border-[var(--cp-border)] px-2 py-2 font-medium text-[var(--cp-text-muted)]">
                  <input
                    className="w-full min-w-0 bg-transparent outline-none"
                    aria-label={`第 ${columnIndex + 1} 列标题`}
                    value={column}
                    onChange={(event) => setContent({
                      ...content,
                      columns: content.columns.map((entry, index) => index === columnIndex ? event.target.value : entry),
                    })}
                    onBlur={save}
                  />
                </th>
              ))}
              <th className="w-9 border-b border-[var(--cp-border)]" aria-label="行操作" />
            </tr>
          </thead>
          <tbody>
            {content.rows.map((row, rowIndex) => (
              <tr key={row.id} className="align-top hover:bg-[var(--cp-bg-subtle)]/60">
                {row.cells.map((cell, columnIndex) => (
                  <td key={`${row.id}-${columnIndex}`} className="border-b border-[var(--cp-border-subtle)] px-2 py-1.5">
                    <textarea
                      className="block min-h-10 w-full resize-none bg-transparent outline-none"
                      aria-label={`第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`}
                      value={cell}
                      onChange={(event) => updateCell(row.id, columnIndex, event.target.value)}
                      onBlur={save}
                    />
                  </td>
                ))}
                <td className="border-b border-[var(--cp-border-subtle)] px-1 py-1.5">
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-[6px] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-danger)]"
                    aria-label={`删除第 ${rowIndex + 1} 行`}
                    onClick={() => {
                      if (content.rows.length <= 1) return;
                      persist({ ...content, rows: content.rows.filter((entry) => entry.id !== row.id) });
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="nodrag nopan flex shrink-0 items-center gap-2 border-t border-[var(--cp-border-subtle)] px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => persist({
            ...content,
            rows: [
              ...content.rows,
              { id: `row-${Date.now().toString(36)}`, cells: content.columns.map(() => "") },
            ],
          })}
        >
          <Plus className="size-3.5" />
          添加镜头
        </Button>
        <span className="ml-auto text-[10px] text-[var(--cp-text-faint)]">
          {content.rows.length} 行 · {data.saving ? "保存中" : "已保存"}
        </span>
      </div>
    </CreativeNodeFrame>
  );
}

function NodeSaveFooter({ saving, channel }: { saving: boolean; channel: string | null }) {
  return (
    <footer className="flex min-h-8 shrink-0 items-center gap-2 border-t border-[var(--cp-border-subtle)] px-3 text-[10px] text-[var(--cp-text-faint)]">
      <span>{channel || "未指定平台"}</span>
      <span className="ml-auto flex items-center gap-1">
        {saving ? <LoaderCircle className="size-3 animate-spin" /> : <Save className="size-3" />}
        {saving ? "保存中" : "已保存"}
      </span>
    </footer>
  );
}

function useNodeDraft(
  record: CreativeCanvasNodeRecord,
  onSave: CanvasNodeData["onSaveContent"],
): [
  CreativeCanvasNodeContent,
  React.Dispatch<React.SetStateAction<CreativeCanvasNodeContent>>,
  () => void,
] {
  const [content, setContent] = useState(record.revision.content);
  const contentRef = useRef(content);
  useEffect(() => {
    setContent(record.revision.content);
    contentRef.current = record.revision.content;
  }, [record.revision.id, record.revision.content]);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  const setDraft: React.Dispatch<React.SetStateAction<CreativeCanvasNodeContent>> = useCallback((value) => {
    setContent((current) => {
      const next = typeof value === "function" ? value(current) : value;
      contentRef.current = next;
      return next;
    });
  }, []);
  const save = useCallback(() => {
    if (JSON.stringify(contentRef.current) === JSON.stringify(record.revision.content)) return;
    void onSave(record.id, contentRef.current);
  }, [onSave, record.id, record.revision.content]);
  return [content, setDraft, save];
}

async function saveNodeSize(data: CanvasNodeData, width: number, height: number) {
  await data.onSaveLayout(data.record.id, {
    ...data.record.layout,
    width,
    height,
  });
}
