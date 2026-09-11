"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useCreativeCanvasNavigation } from "@/lib/creative/creative-canvas-navigation";
import { imageAssetVersions } from "@/lib/creative/image-assets";
import type { GeneratedImageItem } from "@/lib/agent/use-agent-thread";

export function ImageVersionsPanel({ filename, images, title, nodeId }: { filename: string; images: readonly GeneratedImageItem[]; title: string; nodeId: string | null }) {
  const navigation = useCreativeCanvasNavigation();
  const versions = imageAssetVersions(filename, images);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = selected.map((name) => versions.find((item) => item.filename === name)).filter((item): item is GeneratedImageItem => Boolean(item));
  const edit = (image: GeneratedImageItem) => {
    setOpen(false);
    navigation?.openImageStudio({ artifactId: image.id, filename: image.filename, url: image.url, model: image.model, title, nodeId });
  };
  async function copy(image: GeneratedImageItem) {
    if (!navigation?.projectThreadId || copying) return;
    setCopying(true); setError(null);
    try {
      const response = await fetch(`/api/agent/threads/${encodeURIComponent(navigation.projectThreadId)}/image-copies`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: image.filename, requestId: crypto.randomUUID() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.image) throw new Error(payload.error ?? "无法另存图片。");
      window.dispatchEvent(new CustomEvent("commerce:image-copy", { detail: { projectThreadId: navigation.projectThreadId, image: payload.image } }));
      edit(payload.image);
    } catch (error) { setError(error instanceof Error ? error.message : "无法另存图片。"); }
    finally { setCopying(false); }
  }
  return <>
    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => { setSelected([filename]); setError(null); setOpen(true); }}>版本 · {versions.length || 1}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[85dvh] w-[min(920px,calc(100vw-32px))] max-w-none flex-col overflow-hidden p-5">
        <DialogTitle>图片版本</DialogTitle>
        <DialogDescription>选择版本预览，最多同时选择两个版本对比。</DialogDescription>
        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          <div className="w-28 shrink-0 space-y-2 overflow-y-auto pr-1">
            {[...versions].reverse().map((image) => <button key={image.filename} type="button" aria-pressed={selected.includes(image.filename)}
              className="block w-full rounded-lg border border-[var(--cp-border)] p-1 text-xs aria-pressed:border-[var(--cp-text)]"
              onClick={() => setSelected((current) => current.includes(image.filename) ? current.length > 1 ? current.filter((name) => name !== image.filename) : current : [...current.slice(-1), image.filename])}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={`版本 ${versions.indexOf(image) + 1}`} className="aspect-square w-full rounded object-contain" />
              <span className="block py-1">版本 {versions.indexOf(image) + 1}{image.filename === versions.at(-1)?.filename ? " · 最新" : ""}</span>
            </button>)}
          </div>
          <div className="grid min-h-0 min-w-0 flex-1 gap-3 overflow-y-auto" style={{ gridTemplateColumns: `repeat(${Math.max(1, preview.length)}, minmax(0, 1fr))` }}>
            {preview.map((image) => <div key={image.filename} className="min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={`版本 ${versions.indexOf(image) + 1}预览`} className="h-[45dvh] w-full rounded-lg bg-[var(--cp-bg-subtle)] object-contain" />
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => edit(image)}>编辑此版本</Button>
                <Button size="sm" variant="ghost" disabled={copying || !navigation?.projectThreadId} onClick={() => void copy(image)}>{copying ? "正在另存…" : "另存为独立图片"}</Button>
              </div>
            </div>)}
          </div>
        </div>
        {error ? <p role="alert" className="text-xs text-[var(--cp-danger)]">{error}</p> : null}
      </DialogContent>
    </Dialog>
  </>;
}
