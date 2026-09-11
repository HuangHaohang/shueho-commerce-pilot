"use client";

import {
  Info,
  Loader2,
  Check,
  CircleAlert,
  Image as ImageIcon,
  Images,
  Maximize2,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { ImageVersionsPanel } from "./image-versions-panel";
import { imageAssetVersions } from "@/lib/creative/image-assets";
import { ImageDownloadButton } from "./image-download-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { GeneratedImageItem } from "@/lib/agent/use-agent-thread";
import { useCreativeCanvasNavigation, type ImageStudioRequest } from "@/lib/creative/creative-canvas-navigation";
import { cn } from "@/lib/utils";

type ImageStudioView = "focused" | "canvas";

type ImageAnnotation = NonNullable<NonNullable<ImageStudioRequest>["annotations"]>[number];

export type ImageEditSubmission = {
  message: string;
  sourceFilenames: string[];
};

export type ImageEditComposerRenderConfig = {
  value: string;
  placeholder: string;
  disabled: boolean;
  submitReady: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  context: ReactNode;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
};

const resizeOptions = [
  { label: "保持原图", prompt: "保持原图画幅和尺寸比例。" },
  { label: "方形 1:1", prompt: "将输出调整为方形 1:1 构图，保持主体完整且居中。" },
  { label: "竖版 4:5", prompt: "将输出调整为竖版 4:5 构图，保持主体完整并留出安全边距。" },
  { label: "横版 16:9", prompt: "将输出调整为横版 16:9 构图，保持主体完整并自然扩展背景。" },
] as const;

export function CreativeImageStudio({
  request,
  images,
  running,
  unavailable = false,
  onActiveImageChange,
  runError,
  referenceAttachmentCount = 0,
  interaction,
  renderConversation,
  onClose,
  onSubmitEdit,
  renderComposer,
}: {
  threadId: string;
  request: NonNullable<ImageStudioRequest>;
  images: readonly GeneratedImageItem[];
  running: boolean;
  unavailable?: boolean;
  onActiveImageChange?: (filename: string) => void;
  runError?: string | null;
  referenceAttachmentCount?: number;
  interaction?: ReactNode;
  renderConversation?: (filename: string) => ReactNode;
  onClose: () => void;
  onSubmitEdit: (submission: ImageEditSubmission) => Promise<boolean>;
  renderComposer: (config: ImageEditComposerRenderConfig) => ReactNode;
}) {
  const [view, setView] = useState<ImageStudioView>("focused");
  const [activeFilename, setActiveFilename] = useState(request.filename);
  const [selectedFilenames, setSelectedFilenames] = useState<Set<string>>(
    () => new Set([request.filename]),
  );
  const activeImageCallback = useRef(onActiveImageChange);
  activeImageCallback.current = onActiveImageChange;
  useEffect(() => { activeImageCallback.current?.(activeFilename); }, [activeFilename]);
  const [zoom, setZoom] = useState(1);
  const [instruction, setInstruction] = useState("");
  const [resizeInstruction, setResizeInstruction] = useState("");
  const [annotations, setAnnotations] = useState<ImageAnnotation[]>([]);
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigation = useCreativeCanvasNavigation();
  const [localPendingEdit, setLocalPendingEdit] = useState<{ sources: string[]; existingIds: Set<string> } | null>(null);
  const pendingEdit = navigation ? navigation.pendingImageEdit : localPendingEdit;
  const setPendingEdit = navigation ? navigation.setPendingImageEdit : setLocalPendingEdit;
  const editSawRunning = useRef(false);
  const editBusy = submitting || Boolean(pendingEdit?.sources.includes(activeFilename));
  const activeImageEditing = Boolean(pendingEdit?.sources.includes(activeFilename) || navigation?.editingFilenames.includes(activeFilename));
  const imageEditVisible = activeImageEditing && (submitting || running) && view === "focused";
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const previousImageCountRef = useRef(images.length);
  const composerRef = useRef<HTMLTextAreaElement>(null);

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
  const assetVersions = imageAssetVersions(activeFilename, images);
  const versionNumber = Math.max(1, assetVersions.findIndex((image) => image.filename === activeFilename) + 1);
  const selectedImages = view === "focused"
    ? [activeImage]
    : images.filter((image) => selectedFilenames.has(image.filename));
  const submitReady = Boolean(
    instruction.trim() ||
    annotations.some((annotation) => annotation.text.trim()) ||
    resizeInstruction || referenceAttachmentCount > 0,
  );

  useEffect(() => {
    setView("focused");
    setActiveFilename(request.filename);
    setSelectedFilenames(new Set([request.filename]));
    setZoom(1);
    setInstruction("");
    setResizeInstruction("");
    setAnnotations(request.annotations ?? []);
    setFocusedAnnotationId(request.focusAnnotationId ?? null);
    setSubmitError(null);
    setSubmitStatus(null);
    editSawRunning.current = false;
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
    setSubmitStatus("新版本已生成。");
  }, [images, selectedFilenames]);

  useEffect(() => {
    if (!pendingEdit || !pendingEdit.sources.includes(activeFilename)) return;
    if (running) editSawRunning.current = true;
    const edited = [...images].reverse().find((image) =>
      !pendingEdit.existingIds.has(image.id) &&
      image.sourceFilenames.some((filename) => pendingEdit.sources.includes(filename)));
    if (edited) {
      // A result for another open source must not replace the image the user
      // has since navigated to or erase its local draft.
      if (!pendingEdit.sources.includes(activeFilename)) return;
      setActiveFilename(edited.filename);
      setSelectedFilenames(new Set([edited.filename]));
      setView("focused");
      setInstruction("");
      setResizeInstruction("");
      setAnnotations([]);
      setPendingEdit(null);
      setSubmitStatus("新版本已生成，画布与对话将自动更新。");
    } else if (!submitting && !running && editSawRunning.current) {
      setPendingEdit(null);
      setSubmitError(runError || "本次修改未返回新图片，修改要求已保留。");
    }
  }, [images, pendingEdit, running, submitting, runError, activeFilename]);

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

  function addAnnotation(position: Omit<ImageAnnotation, "id" | "text">) {
    if (view !== "focused" || editBusy || running) return;
    const id = crypto.randomUUID();
    setAnnotations((current) => [...current, { ...position, id, text: "" }]);
    setFocusedAnnotationId(id);
  }

  function startRemoveAction() {
    setInstruction((current) => current || "请移除我标注区域中的内容，并自然补全背景；其他区域保持不变。");
  }

  async function submitEdit() {
    if (unavailable || running || editBusy) return;
    const trimmed = instruction.trim();
    const hasAnnotationText = annotations.some((annotation) => annotation.text.trim());
    if (!trimmed && !hasAnnotationText && !resizeInstruction && !referenceAttachmentCount) {
      setSubmitError("请描述需要修改的内容，或先添加评论标注。");
      return;
    }
    setInstruction("");
    setSubmitting(true);
    setFocusedAnnotationId(null);
    setSubmitError(null);
    setSubmitStatus(null);
    const sourceFilenames = view === "focused" ? [activeFilename] : [...selectedFilenames];
    editSawRunning.current = false;
    setPendingEdit({ sources: sourceFilenames, existingIds: new Set(images.map((image) => image.id)) });
    try {
      const accepted = await onSubmitEdit({
        sourceFilenames,
        message: buildImageEditMessage({
          instruction: trimmed || (referenceAttachmentCount ? "请结合本轮上传的参考素材和当前对话中的修改要求，编辑所选原图。" : ""),
          preserve: "保持未明确要求修改的商品外观、颜色、结构、Logo 和版式不变",
          aspectRatio: resizeInstruction || "保持原图画幅和尺寸比例。",
          annotations,
          sourceCount: sourceFilenames.length,
          sourceFilename: activeFilename,
        }),
      });
      if (!accepted) {
        setInstruction((current) => current || trimmed);
        setPendingEdit(null);
        setSubmitError("当前 Codex 任务暂时不能接收图片修改，请稍后重试。");
        return;
      }
      // The sent request is now in the native conversation; retain the editor view.
    } catch (error) {
      setInstruction((current) => current || trimmed);
      setPendingEdit(null);
      setSubmitError(error instanceof Error ? error.message : "无法提交图片修改。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showClose={false}
        className="inset-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 bg-[var(--cp-bg-subtle)]"
      >
        <DialogDescription className="sr-only">
          使用 Codex Harness 在同一对话中查看、选择并通过自然语言修改生成图片。
        </DialogDescription>
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] px-3">
          <div className="flex rounded-[9px] bg-[var(--cp-bg-muted)] p-0.5" role="tablist" aria-label="图片工作区视图">
            <button
              type="button"
              role="tab"
              aria-selected={view === "focused"}
              className={cn(
                "flex size-8 items-center justify-center rounded-[7px] text-[var(--cp-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                view === "focused" && "bg-[var(--cp-surface)] text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]",
              )}
              aria-label="Focused 单图视图"
              onClick={() => setView("focused")}
            >
              <ImageIcon className="size-4" />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "canvas"}
              className={cn(
                "flex size-8 items-center justify-center rounded-[7px] text-[var(--cp-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                view === "canvas" && "bg-[var(--cp-surface)] text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]",
              )}
              aria-label="Canvas 图片集合视图"
              onClick={() => setView("canvas")}
            >
              <Images className="size-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm">{request.title || "图片"}</DialogTitle>
            <div className="mt-0.5 truncate text-[10px] text-[var(--cp-text-faint)]">
              第 {versionNumber} 版 · {activeImage.model} · Harness 原生图片版本
            </div>
          </div>
          <ImageVersionsPanel filename={activeFilename} images={images} title={request.title} nodeId={request.nodeId} />
          <Popover>
            <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" aria-label="图片详情"><Info className="size-4" /><span className="hidden sm:inline">图片详情</span></Button></PopoverTrigger>
            <PopoverContent align="end" className="w-[min(320px,calc(100vw-32px))] p-4 text-xs leading-5">
              <h3 className="mb-3 font-medium">图片详情</h3>
              <dl className="space-y-2 break-words">
                <div><dt className="text-[var(--cp-text-muted)]">名称</dt><dd>{request.title || "生成图片"}</dd></div>
                <div><dt className="text-[var(--cp-text-muted)]">模型</dt><dd>{activeImage.model}</dd></div>
                <div><dt className="text-[var(--cp-text-muted)]">版本</dt><dd>第 {versionNumber} 版</dd></div>
                <div><dt className="text-[var(--cp-text-muted)]">文件</dt><dd className="[overflow-wrap:anywhere]">{activeImage.filename}</dd></div>
              </dl>
            </PopoverContent>
          </Popover>
          <ImageDownloadButton filename={activeImage.filename} />
          <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="关闭图片工作区" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>

        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <div className="relative min-h-0 min-w-0 flex-1">
          <div className="size-full">
          {view === "focused" ? (
            <FocusedImageView
              key={activeFilename}
              image={activeImage}
              disabled={editBusy || running}
              zoom={zoom}
              annotations={annotations}
              focusedAnnotationId={focusedAnnotationId}
              onFocusAnnotation={setFocusedAnnotationId}
              onAnnotationChange={(id, text) => setAnnotations((items) => items.map((item) => item.id === id ? { ...item, text } : item))}
              onAnnotationDelete={(id) => { setAnnotations((items) => items.filter((item) => item.id !== id)); setFocusedAnnotationId(null); }}
              onAddAnnotation={addAnnotation}
              onRemove={startRemoveAction}
              onResize={(prompt) => {
                setResizeInstruction(prompt);
                requestAnimationFrame(() => composerRef.current?.focus());
              }}
              onZoomChange={setZoom}
            />
          ) : (
            <CanvasImageView
              images={assetVersions}
              imageByFilename={imageByFilename}
              activeFilename={activeFilename}
              selectedFilenames={selectedFilenames}
              onActivate={(filename) => {
                setActiveFilename(filename);
                setSelectedFilenames(new Set([filename]));
                setAnnotations([]);
                setFocusedAnnotationId(null);
                setView("focused");
              }}
              onToggleSelected={toggleSelected}
            />
          )}
          </div>
          {imageEditVisible ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/45 backdrop-blur-md" role="status" aria-live="polite" aria-busy="true">
              <div className="flex items-center gap-3 rounded-full border border-white/70 bg-white/80 px-5 py-3 text-sm text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                AI快速修改ing..
              </div>
            </div>
          ) : null}
          </div>
          <aside className="flex min-h-0 max-h-[55dvh] shrink-0 flex-col border-t border-[var(--cp-border)] bg-[var(--cp-surface)] md:max-h-none md:w-[380px] md:border-l md:border-t-0 lg:w-[400px]" aria-label="图片编辑对话">
          <div className="cp-flat-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {renderConversation?.(activeFilename)}
          </div>
        <footer
          className="shrink-0 border-t border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 pb-3 pt-2"
          data-image-edit-composer
        >
          <div className="mx-auto max-w-[768px]">
            {interaction ? <div className="cp-flat-scrollbar mb-2 max-h-[25dvh] overflow-y-auto overscroll-contain">{interaction}</div> : null}
            {renderComposer({
              value: instruction,
              placeholder: "描述要修改的内容",
              disabled: unavailable || running || editBusy,
              submitReady,
              inputRef: composerRef,
              context: (
                <ImageEditContext
                  images={selectedImages}
                  resizeInstruction={resizeInstruction}
                />
              ),
              onChange: setInstruction,
              onSubmit: submitEdit,
            })}
            {submitError ? (
              <p className="m-0 mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-[var(--cp-danger)]" role="alert">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {submitError}
              </p>
            ) : null}
            {submitStatus ? (
              <p className="m-0 mt-1.5 text-center text-[11px] text-[var(--cp-text-muted)]" role="status">
                {submitStatus}
              </p>
            ) : null}
          </div>
        </footer>
          </aside>
        </main>
      </DialogContent>
    </Dialog>
  );
}

function FocusedImageView({
  image,
  disabled,
  zoom,
  annotations,
  onAddAnnotation,
  focusedAnnotationId,
  onFocusAnnotation,
  onAnnotationChange,
  onAnnotationDelete,
  onRemove,
  onResize,
  onZoomChange,
}: {
  image: GeneratedImageItem;
  disabled: boolean;
  zoom: number;
  annotations: ImageAnnotation[];
  focusedAnnotationId: string | null;
  onFocusAnnotation: (id: string | null) => void;
  onAnnotationChange: (id: string, text: string) => void;
  onAnnotationDelete: (id: string) => void;
  onAddAnnotation: (position: Omit<ImageAnnotation, "id" | "text">) => void;
  onRemove: () => void;
  onResize: (prompt: string) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const [regionMode, setRegionMode] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const gesture = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  function point(event: PointerEvent<HTMLImageElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)),
      y: Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100)) };
  }
  function rectangle(start: { x: number; y: number }, end: { x: number; y: number }) {
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  }
  function finishSelection(event: PointerEvent<HTMLImageElement>) {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (disabled) return;
    const end = point(event);
    const region = rectangle(start, end);
    const bounds = event.currentTarget.getBoundingClientRect();
    if (regionMode && (region.width * bounds.width / 100 < 4 || region.height * bounds.height / 100 < 4)) return;
    onAddAnnotation({ ...(regionMode ? region : end), sourceFilename: image.filename,
      sourceId: image.id, naturalWidth: event.currentTarget.naturalWidth, naturalHeight: event.currentTarget.naturalHeight });
  }
  return (
    <section className="relative flex size-full items-center justify-center overflow-hidden bg-[var(--cp-bg-subtle)] p-5 [container-type:size] md:p-10" aria-label="Focused 图片预览">
      <div className="absolute left-1/2 top-3 z-20 flex w-max max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] p-1 shadow-[var(--cp-shadow-soft)]">
        <button type="button" disabled={disabled} aria-pressed={!regionMode} className={codexToolbarButton(!regionMode)} onClick={() => { setRegionMode(false); onFocusAnnotation(null); }}>点击定位</button>
        <button type="button" disabled={disabled} aria-pressed={regionMode} className={codexToolbarButton(regionMode)} onClick={() => { setRegionMode(true); onFocusAnnotation(null); }}>
          <Maximize2 className="size-3.5" />框选区域
        </button>
        <button type="button" className={codexToolbarButton(false)} onClick={onRemove}>
          <Trash2 className="size-3.5" />
          移除
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={codexToolbarButton(false)}>
              <Maximize2 className="size-3.5" />
              调整大小
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="center" className="w-48 p-1.5">
            {resizeOptions.map((option) => (
              <button
                key={option.label}
                type="button"
                className="flex h-9 w-full items-center rounded-[7px] px-2.5 text-left text-xs text-[var(--cp-text)] hover:bg-[var(--cp-bg-subtle)]"
                onClick={() => onResize(option.prompt)}
              >
                {option.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <div
        className={cn(
          "relative flex max-h-full max-w-full items-center justify-center transition-transform duration-[var(--cp-duration-fast)]",
          "cursor-crosshair",
        )}
        style={{ transform: `scale(${zoom})` }}
        data-image-comment-stage
      >
        {/* Generated images are served by authenticated same-origin routes. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt="图片工作区当前图片"
          onPointerDown={(event) => {
            if (disabled || event.button !== 0 || event.target !== event.currentTarget) return;
            if (focusedAnnotationId) { onFocusAnnotation(null); return; }
            event.preventDefault();
            gesture.current = { ...point(event), pointerId: event.pointerId };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (regionMode && gesture.current?.pointerId === event.pointerId) setDraft(rectangle(gesture.current, point(event)));
          }}
          onPointerUp={finishSelection}
          onPointerCancel={() => { gesture.current = null; setDraft(null); }}
          onLostPointerCapture={() => { gesture.current = null; setDraft(null); }}
          style={{ touchAction: "none" }}
          className="block max-h-[100cqh] max-w-[100cqw] select-none rounded-[4px] bg-white object-contain shadow-[var(--cp-shadow-popover)]"
          draggable={false}
        />
        {draft ? <div className="pointer-events-none absolute border-2 border-white bg-black/15 outline outline-1 outline-black/70" style={{ left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.width}%`, height: `${draft.height}%` }} /> : null}
        {annotations.filter((annotation) => annotation.width !== undefined).map((annotation) => <button key={`region-${annotation.id}`} type="button" aria-label="编辑选区"
          onClick={() => onFocusAnnotation(annotation.id)} title={annotation.text || "输入区域修改要求"}
          className="absolute border-2 border-white bg-black/10 outline outline-1 outline-black/70"
          style={{ left: `${annotation.x}%`, top: `${annotation.y}%`, width: `${annotation.width}%`, height: `${annotation.height}%` }} />)}
        <TooltipProvider delayDuration={150}>
        {annotations.map((annotation, index) => (
          <Popover key={annotation.id} open={focusedAnnotationId === annotation.id}
            onOpenChange={(open) => {
              if (open) onFocusAnnotation(annotation.id);
              else if (focusedAnnotationId === annotation.id) onFocusAnnotation(null);
            }}>
            <Tooltip open={focusedAnnotationId === annotation.id ? false : undefined}>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button type="button" aria-label={`编辑位置${index + 1}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[var(--cp-text)] text-[11px] font-semibold text-white shadow-[var(--cp-shadow-popover)] data-[state=open]:ring-4 data-[state=open]:ring-[var(--cp-focus)]"
                    style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}>{index + 1}</button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64 whitespace-pre-wrap break-words leading-5">{annotation.text || "点击输入修改要求"}</TooltipContent>
            </Tooltip>
            <PopoverContent side="bottom" align="center" sideOffset={12} collisionPadding={16}
              className="w-[min(260px,calc(100vw-32px))] p-3" onPointerDown={(event) => event.stopPropagation()}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                (event.target as HTMLElement).querySelector<HTMLTextAreaElement>("textarea")?.focus();
              }}
              onCloseAutoFocus={(event) => event.preventDefault()}>
              <div className="mb-2 flex items-center justify-between text-xs text-[var(--cp-text-muted)]">
                <span>位置 {index + 1}</span>
                <button type="button" aria-label="删除这个位置" className="rounded-full p-1 hover:bg-[var(--cp-bg-subtle)]" onClick={() => onAnnotationDelete(annotation.id)}><Trash2 className="size-3.5" /></button>
              </div>
              <textarea data-image-annotation-input rows={3} aria-label={`位置${index + 1}修改要求`}
                placeholder="想怎样修改这个位置？" value={annotation.text}
                className="block max-h-40 min-h-16 w-full resize-none border-0 bg-transparent text-xs leading-5 outline-none"
                onChange={(event) => onAnnotationChange(annotation.id, event.target.value)} />
              <div className="mt-2 flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={() => onFocusAnnotation(null)}>完成</Button></div>
            </PopoverContent>
          </Popover>
        ))}
        </TooltipProvider>
      </div>

      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-black/75 p-1 text-white shadow-[var(--cp-shadow-popover)]">
        <IconButton label="缩小" disabled={zoom <= 0.5} onClick={() => onZoomChange(Math.max(0.5, zoom - 0.1))}><ZoomOut className="size-4" /></IconButton>
        <button type="button" className="h-8 min-w-12 rounded-full px-2 text-[11px] tabular-nums hover:bg-white/10" onClick={() => onZoomChange(1)}>{Math.round(zoom * 100)}%</button>
        <IconButton label="放大" disabled={zoom >= 2} onClick={() => onZoomChange(Math.min(2, zoom + 0.1))}><ZoomIn className="size-4" /></IconButton>
      </div>

    </section>
  );
}

function CanvasImageView({
  images,
  imageByFilename,
  activeFilename,
  selectedFilenames,
  onActivate,
  onToggleSelected,
}: {
  images: readonly GeneratedImageItem[];
  imageByFilename: ReadonlyMap<string, GeneratedImageItem>;
  activeFilename: string;
  selectedFilenames: ReadonlySet<string>;
  onActivate: (filename: string) => void;
  onToggleSelected: (filename: string) => void;
}) {
  return (
    <section className="size-full overflow-y-auto bg-[var(--cp-bg-subtle)] p-4 md:p-6" aria-label="Canvas 图片集合">
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-4 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-sm font-semibold text-[var(--cp-text)]">本对话生成的图片</h2>
            <p className="m-0 mt-1 text-[11px] text-[var(--cp-text-muted)]">可选择最多 4 张图片，一起交给当前 Codex thread 修改。</p>
          </div>
          <span className="text-[11px] text-[var(--cp-text-faint)]">已选择 {selectedFilenames.size} 张</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {images.map((image) => {
            const selected = selectedFilenames.has(image.filename);
            return (
              <article key={image.id} className={cn("overflow-hidden rounded-[10px] border bg-[var(--cp-surface)]", image.filename === activeFilename ? "border-[var(--cp-text)]" : "border-[var(--cp-border)]")}>
                <button
                  type="button"
                  aria-label={`${selected ? "取消选择" : "选择"}图片版本 ${imageVersionNumber(image, imageByFilename)}`}
                  aria-pressed={selected}
                  className="relative block aspect-square w-full overflow-hidden bg-white p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cp-focus)]"
                  onClick={() => onToggleSelected(image.filename)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={`图片版本 ${imageVersionNumber(image, imageByFilename)}`} className="size-full object-contain" />
                  <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white">第 {imageVersionNumber(image, imageByFilename)} 版</span>
                  <span className={cn("absolute right-2 top-2 flex size-6 items-center justify-center rounded-full border", selected ? "border-[var(--cp-text)] bg-[var(--cp-text)] text-white" : "border-[var(--cp-border)] bg-white text-transparent")}>
                    <Check className="size-3.5" />
                  </span>
                </button>
                <div className="flex items-center gap-2 px-2 py-2">
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-[11px] text-[var(--cp-text-muted)]" onClick={() => onActivate(image.filename)}>查看此版本</button>
                  <button type="button" className="h-7 rounded-[6px] px-2 text-[10px] text-[var(--cp-text)] hover:bg-[var(--cp-bg-subtle)]" onClick={() => onToggleSelected(image.filename)}>{selected ? "取消" : "选择"}</button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ImageEditContext({ images, resizeInstruction }: {
  images: readonly GeneratedImageItem[];
  resizeInstruction: string;
}) {
  return <div className="flex min-w-0 items-center gap-2" data-image-edit-context>
    {images.map((image) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={image.id} src={image.url} alt="已选择的图片" className="size-10 shrink-0 rounded-lg border border-[var(--cp-border)] bg-white object-cover" />
    ))}
    {resizeInstruction ? <span className="min-w-0 text-xs leading-5 text-[var(--cp-text-muted)]">{resizeInstruction}</span> : null}
  </div>;
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="flex size-8 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30" aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

function codexToolbarButton(active: boolean) {
  return cn(
    "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] text-[var(--cp-text)] hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
    active && "bg-[var(--cp-bg-subtle)]",
  );
}

export function buildImageEditMessage({
  instruction,
  preserve,
  aspectRatio,
  annotations,
  sourceCount,
  sourceFilename,
}: {
  instruction: string;
  preserve: string;
  aspectRatio: string;
  annotations: ImageAnnotation[];
  sourceCount: number;
  sourceFilename?: string;
}): string {
  const regionInstructions = annotations
    .filter((annotation) => annotation.text.trim() && (!annotation.sourceFilename || annotation.sourceFilename === sourceFilename))
    .map((annotation, index) =>
      `${index + 1}. 图片横向 ${Number(annotation.x.toFixed(3))}%、纵向 ${Number(annotation.y.toFixed(3))}%${annotation.width !== undefined ? `、区域宽 ${Number(annotation.width.toFixed(3))}%、高 ${Number((annotation.height ?? 0).toFixed(3))}%` : ""}：${annotation.text.trim()}`);
  return [
    `请基于本轮选中的 ${sourceCount} 张图片生成一个实际编辑后的新图片版本。`,
    instruction,
    preserve.trim() ? `必须保留：${preserve.trim()}。` : "",
    aspectRatio,
    sourceFilename ? `批注原图：${sourceFilename}` : "",
    annotations.some((annotation) => annotation.naturalWidth) ? `原图定位数据：${JSON.stringify(annotations.filter((annotation) => annotation.text.trim() && annotation.sourceFilename === sourceFilename).map(({ id, sourceId, sourceFilename: filename, naturalWidth, naturalHeight, x, y, width, height }) => ({ id, sourceId, filename, naturalWidth, naturalHeight, x, y, width, height })))}` : "",
    regionInstructions.length ? "选区说明：区域坐标是左上角及宽高，单位为整张原图的百分比；框选范围是用户明确指定的目标边界。提取原图区域应使用已注册且支持像素裁切的工具；没有该能力时明确说明，不用重新生成冒充原图裁切。生图工具不支持蒙版时，选区只作为定位依据，不能保证区域外像素不变。" : "",
    regionInstructions.length ? "定位说明：下列坐标针对本轮批注原图的完整画面，左上角为原点，横向从左到右、纵向从上到下。标记是用户修改要求所指向的位置，不是图片序号；结合本轮原图和该位置识别目标区域，并将此定位关系传入原生图片工具。不要用历史其他图片、相邻区域或默认居中区域替代目标。如果需要局部提取但单点不能确定边界，先通过原生提问确认所指区域。" : "",
    regionInstructions.length ? `区域修改要求：\n${regionInstructions.join("\n")}` : "",
    "不要覆盖原图片；完成时交付新的原生 imageGeneration 图片产物即可，不附加总结、评审或核对说明。",
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
