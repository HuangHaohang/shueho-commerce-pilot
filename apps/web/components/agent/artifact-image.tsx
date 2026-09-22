"use client";

import { useEffect, useRef, useState } from "react";

/** Image transfer/decode is separate from the authoritative Harness Turn state. */
export function ArtifactImage({ src, alt, className, preview = false }: {
  src: string; alt: string; className?: string; preview?: boolean;
}) {
  const url = preview && /^\/api\/provider\/generated-images\/[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(src)
    ? `${src}?preview=1` : src;
  return <DecodedArtifactImage key={url} src={url} alt={alt} className={className} />;
}

function DecodedArtifactImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // Cached images may finish before React hydrates and attaches onLoad.
    const image = imageRef.current;
    let disposed = false;
    if (image?.complete && image.naturalWidth > 0) {
      void image.decode().then(() => { if (!disposed) setState("ready"); })
        .catch(() => { if (!disposed) setState("failed"); });
    }
    return () => { disposed = true; };
  }, []);
  return <span className={`relative block ${className ?? ""}`} aria-busy={state === "loading"}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={imageRef} src={src} alt={alt} decoding="async" className="block size-full object-contain"
      style={{ opacity: state === "ready" ? 1 : 0 }}
      onLoad={async (event) => {
        const image = event.currentTarget;
        try { await image.decode(); setState("ready"); } catch { setState("failed"); }
      }} onError={() => setState("failed")} />
    {state !== "ready" ? <span role="status" className="absolute inset-0 flex items-center justify-center bg-[var(--cp-bg-subtle)] text-xs text-[var(--cp-text-muted)]">
      {state === "failed" ? "图片加载失败" : "正在加载图片…"}
    </span> : null}
  </span>;
}
