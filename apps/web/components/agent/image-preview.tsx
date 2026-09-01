"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export function ImagePreview({
  src,
  thumbnailAlt,
  previewAlt,
  triggerLabel,
  triggerClassName,
  imageClassName,
}: {
  src: string;
  thumbnailAlt: string;
  previewAlt: string;
  triggerLabel: string;
  triggerClassName: string;
  imageClassName: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!previewOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closePreview();
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
    <>
      <button
        ref={previewTriggerRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        onClick={() => setPreviewOpen(true)}
      >
        {/* Authenticated image routes and local previews have dynamic dimensions. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={thumbnailAlt} className={imageClassName} />
      </button>
      {previewOpen
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="图片预览"
              className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(0,0,0,0.82)] p-4 md:p-8"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) closePreview();
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
                src={src}
                alt={previewAlt}
                className={cn(
                  "max-h-[calc(100dvh-64px)] max-w-[calc(100vw-32px)] object-contain",
                  "md:max-h-[calc(100dvh-96px)] md:max-w-[calc(100vw-96px)]",
                )}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
