"use client";

import {
  Check,
  CircleAlert,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  Maximize2,
  MessageCirclePlus,
  SendHorizontal,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { GeneratedImageItem } from "@/lib/agent/use-agent-thread";
import type { ImageStudioRequest } from "@/lib/creative/creative-canvas-navigation";
import { cn } from "@/lib/utils";

type ImageStudioView = "focused" | "canvas";

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
  const [resizeInstruction, setResizeInstruction] = useState("");
  const [annotations, setAnnotations] = useState<ImageAnnotation[]>([]);
  const [commentMode, setCommentMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
  const versionNumber = imageVersionNumber(activeImage, imageByFilename);

  useEffect(() => {
    setView("focused");
    setActiveFilename(request.filename);
    setSelectedFilenames(new Set([request.filename]));
    setZoom(1);
    setInstruction("");
    setResizeInstruction("");
    setAnnotations([]);
    setCommentMode(false);
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
    setSubmitStatus("新版本已生成。");
  }, [images, selectedFilenames]);

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
    if (!commentMode || view !== "focused") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(98, Math.max(2, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.min(98, Math.max(2, ((event.clientY - bounds.top) / bounds.height) * 100));
    setAnnotations((current) => [
      ...current,
      { id: crypto.randomUUID(), x, y, text: "" },
    ]);
    setCommentMode(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function startRemoveAction() {
    setInstruction((current) => current || "请移除我标注区域中的内容，并自然补全背景；其他区域保持不变。");
    setCommentMode(true);
  }

  async function submitEdit() {
    const trimmed = instruction.trim();
    const hasAnnotationText = annotations.some((annotation) => annotation.text.trim());
    if (!trimmed && !hasAnnotationText && !resizeInstruction) {
      setSubmitError("请描述需要修改的内容，或先添加评论标注。");
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
          preserve: "保持未明确要求修改的商品外观、颜色、结构、Logo 和版式不变",
          aspectRatio: resizeInstruction || "保持原图画幅和尺寸比例。",
          annotations,
          sourceCount: sourceFilenames.length,
        }),
      });
      if (!accepted) {
        setSubmitError("当前 Codex 任务暂时不能接收图片修改，请稍后重试。");
        return;
      }
      setInstruction("");
      setResizeInstruction("");
      setAnnotations([]);
      setCommentMode(false);
      setSubmitStatus("修改要求已提交到当前 Codex thread，正在生成新版本。");
    } catch (error) {
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
          <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="关闭图片工作区" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {view === "focused" ? (
            <FocusedImageView
              image={activeImage}
              zoom={zoom}
              annotations={annotations}
              commentMode={commentMode}
              onAddAnnotation={addAnnotation}
              onComment={() => setCommentMode((current) => !current)}
              onRemove={startRemoveAction}
              onResize={(prompt) => {
                setResizeInstruction(prompt);
                requestAnimationFrame(() => composerRef.current?.focus());
              }}
              onZoomChange={setZoom}
            />
          ) : (
            <CanvasImageView
              images={images}
              imageByFilename={imageByFilename}
              activeFilename={activeFilename}
              selectedFilenames={selectedFilenames}
              onActivate={(filename) => {
                setActiveFilename(filename);
                setView("focused");
              }}
              onToggleSelected={toggleSelected}
            />
          )}
        </main>

        <ImageEditComposer
          forwardedRef={composerRef}
          images={images}
          selectedFilenames={selectedFilenames}
          annotations={annotations}
          value={instruction}
          resizeInstruction={resizeInstruction}
          running={running}
          submitting={submitting}
          error={submitError}
          status={submitStatus}
          onChange={setInstruction}
          onAnnotationsChange={setAnnotations}
          onSubmit={submitEdit}
        />
      </DialogContent>
    </Dialog>
  );
}

function FocusedImageView({
  image,
  zoom,
  annotations,
  commentMode,
  onAddAnnotation,
  onComment,
  onRemove,
  onResize,
  onZoomChange,
}: {
  image: GeneratedImageItem;
  zoom: number;
  annotations: ImageAnnotation[];
  commentMode: boolean;
  onAddAnnotation: (event: PointerEvent<HTMLDivElement>) => void;
  onComment: () => void;
  onRemove: () => void;
  onResize: (prompt: string) => void;
  onZoomChange: (zoom: number) => void;
}) {
  return (
    <section className="relative flex size-full items-center justify-center overflow-hidden bg-[var(--cp-bg-subtle)] p-5 md:p-10" aria-label="Focused 图片预览">
      <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] p-1 shadow-[var(--cp-shadow-soft)]">
        <button type="button" className={codexToolbarButton(commentMode)} aria-pressed={commentMode} onClick={onComment}>
          <MessageCirclePlus className="size-3.5" />
          添加评论
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
          commentMode && "cursor-crosshair",
        )}
        style={{ transform: `scale(${zoom})` }}
        onPointerDown={onAddAnnotation}
        data-image-comment-stage
      >
        {/* Generated images are served by authenticated same-origin routes. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt="图片工作区当前图片"
          className="block max-h-[calc(100dvh-230px)] max-w-[calc(100vw-48px)] select-none rounded-[4px] bg-white object-contain shadow-[var(--cp-shadow-popover)]"
          draggable={false}
        />
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

      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-black/75 p-1 text-white shadow-[var(--cp-shadow-popover)]">
        <IconButton label="缩小" disabled={zoom <= 0.5} onClick={() => onZoomChange(Math.max(0.5, zoom - 0.1))}><ZoomOut className="size-4" /></IconButton>
        <button type="button" className="h-8 min-w-12 rounded-full px-2 text-[11px] tabular-nums hover:bg-white/10" onClick={() => onZoomChange(1)}>{Math.round(zoom * 100)}%</button>
        <IconButton label="放大" disabled={zoom >= 2} onClick={() => onZoomChange(Math.min(2, zoom + 0.1))}><ZoomIn className="size-4" /></IconButton>
      </div>
      {commentMode ? (
        <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-[11px] text-white">点击图片放置评论标记</div>
      ) : null}
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
                <button type="button" className="relative block aspect-square w-full overflow-hidden bg-white p-0" onDoubleClick={() => onActivate(image.filename)}>
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

const ImageEditComposer = function ImageEditComposer({
  images,
  selectedFilenames,
  annotations,
  value,
  resizeInstruction,
  running,
  submitting,
  error,
  status,
  onChange,
  onAnnotationsChange,
  onSubmit,
  forwardedRef,
}: {
  images: readonly GeneratedImageItem[];
  selectedFilenames: ReadonlySet<string>;
  annotations: ImageAnnotation[];
  value: string;
  resizeInstruction: string;
  running: boolean;
  submitting: boolean;
  error: string | null;
  status: string | null;
  onChange: (value: string) => void;
  onAnnotationsChange: (annotations: ImageAnnotation[]) => void;
  onSubmit: () => Promise<void>;
  forwardedRef: React.Ref<HTMLTextAreaElement>;
}) {
  const selectedImages = images.filter((image) => selectedFilenames.has(image.filename));
  return (
    <footer className="shrink-0 border-t border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 pb-3 pt-2 md:px-5">
      <div className="mx-auto max-w-[760px]">
        {annotations.length ? (
          <div className="mb-2 space-y-1.5">
            {annotations.map((annotation, index) => (
              <div key={annotation.id} className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--cp-text)] text-[10px] font-semibold text-white">{index + 1}</span>
                <input
                  className="h-8 min-w-0 flex-1 rounded-[7px] border border-[var(--cp-border)] px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                  placeholder="说明这个区域需要怎么修改"
                  value={annotation.text}
                  onChange={(event) => onAnnotationsChange(annotations.map((item) => item.id === annotation.id ? { ...item, text: event.target.value } : item))}
                />
                <button type="button" className="flex size-7 items-center justify-center rounded-full text-[var(--cp-text-faint)] hover:bg-[var(--cp-bg-subtle)] hover:text-[var(--cp-danger)]" aria-label={`删除评论 ${index + 1}`} onClick={() => onAnnotationsChange(annotations.filter((item) => item.id !== annotation.id))}><X className="size-3.5" /></button>
              </div>
            ))}
          </div>
        ) : null}
        {resizeInstruction ? <div className="mb-2 rounded-[7px] bg-[var(--cp-bg-subtle)] px-2.5 py-1.5 text-[11px] text-[var(--cp-text-muted)]">{resizeInstruction}</div> : null}
        <div className="rounded-[18px] border border-[var(--cp-border)] bg-[var(--cp-surface)] p-2 shadow-[var(--cp-shadow-soft)]">
          {selectedImages.length ? (
            <div className="mb-1.5 flex gap-1.5 px-1" aria-label="图片修改来源">
              {selectedImages.map((image) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={image.id} src={image.url} alt="已选择的图片" className="size-10 rounded-[6px] border border-[var(--cp-border)] bg-white object-cover" />
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              ref={forwardedRef}
              className="min-h-11 max-h-32 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-6 text-[var(--cp-text)] outline-none"
              placeholder="描述要修改的内容"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!running && !submitting) void onSubmit();
                }
              }}
            />
            <Button type="button" size="icon" className="size-9 shrink-0 rounded-full" disabled={running || submitting || (!value.trim() && !annotations.some((item) => item.text.trim()) && !resizeInstruction)} aria-label="提交图片修改" onClick={() => void onSubmit()}>
              {running || submitting ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            </Button>
          </div>
        </div>
        {error ? <p className="m-0 mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-[var(--cp-danger)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{error}</p> : null}
        {status ? <p className="m-0 mt-1.5 text-center text-[11px] text-[var(--cp-text-muted)]">{status}</p> : null}
      </div>
    </footer>
  );
};

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="flex size-8 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30" aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

function codexToolbarButton(active: boolean) {
  return cn(
    "flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] text-[var(--cp-text)] hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
    active && "bg-[var(--cp-bg-subtle)]",
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
    aspectRatio,
    regionInstructions.length ? `区域修改要求：\n${regionInstructions.join("\n")}` : "",
    "不要覆盖原图片；完成时必须产生新的原生 imageGeneration 图片产物，并简要说明修改结果和仍需人工核对的内容。",
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
