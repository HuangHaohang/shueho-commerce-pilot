"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Circle,
  CircleAlert,
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Lock,
  MousePointer2,
  PenLine,
  Redo2,
  Save,
  SendHorizontal,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { HexColorPicker } from "react-colorful";
import { useDropzone } from "react-dropzone";

import { Button } from "@/components/ui/button";
import type { GeneratedImageItem } from "@/lib/agent/use-agent-thread";
import type {
  CreativeCanvasEditorDrawingLayer,
  CreativeCanvasEditorImageLayer,
  CreativeCanvasEditorLayer,
  CreativeCanvasEditorShapeLayer,
  CreativeCanvasEditorTextLayer,
  CreativeCanvasImageContent,
} from "@/lib/creative/creative-canvas-types";
import { cn } from "@/lib/utils";

import {
  FabricDesignSurface,
  type FabricDesignSurfaceHandle,
  type FabricDesignTool,
} from "./fabric-design-surface";

type EditorTool = FabricDesignTool;

const designPresets = [
  { label: "方形 1:1", width: 1_000, height: 1_000 },
  { label: "竖版 4:5", width: 1_000, height: 1_250 },
  { label: "横版 16:9", width: 1_600, height: 900 },
] as const;

export function CreativeLayerEditor({
  threadId,
  image,
  content,
  loading,
  saving,
  running,
  error,
  onContentChange,
  onSave,
  onSubmitAgentInstruction,
}: {
  threadId: string;
  image: GeneratedImageItem;
  content: CreativeCanvasImageContent | null;
  loading: boolean;
  saving: boolean;
  running: boolean;
  error: string | null;
  onContentChange: (content: CreativeCanvasImageContent) => void;
  onSave: () => Promise<void>;
  onSubmitAgentInstruction: (instruction: string) => Promise<boolean>;
}) {
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [layerHistory, setLayerHistory] = useState<CreativeCanvasEditorLayer[][]>([]);
  const [layerFuture, setLayerFuture] = useState<CreativeCanvasEditorLayer[][]>([]);
  const [assetUploading, setAssetUploading] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const fabricSurfaceRef = useRef<FabricDesignSurfaceHandle>(null);
  const layers = content?.editorLayers ?? [];
  const design = content?.design ?? { width: 1_000, height: 1_000, background: "#ffffff" };
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? null;

  useEffect(() => {
    if (!content || (content.editorLayers && content.design)) return;
    const editorLayers: CreativeCanvasEditorLayer[] = content.editorLayers ?? content.textLayers.map((layer, index) => ({
      id: layer.id,
      kind: "text",
      name: `文字 ${index + 1}`,
      text: layer.text,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: 14,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fontSize: layer.fontSize,
      color: "#ffffff",
      align: layer.align,
      fontWeight: 600,
    }));
    onContentChange({ ...content, editorLayers, design: content.design ?? design });
  }, [content, onContentChange]);

  function updateLayers(nextLayers: CreativeCanvasEditorLayer[], recordHistory = true) {
    if (!content) return;
    if (JSON.stringify(nextLayers) === JSON.stringify(layers)) return;
    if (recordHistory) {
      setLayerHistory((current) => [...current, layers].slice(-60));
      setLayerFuture([]);
    }
    onContentChange({
      ...content,
      editorLayers: nextLayers,
      textLayers: nextLayers
        .filter((layer): layer is CreativeCanvasEditorTextLayer =>
          layer.kind === "text" && Boolean(layer.text.trim()))
        .slice(0, 24)
        .map((layer) => ({
          id: layer.id,
          text: layer.text,
          x: clamp(layer.x, 0, 100),
          y: clamp(layer.y, 0, 100),
          width: clamp(layer.width, 10, 100),
          fontSize: clamp(layer.fontSize, 12, 72),
          align: layer.align,
        })),
    });
  }

  function undoLayers() {
    const previous = layerHistory.at(-1);
    if (!previous) return;
    setLayerHistory((current) => current.slice(0, -1));
    setLayerFuture((current) => [layers, ...current].slice(0, 60));
    updateLayers(previous, false);
    setSelectedLayerId(null);
  }

  function redoLayers() {
    const next = layerFuture[0];
    if (!next) return;
    setLayerFuture((current) => current.slice(1));
    setLayerHistory((current) => [...current, layers].slice(-60));
    updateLayers(next, false);
    setSelectedLayerId(null);
  }

  function updateLayer(layerId: string, update: Partial<CreativeCanvasEditorLayer>) {
    updateLayers(layers.map((layer) => layer.id === layerId
      ? { ...layer, ...update } as CreativeCanvasEditorLayer
      : layer));
  }

  function addTextLayer() {
    const layer: CreativeCanvasEditorTextLayer = {
      id: editorLayerId("text"),
      kind: "text",
      name: `文字 ${layers.filter((item) => item.kind === "text").length + 1}`,
      text: "输入图片文案",
      x: 12,
      y: 12,
      width: 42,
      height: 14,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fontSize: 32,
      color: "#ffffff",
      align: "left",
      fontWeight: 600,
    };
    updateLayers([...layers, layer]);
    setSelectedLayerId(layer.id);
    setTool("select");
  }

  function addShapeLayer(shape: "rectangle" | "ellipse") {
    const layer: CreativeCanvasEditorShapeLayer = {
      id: editorLayerId(shape),
      kind: "shape",
      name: shape === "rectangle" ? "矩形" : "圆形",
      shape,
      x: 20,
      y: 20,
      width: 30,
      height: 24,
      rotation: 0,
      opacity: 0.85,
      visible: true,
      locked: false,
      fill: shape === "rectangle" ? "#ffffff" : "#0d0d0d",
      stroke: "#0d0d0d",
      strokeWidth: 0,
    };
    updateLayers([...layers, layer]);
    setSelectedLayerId(layer.id);
    setTool("select");
  }

  function addBaseCopyLayer() {
    const layer: CreativeCanvasEditorLayer = {
      id: editorLayerId("image"),
      kind: "image",
      name: "底图副本",
      source: "base",
      fit: "contain",
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    };
    updateLayers([...layers, layer]);
    setSelectedLayerId(layer.id);
    setTool("select");
  }

  const onDropAssets = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file || !content) return;
    setAssetUploading(true);
    setAssetError(null);
    try {
      const formData = new FormData();
      formData.set("file", file, file.name);
      const response = await fetch(
        `/api/agent/threads/${encodeURIComponent(threadId)}/canvas/assets`,
        { method: "POST", body: formData },
      );
      const payload = (await response.json().catch(() => null)) as {
        asset?: { id: string; name: string; url: string };
        error?: string;
      } | null;
      if (!response.ok || !payload?.asset) {
        throw new Error(payload?.error || "无法上传设计素材。");
      }
      const layer: CreativeCanvasEditorImageLayer = {
        id: editorLayerId("asset"),
        kind: "image",
        name: payload.asset.name,
        source: "canvas_asset",
        assetId: payload.asset.id,
        assetName: payload.asset.name,
        fit: "contain",
        x: 12,
        y: 12,
        width: 28,
        height: 28,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        crop: { x: 0, y: 0, width: 100, height: 100 },
        filters: { brightness: 0, contrast: 0, saturation: 0, blur: 0 },
      };
      updateLayers([...layers, layer]);
      setSelectedLayerId(layer.id);
      setTool("select");
    } catch (uploadError) {
      setAssetError(uploadError instanceof Error ? uploadError.message : "无法上传设计素材。");
    } finally {
      setAssetUploading(false);
    }
  }, [content, layers, threadId]);

  const dropzone = useDropzone({
    accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"] },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
    multiple: false,
    noClick: true,
    onDropAccepted: onDropAssets,
    onDropRejected: () => setAssetError("请选择一个不超过 5 MB 的 PNG、JPEG 或 WebP 素材。"),
  });

  function exportDesign(format: "png" | "jpeg") {
    const dataUrl = fabricSurfaceRef.current?.exportDataUrl(format, format === "jpeg" ? 0.92 : 1);
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${content?.title || "commerce-design"}.${format === "jpeg" ? "jpg" : "png"}`;
    link.click();
  }

  async function submitAgentEdit() {
    const value = agentInstruction.trim();
    if (!value) return;
    setAgentSubmitting(true);
    setAgentStatus(null);
    try {
      const accepted = await onSubmitAgentInstruction(value);
      if (accepted) {
        setAgentInstruction("");
        setAgentStatus("已提交到当前 Codex 对话，将生成新的底图版本。");
      } else {
        setAgentStatus("任务未被接收，请检查当前对话状态。");
      }
    } finally {
      setAgentSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
      <section
        {...dropzone.getRootProps({
          className: "relative flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden bg-[#202020]",
          "aria-label": "图片图层画布",
        })}
      >
        <input {...dropzone.getInputProps()} />
        <LayerEditorToolbar
          tool={tool}
          disabled={!content}
          onToolChange={setTool}
          onAddText={addTextLayer}
          onAddRectangle={() => addShapeLayer("rectangle")}
          onAddEllipse={() => addShapeLayer("ellipse")}
          onAddImage={addBaseCopyLayer}
          onUpload={dropzone.open}
          uploading={assetUploading}
          onUndo={undoLayers}
          onRedo={redoLayers}
          canUndo={layerHistory.length > 0}
          canRedo={layerFuture.length > 0}
          design={design}
          onDesignChange={(nextDesign) => content && onContentChange({ ...content, design: nextDesign })}
          onExportPng={() => exportDesign("png")}
          onExportJpeg={() => exportDesign("jpeg")}
          onSave={() => void onSave()}
          saving={saving}
        />
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5 pt-16 md:p-8 md:pt-16">
          <FabricDesignSurface
            ref={fabricSurfaceRef}
            threadId={threadId}
            imageUrl={image.url}
            layers={layers}
            design={design}
            selectedLayerId={selectedLayerId}
            tool={tool}
            onSelectionChange={setSelectedLayerId}
            onLayersChange={updateLayers}
          />
          {dropzone.isDragActive ? (
            <div className="pointer-events-none absolute inset-4 z-40 flex items-center justify-center rounded-[var(--cp-radius-panel)] border-2 border-dashed border-white/80 bg-black/55 text-sm font-medium text-white">
              松开即可添加 Logo 或图片素材
            </div>
          ) : null}
        </div>
      </section>

      <aside className="min-h-0 overflow-y-auto border-t border-[var(--cp-border)] bg-[var(--cp-surface)] lg:border-l lg:border-t-0" aria-label="图层和属性">
        <div className="space-y-4 p-3">
          <section className="rounded-[10px] border border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] p-3">
            <div className="mb-2 flex items-center gap-2">
              <ImageIcon className="size-4 text-[var(--cp-text-muted)]" />
              <h3 className="m-0 text-xs font-semibold">电商设计</h3>
              <span className="ml-auto text-[10px] tabular-nums text-[var(--cp-text-faint)]">{design.width} × {design.height}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8" disabled={assetUploading} onClick={dropzone.open}>
                {assetUploading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                上传 Logo/素材
              </Button>
              <details className="relative">
                <summary className="flex h-8 cursor-pointer list-none items-center justify-center gap-2 rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-2 text-[11px]">
                  <span className="size-3.5 rounded-full border border-black/10" style={{ backgroundColor: design.background }} />
                  画布背景
                </summary>
                <div className="absolute right-0 top-10 z-50 rounded-[10px] border border-[var(--cp-border)] bg-[var(--cp-surface)] p-2 shadow-[var(--cp-shadow-popover)]">
                  <HexColorPicker color={design.background} onChange={(background) => content && onContentChange({ ...content, design: { ...design, background } })} />
                </div>
              </details>
            </div>
            <p className="mb-0 mt-2 text-[10px] leading-4 text-[var(--cp-text-faint)]">Logo、品牌角标和产品素材会保存为当前项目的租户私有图层。</p>
          </section>
          <LayerList
            layers={layers}
            selectedLayerId={selectedLayerId}
            onSelect={setSelectedLayerId}
            onChange={updateLayer}
            onDelete={(layerId) => {
              updateLayers(layers.filter((layer) => layer.id !== layerId));
              if (selectedLayerId === layerId) setSelectedLayerId(null);
            }}
            onMove={(layerId, direction) => updateLayers(moveLayer(layers, layerId, direction))}
          />
          {selectedLayer ? (
            <LayerProperties layer={selectedLayer} onChange={(update) => updateLayer(selectedLayer.id, update)} />
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--cp-border)] p-3 text-[11px] leading-5 text-[var(--cp-text-faint)]">
              在画布或图层列表中选择一个图层后，可直接调整位置、尺寸、旋转、透明度和内容。
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="flex-1" disabled={!content || saving} onClick={() => void onSave()}>
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存图层版本
            </Button>
          </div>
          {loading ? <p className="m-0 flex items-center gap-2 text-xs text-[var(--cp-text-muted)]"><LoaderCircle className="size-3.5 animate-spin" />正在读取图层文档</p> : null}
          {assetError ? <p className="m-0 flex items-start gap-1.5 text-xs leading-5 text-[var(--cp-danger)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{assetError}</p> : null}
          {error ? <p className="m-0 flex items-start gap-1.5 text-xs leading-5 text-[var(--cp-danger)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{error}</p> : null}

          <details className="border-t border-[var(--cp-border-subtle)] pt-4">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--cp-text)]">AI 辅助修改底图（可选）</summary>
            <p className="mb-2 mt-2 text-[11px] leading-5 text-[var(--cp-text-faint)]">普通图层编辑不会调用模型。这里只在需要重绘底图内容时启动新的 Harness Turn。</p>
            <textarea
              className="min-h-20 w-full resize-y rounded-[8px] border border-[var(--cp-border)] px-3 py-2 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              placeholder="例如：仅移除背景中的衣架，保持商品不变"
              value={agentInstruction}
              onChange={(event) => setAgentInstruction(event.target.value)}
            />
            <Button type="button" size="sm" className="mt-2 w-full" disabled={running || agentSubmitting || !agentInstruction.trim()} onClick={() => void submitAgentEdit()}>
              {agentSubmitting || running ? <LoaderCircle className="size-3.5 animate-spin" /> : <SendHorizontal className="size-3.5" />}
              让 Agent 修改底图
            </Button>
            {agentStatus ? <p className="mb-0 mt-2 text-[11px] leading-5 text-[var(--cp-text-muted)]">{agentStatus}</p> : null}
          </details>
        </div>
      </aside>
    </div>
  );
}

function LayerEditorToolbar({
  tool,
  disabled,
  saving,
  onToolChange,
  onAddText,
  onAddRectangle,
  onAddEllipse,
  onAddImage,
  onUpload,
  uploading,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  design,
  onDesignChange,
  onExportPng,
  onExportJpeg,
  onSave,
}: {
  tool: EditorTool;
  disabled: boolean;
  saving: boolean;
  onToolChange: (tool: EditorTool) => void;
  onAddText: () => void;
  onAddRectangle: () => void;
  onAddEllipse: () => void;
  onAddImage: () => void;
  onUpload: () => void;
  uploading: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  design: { width: number; height: number; background: string };
  onDesignChange: (design: { width: number; height: number; background: string }) => void;
  onExportPng: () => void;
  onExportJpeg: () => void;
  onSave: () => void;
}) {
  return (
    <div className="absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-[12px] border border-white/10 bg-black/80 p-1.5 text-white shadow-[var(--cp-shadow-popover)] backdrop-blur-md">
      <ToolButton label="选择和移动" active={tool === "select"} disabled={disabled} onClick={() => onToolChange("select")}><MousePointer2 className="size-4" /></ToolButton>
      <ToolButton label="画笔" active={tool === "draw"} disabled={disabled} onClick={() => onToolChange("draw")}><PenLine className="size-4" /></ToolButton>
      <span className="mx-0.5 h-5 w-px bg-white/20" />
      <ToolButton label="上传 Logo 或图片" disabled={disabled || uploading} onClick={onUpload}>{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}</ToolButton>
      <ToolButton label="添加文字" disabled={disabled} onClick={onAddText}><Type className="size-4" /></ToolButton>
      <ToolButton label="添加矩形" disabled={disabled} onClick={onAddRectangle}><Square className="size-4" /></ToolButton>
      <ToolButton label="添加圆形" disabled={disabled} onClick={onAddEllipse}><Circle className="size-4" /></ToolButton>
      <ToolButton label="添加底图副本" disabled={disabled} onClick={onAddImage}><ImageIcon className="size-4" /></ToolButton>
      <span className="mx-0.5 h-5 w-px bg-white/20" />
      <ToolButton label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 className="size-4" /></ToolButton>
      <ToolButton label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 className="size-4" /></ToolButton>
      <select
        className="h-8 rounded-[7px] border border-white/15 bg-white/10 px-2 text-[11px] text-white outline-none"
        aria-label="设计画幅"
        value={`${design.width}x${design.height}`}
        onChange={(event) => {
          const preset = designPresets.find((item) => `${item.width}x${item.height}` === event.target.value);
          if (preset) onDesignChange({ ...design, width: preset.width, height: preset.height });
        }}
      >
        {designPresets.map((preset) => <option key={preset.label} value={`${preset.width}x${preset.height}`} className="text-black">{preset.label}</option>)}
      </select>
      <ToolButton label="导出 PNG" disabled={disabled} onClick={onExportPng}><Download className="size-4" /></ToolButton>
      <button type="button" className="h-8 rounded-[7px] px-2 text-[10px] hover:bg-white/15" disabled={disabled} onClick={onExportJpeg}>JPG</button>
      <ToolButton label="保存图层版本" disabled={disabled || saving} onClick={onSave}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}</ToolButton>
    </div>
  );
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={cn("flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30", active && "bg-white text-black hover:bg-white")} aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

function EditableLayer({
  layer,
  imageUrl,
  selected,
  stageRef,
  onSelect,
  onChange,
}: {
  layer: CreativeCanvasEditorLayer;
  imageUrl: string;
  selected: boolean;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (id: string) => void;
  onChange: (update: Partial<CreativeCanvasEditorLayer>) => void;
}) {
  const interactionRef = useRef<{
    type: "move" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  if (!layer.visible) return null;

  function begin(event: ReactPointerEvent<HTMLElement>, type: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    onSelect(layer.id);
    if (layer.locked) return;
    interactionRef.current = {
      type,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const interaction = interactionRef.current;
    const stage = stageRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || !stage) return;
    const bounds = stage.getBoundingClientRect();
    const dx = ((event.clientX - interaction.startX) / bounds.width) * 100;
    const dy = ((event.clientY - interaction.startY) / bounds.height) * 100;
    if (interaction.type === "move") {
      onChange({ x: clamp(interaction.x + dx, -100, 200), y: clamp(interaction.y + dy, -100, 200) });
    } else {
      onChange({ width: clamp(interaction.width + dx, 1, 200), height: clamp(interaction.height + dy, 1, 200) });
    }
  }

  function end(event: ReactPointerEvent<HTMLElement>) {
    if (interactionRef.current?.pointerId === event.pointerId) interactionRef.current = null;
  }

  return (
    <div
      className={cn("absolute touch-none", selected && "outline outline-2 outline-[var(--cp-focus)] outline-offset-1")}
      style={{ left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, transform: `rotate(${layer.rotation}deg)`, opacity: layer.opacity }}
      data-editor-layer={layer.kind}
      onPointerDown={(event) => begin(event, "move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(event) => { event.stopPropagation(); onSelect(layer.id); }}
    >
      <LayerVisual layer={layer} imageUrl={imageUrl} />
      {selected && !layer.locked ? (
        <button
          type="button"
          className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-full border-2 border-white bg-[var(--cp-text)]"
          aria-label={`调整${layer.name}大小`}
          onPointerDown={(event) => begin(event, "resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ) : null}
    </div>
  );
}

function LayerVisual({ layer, imageUrl }: { layer: CreativeCanvasEditorLayer; imageUrl: string }) {
  if (layer.kind === "text") {
    return <div className="size-full whitespace-pre-wrap break-words leading-tight" style={{ color: layer.color, fontSize: `${layer.fontSize}px`, fontWeight: layer.fontWeight, textAlign: layer.align, textShadow: "0 1px 4px rgba(0,0,0,.45)" }}>{layer.text}</div>;
  }
  if (layer.kind === "shape") {
    return <div className={cn("size-full", layer.shape === "ellipse" && "rounded-full")} style={{ backgroundColor: layer.fill, border: `${layer.strokeWidth}px solid ${layer.stroke}` }} />;
  }
  if (layer.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="底图副本图层" className={cn("size-full select-none", layer.fit === "cover" ? "object-cover" : "object-contain")} draggable={false} />;
  }
  return <DrawingPath points={layer.points} color={layer.stroke} width={layer.strokeWidth} />;
}

function DrawingPath({ points, color, width }: { points: Array<{ x: number; y: number }>; color: string; width: number }) {
  const path = useMemo(() => points.map((point) => `${point.x},${point.y}`).join(" "), [points]);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <polyline points={path} fill="none" stroke={color} strokeWidth={width / 4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function LayerList({
  layers,
  selectedLayerId,
  onSelect,
  onChange,
  onDelete,
  onMove,
}: {
  layers: CreativeCanvasEditorLayer[];
  selectedLayerId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, update: Partial<CreativeCanvasEditorLayer>) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2"><Layers3 className="size-4 text-[var(--cp-text-muted)]" /><h3 className="m-0 text-xs font-semibold">图层</h3><span className="ml-auto text-[10px] text-[var(--cp-text-faint)]">{layers.length + 1}</span></div>
      <div className="space-y-1">
        {[...layers].reverse().map((layer) => (
          <div key={layer.id} className={cn("flex items-center gap-1 rounded-[7px] border px-1 py-1", selectedLayerId === layer.id ? "border-[var(--cp-text)] bg-[var(--cp-bg-subtle)]" : "border-transparent hover:bg-[var(--cp-bg-subtle)]")}>
            <button type="button" className="min-w-0 flex-1 truncate px-1 text-left text-xs" onClick={() => onSelect(layer.id)}>{layer.name}</button>
            <LayerIconButton label={layer.visible ? "隐藏图层" : "显示图层"} onClick={() => onChange(layer.id, { visible: !layer.visible })}>{layer.visible ? <Eye /> : <EyeOff />}</LayerIconButton>
            <LayerIconButton label={layer.locked ? "解锁图层" : "锁定图层"} onClick={() => onChange(layer.id, { locked: !layer.locked })}>{layer.locked ? <Lock /> : <Unlock />}</LayerIconButton>
            <LayerIconButton label="上移图层" onClick={() => onMove(layer.id, "up")}><ArrowUp /></LayerIconButton>
            <LayerIconButton label="下移图层" onClick={() => onMove(layer.id, "down")}><ArrowDown /></LayerIconButton>
            <LayerIconButton label="删除图层" danger onClick={() => onDelete(layer.id)}><Trash2 /></LayerIconButton>
          </div>
        ))}
        <div className="flex items-center gap-2 rounded-[7px] border border-transparent px-2 py-2 text-xs text-[var(--cp-text-muted)]"><ImageIcon className="size-3.5" /><span className="min-w-0 flex-1 truncate">原始底图</span><Lock className="size-3.5" /></div>
      </div>
    </section>
  );
}

function LayerIconButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactElement<{ className?: string }> }) {
  return <button type="button" className={cn("flex size-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface)] hover:text-[var(--cp-text)] [&_svg]:size-3", danger && "hover:text-[var(--cp-danger)]")} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function LayerProperties({ layer, onChange }: { layer: CreativeCanvasEditorLayer; onChange: (update: Partial<CreativeCanvasEditorLayer>) => void }) {
  return (
    <section className="border-t border-[var(--cp-border-subtle)] pt-4">
      <h3 className="m-0 mb-3 text-xs font-semibold">属性</h3>
      <label className="grid gap-1 text-[10px] text-[var(--cp-text-muted)]">图层名称<input className="h-8 rounded-[6px] border border-[var(--cp-border)] px-2 text-xs text-[var(--cp-text)] outline-none" value={layer.name} onChange={(event) => onChange({ name: event.target.value.slice(0, 120) })} /></label>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <NumberProperty label="X" value={layer.x} min={-100} max={200} onChange={(value) => onChange({ x: value })} />
        <NumberProperty label="Y" value={layer.y} min={-100} max={200} onChange={(value) => onChange({ y: value })} />
        <NumberProperty label="宽" value={layer.width} min={1} max={200} onChange={(value) => onChange({ width: value })} />
        <NumberProperty label="高" value={layer.height} min={1} max={200} onChange={(value) => onChange({ height: value })} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberProperty label="旋转" value={layer.rotation} min={-360} max={360} onChange={(value) => onChange({ rotation: value })} />
        <NumberProperty label="透明度 %" value={Math.round(layer.opacity * 100)} min={0} max={100} onChange={(value) => onChange({ opacity: value / 100 })} />
      </div>
      {layer.kind === "text" ? <TextProperties layer={layer} onChange={onChange} /> : null}
      {layer.kind === "shape" ? <ShapeProperties layer={layer} onChange={onChange} /> : null}
      {layer.kind === "drawing" ? <DrawingProperties layer={layer} onChange={onChange} /> : null}
      {layer.kind === "image" ? <ImageProperties layer={layer} onChange={onChange} /> : null}
    </section>
  );
}

function TextProperties({ layer, onChange }: { layer: CreativeCanvasEditorTextLayer; onChange: (update: Partial<CreativeCanvasEditorLayer>) => void }) {
  return <div className="mt-3 space-y-2"><label className="grid gap-1 text-[10px] text-[var(--cp-text-muted)]">文字<textarea className="min-h-16 resize-y rounded-[6px] border border-[var(--cp-border)] p-2 text-xs" value={layer.text} onChange={(event) => onChange({ text: event.target.value.slice(0, 2_000) })} /></label><div className="grid grid-cols-2 gap-2"><NumberProperty label="字号" value={layer.fontSize} min={8} max={240} onChange={(value) => onChange({ fontSize: value })} /><ColorProperty label="颜色" value={layer.color} onChange={(value) => onChange({ color: value })} /></div><div className="flex gap-1">{(["left", "center", "right"] as const).map((align) => <button key={align} type="button" className={cn("flex size-8 items-center justify-center rounded-[6px]", layer.align === align && "bg-[var(--cp-bg-subtle)]")} aria-label={align === "left" ? "左对齐" : align === "center" ? "居中" : "右对齐"} onClick={() => onChange({ align })}>{align === "left" ? <AlignLeft className="size-3.5" /> : align === "center" ? <AlignCenter className="size-3.5" /> : <AlignRight className="size-3.5" />}</button>)}</div></div>;
}

function ShapeProperties({ layer, onChange }: { layer: CreativeCanvasEditorShapeLayer; onChange: (update: Partial<CreativeCanvasEditorLayer>) => void }) {
  return <div className="mt-3 grid grid-cols-2 gap-2"><ColorProperty label="填充" value={layer.fill} onChange={(value) => onChange({ fill: value })} /><ColorProperty label="描边" value={layer.stroke} onChange={(value) => onChange({ stroke: value })} /><NumberProperty label="描边宽度" value={layer.strokeWidth} min={0} max={40} onChange={(value) => onChange({ strokeWidth: value })} /></div>;
}

function DrawingProperties({ layer, onChange }: { layer: CreativeCanvasEditorDrawingLayer; onChange: (update: Partial<CreativeCanvasEditorLayer>) => void }) {
  return <div className="mt-3 grid grid-cols-2 gap-2"><ColorProperty label="画笔颜色" value={layer.stroke} onChange={(value) => onChange({ stroke: value })} /><NumberProperty label="画笔宽度" value={layer.strokeWidth} min={1} max={80} onChange={(value) => onChange({ strokeWidth: value })} /></div>;
}

function ImageProperties({ layer, onChange }: { layer: CreativeCanvasEditorImageLayer; onChange: (update: Partial<CreativeCanvasEditorLayer>) => void }) {
  const crop = layer.crop ?? { x: 0, y: 0, width: 100, height: 100 };
  const filters = layer.filters ?? { brightness: 0, contrast: 0, saturation: 0, blur: 0 };
  return (
    <div className="mt-3 space-y-3">
      <label className="grid gap-1 text-[10px] text-[var(--cp-text-muted)]">适配方式<select className="h-8 rounded-[6px] border border-[var(--cp-border)] bg-white px-2 text-xs" value={layer.fit} onChange={(event) => onChange({ fit: event.target.value as "contain" | "cover" })}><option value="contain">完整显示</option><option value="cover">填满裁切</option></select></label>
      <div>
        <div className="mb-1 text-[10px] font-medium text-[var(--cp-text-muted)]">裁剪窗口</div>
        <div className="grid grid-cols-4 gap-1.5">
          <NumberProperty label="左" value={crop.x} min={0} max={100 - crop.width} onChange={(value) => onChange({ crop: { ...crop, x: value } })} />
          <NumberProperty label="上" value={crop.y} min={0} max={100 - crop.height} onChange={(value) => onChange({ crop: { ...crop, y: value } })} />
          <NumberProperty label="宽" value={crop.width} min={1} max={100 - crop.x} onChange={(value) => onChange({ crop: { ...crop, width: value } })} />
          <NumberProperty label="高" value={crop.height} min={1} max={100 - crop.y} onChange={(value) => onChange({ crop: { ...crop, height: value } })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <RangeProperty label="亮度" value={filters.brightness} min={-1} max={1} step={0.05} onChange={(value) => onChange({ filters: { ...filters, brightness: value } })} />
        <RangeProperty label="对比度" value={filters.contrast} min={-1} max={1} step={0.05} onChange={(value) => onChange({ filters: { ...filters, contrast: value } })} />
        <RangeProperty label="饱和度" value={filters.saturation} min={-1} max={1} step={0.05} onChange={(value) => onChange({ filters: { ...filters, saturation: value } })} />
        <RangeProperty label="模糊" value={filters.blur} min={0} max={1} step={0.05} onChange={(value) => onChange({ filters: { ...filters, blur: value } })} />
      </div>
    </div>
  );
}

function NumberProperty({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="grid gap-1 text-[10px] text-[var(--cp-text-muted)]">{label}<input type="number" min={min} max={max} className="h-8 min-w-0 rounded-[6px] border border-[var(--cp-border)] px-2 text-xs text-[var(--cp-text)] outline-none" value={Math.round(value * 100) / 100} onChange={(event) => onChange(clamp(Number(event.target.value) || 0, min, max))} /></label>;
}

function ColorProperty({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-[10px] text-[var(--cp-text-muted)]">{label}<span className="flex h-8 items-center gap-2 rounded-[6px] border border-[var(--cp-border)] px-2"><input type="color" className="size-5 border-0 bg-transparent p-0" value={value} onChange={(event) => onChange(event.target.value)} /><span className="text-[10px] uppercase">{value}</span></span></label>;
}

function RangeProperty({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="grid gap-1 text-[10px] text-[var(--cp-text-muted)]">{label}<input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /><span className="text-right text-[9px] tabular-nums text-[var(--cp-text-faint)]">{value.toFixed(2)}</span></label>;
}

function moveLayer(layers: CreativeCanvasEditorLayer[], layerId: string, direction: "up" | "down"): CreativeCanvasEditorLayer[] {
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index === -1) return layers;
  const target = direction === "up" ? Math.min(layers.length - 1, index + 1) : Math.max(0, index - 1);
  if (target === index) return layers;
  const next = [...layers];
  const [layer] = next.splice(index, 1);
  if (layer) next.splice(target, 0, layer);
  return next;
}

function stagePoint(event: ReactPointerEvent<HTMLElement>, stage: HTMLElement) {
  const bounds = stage.getBoundingClientRect();
  return { x: clamp(((event.clientX - bounds.left) / bounds.width) * 100, 0, 100), y: clamp(((event.clientY - bounds.top) / bounds.height) * 100, 0, 100) };
}

function editorLayerId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
