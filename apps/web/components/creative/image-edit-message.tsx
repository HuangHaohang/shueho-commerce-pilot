"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { useCreativeCanvasNavigation } from "@/lib/creative/creative-canvas-navigation";

export function ImageEditMessage({ content, turnId }: { content: string; turnId?: string | null }) {
  const navigation = useCreativeCanvasNavigation();
  if (!/^请基于本轮选中的 \d+ 张图片生成一个实际编辑后的新图片版本。/.test(content)) return <>{content}</>;
  const section = content.split("区域修改要求：\n")[1]?.split("\n不要覆盖原图片；")[0] ?? "";
  const annotations = [...section.matchAll(/(?:^|\n)(\d+)\. 图片横向 ([\d.]+)%、纵向 ([\d.]+)%(?:、区域宽 ([\d.]+)%、高 ([\d.]+)%)?：[ \t]*([\s\S]*?)(?=\n\d+\. 图片横向 |$)/g)]
    .map((match) => ({ id: `annotation-${match[1]}`, x: Number(match[2]), y: Number(match[3]),
      width: match[4] === undefined ? undefined : Number(match[4]), height: match[5] === undefined ? undefined : Number(match[5]), text: match[6].trim() }))
    .filter((item) => item.x >= 0 && item.x <= 100 && item.y >= 0 && item.y <= 100 &&
      (item.width === undefined || (item.width > 0 && item.height !== undefined && item.height > 0 && item.x + item.width <= 100.001 && item.y + item.height <= 100.001)));
  const images = navigation?.images ?? [];
  const sourceFilename = content.match(/^批注原图：(.+)$/m)?.[1]
    ?? images.find((image) => turnId && image.turnId === turnId)?.sourceFilenames[0];
  const source = images.find((image) => image.filename === sourceFilename);
  const lines = content.split("\n").slice(1);
  const instructionEnd = lines.findIndex((line) => /^(必须保留：|保持原图画幅和尺寸比例。|批注原图：|区域修改要求：|不要覆盖原图片；)/.test(line.trim()));
  const instruction = lines.slice(0, instructionEnd < 0 ? lines.length : instructionEnd).join("\n").trim();
  const openAnnotation = (id: string) => {
    if (!source || !navigation) return;
    navigation.openImageStudio({ artifactId: source.id, filename: source.filename, url: source.url,
      model: source.model, title: "图片批注", nodeId: null, annotations: annotations.map((annotation) => ({ ...annotation, sourceFilename: source.filename, sourceId: source.id })), focusAnnotationId: id });
  };
  return <div className="space-y-2 whitespace-normal">
    {instruction ? <p className="m-0 whitespace-pre-wrap">{instruction}</p> : null}
    {source && annotations.length ? <div className="relative overflow-hidden rounded-lg">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={source.url} alt="批注对应的原图" className="block h-auto w-full" />
      {annotations.filter((annotation) => annotation.width !== undefined).map((annotation) => <button key={`region-${annotation.id}`} type="button" aria-label="查看修改区域"
        onClick={() => openAnnotation(annotation.id)} title={annotation.text}
        className="absolute border border-white bg-black/10 outline outline-1 outline-black/60"
        style={{ left: `${annotation.x}%`, top: `${annotation.y}%`, width: `${annotation.width}%`, height: `${annotation.height}%` }} />)}
      {annotations.map((annotation, index) => <button key={annotation.id} type="button"
        aria-label={`查看批注${index + 1}`} onClick={() => openAnnotation(annotation.id)}
        className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-black text-[10px] text-white shadow-sm"
        style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}>{index + 1}</button>)}
    </div> : null}
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-wrap gap-1.5" aria-label="图片批注">
        {annotations.map((annotation, index) => <Tooltip key={annotation.id}>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`批注${index + 1}`} aria-disabled={!source}
              onClick={() => openAnnotation(annotation.id)}
              className="inline-flex h-7 items-center rounded-full bg-[var(--cp-surface)] px-2.5 text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cp-focus)]">
              <span className="text-xs leading-5">批注{index + 1}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" collisionPadding={12} className="max-h-[min(240px,var(--radix-tooltip-content-available-height))] max-w-[min(280px,calc(100vw-32px))] overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 leading-5">
            {annotation.text}
          </TooltipContent>
        </Tooltip>)}
      </div>
    </TooltipProvider>
    {!source && annotations.length ? <p className="m-0 text-xs text-[var(--cp-text-muted)]">这条历史消息未记录可定位的原图。</p> : null}
  </div>;
}
