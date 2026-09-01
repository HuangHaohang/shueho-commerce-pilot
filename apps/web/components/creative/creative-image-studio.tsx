"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  CircleAlert,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  MessageSquarePlus,
  MousePointer2,
  Plus,
  Save,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GeneratedImageItem } from "@/lib/agent/use-agent-thread";
import type { ImageStudioRequest } from "@/lib/creative/creative-canvas-navigation";
import type {
  CreativeCanvasImageContent,
  CreativeCanvasImageTextLayer,
  CreativeCanvasNodeRecord,
  CreativeCanvasState,
} from "@/lib/creative/creative-canvas-types";
import { cn } from "@/lib/utils";

type ImageStudioView = "focused" | "canvas" | "edit";

type ImageAnnotation = {
  id: string;
  x: number;
  y: number;
  text: string;
};

export type ImageEditSubmission = {
  message: string;
  sourceFilenames: string[];
};

const studioViews = [
  { value: "focused", label: "Focused", icon: ImageIcon },
  { value: "canvas", label: "Canvas", icon: Images },
  { value: "edit", label: "Edit", icon: Sparkles },
] as const;

export function CreativeImageStudio({
  threadId,
  request,
  images,
  running,
  onClose,
  onSubmitEdit,
}: {
  threadId: string;
  request: NonNullable<ImageStudioRequest>;
  images: readonly GeneratedImageItem[];
  running: boolean;
  onClose: () => void;
  onSubmitEdit: (submission: ImageEditSubmission) => Promise<boolean>;
}) {
  const [view, setView] = useState<ImageStudioView>("focused");
  const [activeFilename, setActiveFilename] = useState(request.filename);
  const [selectedFilenames, setSelectedFilenames] = useState<Set<string>>(
    () => new Set([request.filename]),
  );
  const [zoom, setZoom] = useState(1);
  const [instruction, setInstruction] = useState("");
  const [preserve, setPreserve] = useState("保持商品主体、结构、颜色和品牌信息不变");
  const [aspectRatio, setAspectRatio] = useState("保持原图");
  const [annotations, setAnnotations] = useState<ImageAnnotation[]>([]);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [canvasNode, setCanvasNode] = useState<CreativeCanvasNodeRecord | null>(null);
  const [imageContent, setImageContent] = useState<CreativeCanvasImageContent | null>(null);
  const [loadingNode, setLoadingNode] = useState(false);
  const [savingLayers, setSavingLayers] = useState(false);
  const [layerError, setLayerError] = useState<string | null>(null);
  const previousImageCountRef = useRef(images.length);

  const imageByFilename = useMemo(
    () => new Map(images.map((image) => [image.filename, image])),
    [images],
  );
  const activeImage = imageByFilename.get(activeFilename) ?? {
    id: request.artifactId,
    sequence: 0,
    turnId: null,
    url: request.url,
    filename: request.filename,
    model: request.model,
    sourceFilenames: [],
  };
  const versionNumber = imageVersionNumber(activeImage, imageByFilename);

  useEffect(() => {
    setView("focused");
    setActiveFilename(request.filename);
    setSelectedFilenames(new Set([request.filename]));
    setZoom(1);
    setInstruction("");
    setAnnotations([]);
    setAnnotationMode(false);
    setSubmitError(null);
    setSubmitStatus(null);
    previousImageCountRef.current = images.length;
  }, [request.nonce]);

  useEffect(() => {
    if (images.length <= previousImageCountRef.current) {
      previousImageCountRef.current = images.length;
      return;
    }
    const newImages = images.slice(previousImageCountRef.current);
    previousImageCountRef.current = images.length;
    const edited = [...newImages].reverse().find((image) =>
      image.sourceFilenames.some((filename) => selectedFilenames.has(filename)));
    if (!edited) return;
    setActiveFilename(edited.filename);
    setSelectedFilenames(new Set([edited.filename]));
    setView("focused");
    setSubmitStatus("新版本已生成并加入当前 Canvas。");
  }, [images, selectedFilenames]);

  useEffect(() => {
    let cancelled = false;
    setLoadingNode(true);
    setLayerError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/canvas`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | (CreativeCanvasState & { error?: string })
          | null;
        if (!response.ok || !payload) throw new Error(payload?.error || "无法读取图片图层。");
        if (cancelled) return;
        const matched = payload.nodes.find((node) => {
          if (node.nodeType !== "image" || node.revision.content.kind !== "image") return false;
          return node.revision.content.image.filename === activeFilename ||
            node.revision.content.image.artifactId === activeFilename;
        }) ?? null;
        setCanvasNode(matched);
        setImageContent(matched?.revision.content.kind === "image" ? matched.revision.content : null);
      } catch (error) {
        if (!cancelled) setLayerError(error instanceof Error ? error.message : "无法读取图片图层。");
      } finally {
        if (!cancelled) setLoadingNode(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFilename, threadId]);

  function toggleSelected(filename: string) {
    setSelectedFilenames((current) => {
      const next = new Set(current);
      if (next.has(filename)) {
        if (next.size > 1) next.delete(filename);
      } else if (next.size < 4) {
        next.add(filename);
      }
      return next;
    });
  }

  function addAnnotation(event: PointerEvent<HTMLDivElement>) {
    if (!annotationMode || view !== "edit") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(98, Math.max(2, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.min(98, Math.max(2, ((event.clientY - bounds.top) / bounds.height) * 100));
    setAnnotations((current) => [
      ...current,
      { id: crypto.randomUUID(), x, y, text: "" },
    ]);
    setAnnotationMode(false);
  }

  async function submitEdit() {
    const trimmed = instruction.trim();
    const annotationText = annotations.some((annotation) => annotation.text.trim());
    if (!trimmed && !annotationText) {
      setSubmitError("请描述需要修改的内容，或先添加区域标注。");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setSubmitStatus(null);
    const sourceFilenames = [...selectedFilenames];
    try {
      const accepted = await onSubmitEdit({
        sourceFilenames,
        message: buildImageEditMessage({
          instruction: trimmed,
          preserve,
          aspectRatio,
          annotations,
          sourceCount: sourceFilenames.length,
        }),
      });
      if (!accepted) {
        setSubmitError("图片编辑任务未被接收，请检查当前任务状态后重试。");
        return;
      }
      setInstruction("");
      setAnnotations([]);
      setAnnotationMode(false);
      setSubmitStatus("编辑任务已提交到当前 Codex 对话，正在生成新版本。");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "无法提交图片编辑任务。");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveTextLayers() {
    if (!canvasNode || !imageContent) return;
    setSavingLayers(true);
    setLayerError(null);
    try {
      const response = await fetch(
        `/api/agent/threads/${encodeURIComponent(threadId)}/canvas/nodes/${encodeURIComponent(canvasNode.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: {
              kind: "image",
              title: imageContent.title,
              description: imageContent.description,
              textLayers: imageContent.textLayers,
              complianceNotes: imageContent.complianceNotes,
            },
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        node?: CreativeCanvasNodeRecord;
        error?: string;
      } | null;
      if (!response.ok || !payload?.node || payload.node.revision.content.kind !== "image") {
        throw new Error(payload?.error || "无法保存文字图层。");
      }
      setCanvasNode(payload.node);
      setImageContent(payload.node.revision.content);
    } catch (error) {
      setLayerError(error instanceof Error ? error.message : "无法保存文字图层。");
    } finally {
      setSavingLayers(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showClose={false}
        className="left-auto right-0 top-0 z-[120] flex h-dvh max-h-none w-full max-w-[1120px] translate-x-0 translate-y-0 flex-col rounded-none border-y-0 border-r-0 bg-[var(--cp-bg)] xl:w-[calc(100vw_-_var(--cp-sidebar-width))]"
      >
        <DialogDescription className="sr-only">
          查看同一对话生成的图片、添加区域反馈和文字图层，并在当前 Codex thread 中生成编辑版本。
        </DialogDescription>
        <header className="flex min-h-[var(--cp-topbar-height)] shrink-0 items-center gap-3 border-b border-[var(--cp-border)] px-3 md:px-4">
          <span className="flex size-9 items-center justify-center rounded-[var(--cp-radius-control)] bg-[var(--cp-bg-subtle)] text-[var(--cp-text-muted)]">
            <ImageIcon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm">{request.title || "图片工作区"}</DialogTitle>
            <div className="mt-0.5 truncate text-[11px] text-[var(--cp-text-faint)]">
              第 {versionNumber} 版 · {activeImage.model} · 原图保持不可覆盖
            </div>
          </div>
          <div className="hidden rounded-[var(--cp-radius-segment)] bg-[var(--cp-bg-muted)] p-0.5 sm:flex" role="tablist" aria-label="图片工作区视图">
            {studioViews.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={view === item.value}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-[var(--cp-radius-control)] px-3 text-xs text-[var(--cp-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                  view === item.value && "bg-[var(--cp-surface)] font-medium text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]",
                )}
                onClick={() => setView(item.value)}
              >
                <item.icon className="size-3.5" aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="关闭图片工作区" onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </header>

        <div className="grid grid-cols-3 gap-1 border-b border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] p-1 sm:hidden" role="tablist" aria-label="图片工作区视图">
          {studioViews.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={view === item.value}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-[var(--cp-radius-control)] text-xs text-[var(--cp-text-muted)]",
                view === item.value && "bg-[var(--cp-surface)] font-medium text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]",
              )}
              onClick={() => setView(item.value)}
            >
              <item.icon className="size-3.5" aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>

        {view === "canvas" ? (
          <ImageCanvasView
            images={images}
            activeFilename={activeFilename}
            selectedFilenames={selectedFilenames}
            imageByFilename={imageByFilename}
            onActivate={setActiveFilename}
            onToggleSelected={toggleSelected}
            onEdit={() => setView("edit")}
          />
        ) : (
          <div className={cn("min-h-0 flex-1", view === "edit" ? "grid lg:grid-cols-[minmax(0,1fr)_340px]" : "flex flex-col")}>
            <div className="relative flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden bg-[#202020]">
              <ImageStage
                image={activeImage}
                zoom={zoom}
                textLayers={imageContent?.textLayers ?? []}
                annotations={annotations}
                annotationMode={annotationMode}
                editing={view === "edit"}
                onAddAnnotation={addAnnotation}
              />
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 p-1 text-white shadow-[var(--cp-shadow-popover)]">
                <StudioIconButton label="缩小图片" disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}>
                  <ZoomOut className="size-4" />
                </StudioIconButton>
                <button type="button" className="h-8 min-w-12 rounded-full px-2 text-[11px] tabular-nums hover:bg-white/10" onClick={() => setZoom(1)}>
                  {Math.round(zoom * 100)}%
                </button>
                <StudioIconButton label="放大图片" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.1))}>
                  <ZoomIn className="size-4" />
                </StudioIconButton>
              </div>
              {view === "focused" ? (
                <div className="absolute right-3 top-3 flex items-center gap-2">
                  <Button type="button" variant="subtle" size="sm" className="rounded-full bg-white/90" onClick={() => setView("canvas")}>
                    <Images className="size-3.5" />
                    全部版本
                  </Button>
                  <Button type="button" size="sm" className="rounded-full" onClick={() => setView("edit")}>
                    <Sparkles className="size-3.5" />
                    编辑图片
                  </Button>
                </div>
              ) : null}
            </div>
            {view === "edit" ? (
              <ImageEditInspector
                images={images}
                selectedFilenames={selectedFilenames}
                instruction={instruction}
                preserve={preserve}
                aspectRatio={aspectRatio}
                annotations={annotations}
                annotationMode={annotationMode}
                imageContent={imageContent}
                loadingNode={loadingNode}
                savingLayers={savingLayers}
                layerError={layerError}
                running={running}
                submitting={submitting}
                submitError={submitError}
                submitStatus={submitStatus}
                onInstructionChange={setInstruction}
                onPreserveChange={setPreserve}
                onAspectRatioChange={setAspectRatio}
                onToggleSelected={toggleSelected}
                onAnnotationModeChange={setAnnotationMode}
                onAnnotationsChange={setAnnotations}
                onImageContentChange={setImageContent}
                onSaveTextLayers={saveTextLayers}
                onSubmit={submitEdit}
              />
            ) : (
              <footer className="flex min-h-14 shrink-0 items-center gap-3 border-t border-[var(--cp-border)] bg-[var(--cp-surface)] px-4">
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--cp-text-muted)]">
                  {activeImage.sourceFilenames.length
                    ? `由 ${activeImage.sourceFilenames.length} 张图片编辑生成`
                    : "Codex 原生图片产物"}
                </span>
                <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setView("edit")}>
                  <Sparkles className="size-3.5" />
                  继续创作
                </Button>
              </footer>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImageStage({
  image,
  zoom,
  textLayers,
  annotations,
  annotationMode,
  editing,
  onAddAnnotation,
}: {
  image: GeneratedImageItem;
  zoom: number;
  textLayers: CreativeCanvasImageTextLayer[];
  annotations: ImageAnnotation[];
  annotationMode: boolean;
  editing: boolean;
  onAddAnnotation: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-5 md:p-8",
        editing && annotationMode && "cursor-crosshair",
      )}
      data-image-studio-stage
      onPointerDown={onAddAnnotation}
    >
      <div
        className="relative max-h-full max-w-full origin-center transition-transform duration-[var(--cp-duration-fast)]"
        style={{ transform: `scale(${zoom})` }}
      >
        {/* Generated images are served by authenticated same-origin routes. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt="图片工作区当前图片" className="block max-h-[calc(100dvh-190px)] max-w-full select-none object-contain" draggable={false} />
        {textLayers.map((layer) => (
          <div
            key={layer.id}
            className="pointer-events-none absolute whitespace-pre-wrap font-medium text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.65)]"
            style={{
              left: `${layer.x}%`,
              top: `${layer.y}%`,
              width: `${layer.width}%`,
              fontSize: `${layer.fontSize}px`,
              textAlign: layer.align,
            }}
          >
            {layer.text}
          </div>
        ))}
        {annotations.map((annotation, index) => (
          <span
            key={annotation.id}
            className="pointer-events-none absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[var(--cp-text)] text-[11px] font-semibold text-white shadow-[var(--cp-shadow-popover)]"
            style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
          >
            {index + 1}
          </span>
        ))}
      </div>
      {editing && annotationMode ? (
        <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white">
          <MousePointer2 className="size-3.5" />
          点击图片添加修改标注
        </div>
      ) : null}
    </div>
  );
}

function ImageCanvasView({
  images,
  activeFilename,
  selectedFilenames,
  imageByFilename,
  onActivate,
  onToggleSelected,
  onEdit,
}: {
  images: readonly GeneratedImageItem[];
  activeFilename: string;
  selectedFilenames: ReadonlySet<string>;
  imageByFilename: ReadonlyMap<string, GeneratedImageItem>;
  onActivate: (filename: string) => void;
  onToggleSelected: (filename: string) => void;
  onEdit: () => void;
}) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-[var(--cp-bg-subtle)] p-4 md:p-6" aria-label="同一对话的图片 Canvas">
      <div className="mx-auto flex max-w-[980px] items-center gap-3 pb-4">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-semibold text-[var(--cp-text)]">对话图片 Canvas</h2>
          <p className="m-0 mt-1 text-xs text-[var(--cp-text-muted)]">选择最多 4 张图片作为下一次编辑输入，原图和历史版本都会保留。</p>
        </div>
        <Button type="button" size="sm" className="rounded-full" onClick={onEdit}>
          <Sparkles className="size-3.5" />
          编辑所选图片
        </Button>
      </div>
      <div className="mx-auto grid max-w-[980px] grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {images.map((image) => {
          const selected = selectedFilenames.has(image.filename);
          const active = image.filename === activeFilename;
          return (
            <article
              key={image.id}
              className={cn(
                "group overflow-hidden rounded-[var(--cp-radius-panel)] border bg-[var(--cp-surface)] shadow-[var(--cp-shadow-soft)]",
                active ? "border-[var(--cp-text)]" : "border-[var(--cp-border)]",
              )}
            >
              <button type="button" className="relative block aspect-square w-full overflow-hidden bg-[var(--cp-bg-muted)] p-0" onClick={() => onActivate(image.filename)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={`图片版本 ${imageVersionNumber(image, imageByFilename)}`} className="size-full object-cover transition-transform duration-[var(--cp-duration-fast)] group-hover:scale-[1.015]" />
                <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white">
                  第 {imageVersionNumber(image, imageByFilename)} 版
                </span>
              </button>
              <div className="flex items-center gap-2 px-2.5 py-2">
                <button
                  type="button"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-[6px] border",
                    selected ? "border-[var(--cp-text)] bg-[var(--cp-text)] text-white" : "border-[var(--cp-border)] text-transparent",
                  )}
                  aria-label={selected ? "取消选择此图片" : "选择此图片用于编辑"}
                  onClick={() => onToggleSelected(image.filename)}
                >
                  <Check className="size-3.5" />
                </button>
                <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--cp-text-muted)]">{image.model}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ImageEditInspector({
  images,
  selectedFilenames,
  instruction,
  preserve,
  aspectRatio,
  annotations,
  annotationMode,
  imageContent,
  loadingNode,
  savingLayers,
  layerError,
  running,
  submitting,
  submitError,
  submitStatus,
  onInstructionChange,
  onPreserveChange,
  onAspectRatioChange,
  onToggleSelected,
  onAnnotationModeChange,
  onAnnotationsChange,
  onImageContentChange,
  onSaveTextLayers,
  onSubmit,
}: {
  images: readonly GeneratedImageItem[];
  selectedFilenames: ReadonlySet<string>;
  instruction: string;
  preserve: string;
  aspectRatio: string;
  annotations: ImageAnnotation[];
  annotationMode: boolean;
  imageContent: CreativeCanvasImageContent | null;
  loadingNode: boolean;
  savingLayers: boolean;
  layerError: string | null;
  running: boolean;
  submitting: boolean;
  submitError: string | null;
  submitStatus: string | null;
  onInstructionChange: (value: string) => void;
  onPreserveChange: (value: string) => void;
  onAspectRatioChange: (value: string) => void;
  onToggleSelected: (filename: string) => void;
  onAnnotationModeChange: (value: boolean) => void;
  onAnnotationsChange: (value: ImageAnnotation[]) => void;
  onImageContentChange: (value: CreativeCanvasImageContent) => void;
  onSaveTextLayers: () => Promise<void>;
  onSubmit: () => Promise<void>;
}) {
  return (
    <aside className="min-h-0 overflow-y-auto border-t border-[var(--cp-border)] bg-[var(--cp-surface)] lg:border-l lg:border-t-0" aria-label="图片编辑工具">
      <div className="space-y-5 p-4">
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="m-0 text-xs font-semibold text-[var(--cp-text)]">编辑来源</h3>
            <span className="text-[10px] text-[var(--cp-text-faint)]">{selectedFilenames.size}/4</span>
          </div>
          <div className="cp-flat-scrollbar flex gap-2 overflow-x-auto pb-1">
            {images.map((image) => {
              const selected = selectedFilenames.has(image.filename);
              return (
                <button
                  key={image.id}
                  type="button"
                  className={cn(
                    "relative size-14 shrink-0 overflow-hidden rounded-[8px] border bg-[var(--cp-bg-subtle)]",
                    selected ? "border-[var(--cp-text)] ring-1 ring-[var(--cp-text)]" : "border-[var(--cp-border)] opacity-60",
                  )}
                  aria-label={selected ? "取消此编辑来源" : "添加为编辑来源"}
                  onClick={() => onToggleSelected(image.filename)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt="" className="size-full object-cover" />
                  {selected ? <Check className="absolute right-1 top-1 size-4 rounded-full bg-black/70 p-0.5 text-white" /> : null}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <label className="mb-2 block text-xs font-semibold text-[var(--cp-text)]" htmlFor="image-edit-instruction">修改要求</label>
          <textarea
            id="image-edit-instruction"
            className="min-h-28 w-full resize-y rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-bg)] px-3 py-2 text-sm leading-6 text-[var(--cp-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
            placeholder="例如：移除衣架，改成暖灰影棚背景，保留短裤的水洗纹理和白色抽绳。"
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
          />
        </section>

        <section className="grid gap-3">
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--cp-text)]">
            必须保留
            <input
              className="h-9 rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-bg)] px-3 text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              value={preserve}
              onChange={(event) => onPreserveChange(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--cp-text)]">
            输出画幅
            <select
              className="h-9 rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-bg)] px-3 text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              value={aspectRatio}
              onChange={(event) => onAspectRatioChange(event.target.value)}
            >
              <option>保持原图</option>
              <option>1:1 商品主图</option>
              <option>4:5 竖版</option>
              <option>16:9 横版</option>
            </select>
          </label>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="m-0 text-xs font-semibold text-[var(--cp-text)]">区域反馈</h3>
            <Button type="button" variant={annotationMode ? "subtle" : "outline"} size="sm" className="h-7 px-2 text-[11px]" onClick={() => onAnnotationModeChange(!annotationMode)}>
              <MessageSquarePlus className="size-3.5" />
              {annotationMode ? "点击图片标注" : "添加标注"}
            </Button>
          </div>
          <div className="space-y-2">
            {annotations.map((annotation, index) => (
              <div key={annotation.id} className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--cp-text)] text-[10px] font-semibold text-white">{index + 1}</span>
                <input
                  className="h-8 min-w-0 flex-1 rounded-[7px] border border-[var(--cp-border)] px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                  placeholder="说明这个区域需要怎么改"
                  value={annotation.text}
                  onChange={(event) => onAnnotationsChange(annotations.map((item) => item.id === annotation.id ? { ...item, text: event.target.value } : item))}
                />
                <button type="button" className="flex size-7 items-center justify-center rounded-[6px] text-[var(--cp-text-faint)] hover:bg-[var(--cp-bg-subtle)] hover:text-[var(--cp-danger)]" aria-label={`删除标注 ${index + 1}`} onClick={() => onAnnotationsChange(annotations.filter((item) => item.id !== annotation.id))}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {!annotations.length ? <p className="m-0 text-[11px] leading-5 text-[var(--cp-text-faint)]">可直接点击图片定位需要修改的区域，标注会随编辑指令提交给 Agent。</p> : null}
          </div>
        </section>

        <section className="border-t border-[var(--cp-border-subtle)] pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="m-0 text-xs font-semibold text-[var(--cp-text)]">文字图层</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={!imageContent || imageContent.textLayers.length >= 24}
              onClick={() => {
                if (!imageContent) return;
                onImageContentChange({
                  ...imageContent,
                  textLayers: [
                    ...imageContent.textLayers,
                    { id: `text-${crypto.randomUUID()}`, text: "输入图片文案", x: 8, y: 8, width: 48, fontSize: 28, align: "left" },
                  ],
                });
              }}
            >
              <Plus className="size-3.5" />
              添加文字
            </Button>
          </div>
          {loadingNode ? (
            <div className="flex items-center gap-2 text-[11px] text-[var(--cp-text-muted)]"><LoaderCircle className="size-3.5 animate-spin" />读取图层</div>
          ) : imageContent ? (
            <div className="space-y-3">
              {imageContent.textLayers.map((layer, index) => (
                <TextLayerInspector
                  key={layer.id}
                  layer={layer}
                  index={index}
                  onChange={(next) => onImageContentChange({
                    ...imageContent,
                    textLayers: imageContent.textLayers.map((item) => item.id === layer.id ? next : item),
                  })}
                  onDelete={() => onImageContentChange({
                    ...imageContent,
                    textLayers: imageContent.textLayers.filter((item) => item.id !== layer.id),
                  })}
                />
              ))}
              <Button type="button" variant="outline" size="sm" className="w-full" disabled={savingLayers} onClick={() => void onSaveTextLayers()}>
                {savingLayers ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                保存文字图层
              </Button>
            </div>
          ) : (
            <p className="m-0 text-[11px] leading-5 text-[var(--cp-text-faint)]">当前图片尚未完成画布节点同步，模型编辑仍可正常使用。</p>
          )}
          {layerError ? <p className="m-0 mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-[var(--cp-danger)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{layerError}</p> : null}
        </section>

        {submitError ? <p className="m-0 flex items-start gap-1.5 text-xs leading-5 text-[var(--cp-danger)]" role="alert"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{submitError}</p> : null}
        {submitStatus ? <p className="m-0 text-xs leading-5 text-[var(--cp-success)]" role="status">{submitStatus}</p> : null}
      </div>
      <footer className="sticky bottom-0 border-t border-[var(--cp-border)] bg-[var(--cp-surface)] p-3">
        <Button type="button" className="w-full" disabled={running || submitting || !selectedFilenames.size} onClick={() => void onSubmit()}>
          {running || submitting ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
          {running ? "当前对话正在处理" : submitting ? "正在提交" : "生成编辑版本"}
        </Button>
        <p className="m-0 mt-2 text-center text-[10px] leading-4 text-[var(--cp-text-faint)]">提交后会在同一 Codex thread 中生成新的原生图片版本。</p>
      </footer>
    </aside>
  );
}

function TextLayerInspector({
  layer,
  index,
  onChange,
  onDelete,
}: {
  layer: CreativeCanvasImageTextLayer;
  index: number;
  onChange: (layer: CreativeCanvasImageTextLayer) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-[8px] border border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] p-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-medium text-[var(--cp-text-muted)]">图层 {index + 1}</span>
        <button type="button" className="ml-auto flex size-6 items-center justify-center rounded-[6px] text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface)] hover:text-[var(--cp-danger)]" aria-label={`删除文字图层 ${index + 1}`} onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <input className="h-8 w-full rounded-[6px] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-2 text-xs outline-none" value={layer.text} aria-label={`文字图层 ${index + 1} 内容`} onChange={(event) => onChange({ ...layer, text: event.target.value })} />
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <NumberField label="X" value={layer.x} min={0} max={100} onChange={(value) => onChange({ ...layer, x: value })} />
        <NumberField label="Y" value={layer.y} min={0} max={100} onChange={(value) => onChange({ ...layer, y: value })} />
        <NumberField label="宽" value={layer.width} min={8} max={100} onChange={(value) => onChange({ ...layer, width: value })} />
        <NumberField label="字号" value={layer.fontSize} min={12} max={72} onChange={(value) => onChange({ ...layer, fontSize: value })} />
      </div>
      <div className="mt-2 flex gap-1">
        {(["left", "center", "right"] as const).map((align) => (
          <button key={align} type="button" className={cn("flex size-7 items-center justify-center rounded-[6px] text-[var(--cp-text-muted)]", layer.align === align && "bg-[var(--cp-surface)] text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]")} aria-label={`${index + 1} 图层${align === "left" ? "左对齐" : align === "center" ? "居中" : "右对齐"}`} onClick={() => onChange({ ...layer, align })}>
            {align === "left" ? <AlignLeft className="size-3.5" /> : align === "center" ? <AlignCenter className="size-3.5" /> : <AlignRight className="size-3.5" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-[9px] text-[var(--cp-text-faint)]">
      {label}
      <input type="number" min={min} max={max} className="h-7 min-w-0 rounded-[6px] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-1.5 text-[10px] text-[var(--cp-text)] outline-none" value={Math.round(value)} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || min)))} />
    </label>
  );
}

function StudioIconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="flex size-8 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function buildImageEditMessage({
  instruction,
  preserve,
  aspectRatio,
  annotations,
  sourceCount,
}: {
  instruction: string;
  preserve: string;
  aspectRatio: string;
  annotations: ImageAnnotation[];
  sourceCount: number;
}): string {
  const regionInstructions = annotations
    .filter((annotation) => annotation.text.trim())
    .map((annotation, index) =>
      `${index + 1}. 图片横向 ${Math.round(annotation.x)}%、纵向 ${Math.round(annotation.y)}%：${annotation.text.trim()}`);
  return [
    `请基于本轮选中的 ${sourceCount} 张图片生成一个实际编辑后的新图片版本。`,
    instruction,
    preserve.trim() ? `必须保留：${preserve.trim()}。` : "",
    aspectRatio !== "保持原图" ? `输出画幅：${aspectRatio}。` : "保持原图画幅。",
    regionInstructions.length ? `区域修改要求：\n${regionInstructions.join("\n")}` : "",
    "不要覆盖原图片；完成时必须产生新的原生 imageGeneration 图片产物，并在回复中简要说明改动和仍需人工核对的内容。",
  ].filter(Boolean).join("\n");
}

export function imageVersionNumber(
  image: GeneratedImageItem,
  images: ReadonlyMap<string, GeneratedImageItem>,
): number {
  const seen = new Set<string>();
  function depth(current: GeneratedImageItem): number {
    if (seen.has(current.filename)) return 1;
    seen.add(current.filename);
    const parents = current.sourceFilenames
      .map((filename) => images.get(filename))
      .filter((parent): parent is GeneratedImageItem => Boolean(parent));
    return parents.length ? 1 + Math.max(...parents.map(depth)) : 1;
  }
  return depth(image);
}
