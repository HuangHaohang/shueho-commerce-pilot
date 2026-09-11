"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ImageDownloadButton({ filename }: { filename: string }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch(`/api/provider/generated-images/${encodeURIComponent(filename)}?download=1`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "图片下载失败，请重试。");
      }
      if (!response.headers.get("content-type")?.startsWith("image/")) throw new Error("返回的文件不是图片，无法下载。");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "图片下载失败，请重试。");
    } finally {
      setDownloading(false);
    }
  };
  return <div className="nodrag nopan nowheel flex max-w-full flex-col items-start">
    <Button type="button" variant="ghost" size="sm" disabled={downloading} onClick={() => void download()} aria-label="下载原图" title="下载当前版本原图">
      {downloading ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
      {downloading ? "下载中…" : "下载原图"}
    </Button>
    {error ? <span role="alert" className="max-w-48 break-words text-xs text-[var(--cp-danger)]">{error}</span> : null}
  </div>;
}
