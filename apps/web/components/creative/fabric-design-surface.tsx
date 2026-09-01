"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type {
  CreativeCanvasEditorDrawingLayer,
  CreativeCanvasEditorImageLayer,
  CreativeCanvasEditorLayer,
} from "@/lib/creative/creative-canvas-types";

type FabricModule = typeof import("fabric");
type FabricCanvas = import("fabric").Canvas;
type FabricObject = import("fabric").FabricObject & { dataLayerId?: string };

export type FabricDesignTool = "select" | "draw";

export type FabricDesignSurfaceHandle = {
  exportDataUrl: (format: "png" | "jpeg", quality?: number) => string | null;
};

export const FabricDesignSurface = forwardRef<FabricDesignSurfaceHandle, {
  threadId: string;
  imageUrl: string;
  layers: CreativeCanvasEditorLayer[];
  design: { width: number; height: number; background: string };
  selectedLayerId: string | null;
  tool: FabricDesignTool;
  onSelectionChange: (layerId: string | null) => void;
  onLayersChange: (layers: CreativeCanvasEditorLayer[]) => void;
}>(function FabricDesignSurface({
  threadId,
  imageUrl,
  layers,
  design,
  selectedLayerId,
  tool,
  onSelectionChange,
  onLayersChange,
}, ref) {
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<FabricCanvas | null>(null);
  const fabricRef = useRef<FabricModule | null>(null);
  const layersRef = useRef(layers);
  const designRef = useRef(design);
  const toolRef = useRef(tool);
  const onLayersChangeRef = useRef(onLayersChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const renderGenerationRef = useRef(0);
  const suppressEventsRef = useRef(false);
  const [readyVersion, setReadyVersion] = useState(0);

  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { designRef.current = design; }, [design]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { onLayersChangeRef.current = onLayersChange; }, [onLayersChange]);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);

  useImperativeHandle(ref, () => ({
    exportDataUrl(format, quality = 1) {
      const canvas = canvasRef.current;
      return canvas ? canvas.toDataURL({
        format,
        quality,
        multiplier: designRef.current.width / Math.max(1, canvas.getWidth()),
      }) : null;
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    void (async () => {
      if (!canvasElementRef.current || !containerRef.current) return;
      const fabric = await import("fabric");
      if (cancelled || !canvasElementRef.current || !containerRef.current) return;
      fabricRef.current = fabric;
      const canvas = new fabric.Canvas(canvasElementRef.current, {
        preserveObjectStacking: true,
        selection: true,
        uniformScaling: true,
        enableRetinaScaling: false,
        backgroundColor: designRef.current.background,
      });
      canvasRef.current = canvas;

      const syncSelection = () => {
        const active = canvas.getActiveObject() as FabricObject | undefined;
        onSelectionChangeRef.current(active?.dataLayerId ?? null);
      };
      const syncModifiedObject = (event: { target?: import("fabric").FabricObject }) => {
        if (suppressEventsRef.current || !event.target) return;
        const object = event.target as FabricObject;
        if (!object.dataLayerId) return;
        const next = layersRef.current.map((layer) =>
          layer.id === object.dataLayerId
            ? fabricObjectToLayer(object, layer, designRef.current)
            : layer);
        onLayersChangeRef.current(next);
      };
      canvas.on("selection:created", syncSelection);
      canvas.on("selection:updated", syncSelection);
      canvas.on("selection:cleared", syncSelection);
      canvas.on("object:modified", syncModifiedObject);
      canvas.on("text:editing:exited", syncModifiedObject);

      let drawingPoints: Array<{ x: number; y: number }> = [];
      let drawingPreview: import("fabric").Polyline | null = null;
      const startDrawing = (event: { e: import("fabric").TPointerEvent }) => {
        if (toolRef.current !== "draw" || !fabricRef.current) return;
        canvas.discardActiveObject();
        const point = canvas.getScenePoint(event.e);
        drawingPoints = [{ x: point.x, y: point.y }];
      };
      const continueDrawing = (event: { e: import("fabric").TPointerEvent }) => {
        if (toolRef.current !== "draw" || !drawingPoints.length || !fabricRef.current) return;
        const point = canvas.getScenePoint(event.e);
        const previous = drawingPoints.at(-1);
        if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 3) return;
        drawingPoints.push({ x: point.x, y: point.y });
        if (drawingPreview) canvas.remove(drawingPreview);
        drawingPreview = new fabricRef.current.Polyline(drawingPoints, {
          fill: "transparent",
          stroke: "#ef4444",
          strokeWidth: 4,
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        canvas.add(drawingPreview);
        canvas.requestRenderAll();
      };
      const finishDrawing = () => {
        if (drawingPreview) canvas.remove(drawingPreview);
        drawingPreview = null;
        if (drawingPoints.length >= 2) {
          const currentDesign = designRef.current;
          const layer: CreativeCanvasEditorDrawingLayer = {
            id: `drawing-${crypto.randomUUID()}`,
            kind: "drawing",
            name: `画笔 ${layersRef.current.filter((item) => item.kind === "drawing").length + 1}`,
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            points: drawingPoints.slice(0, 1_500).map((point) => ({
              x: clamp((point.x / currentDesign.width) * 100, 0, 100),
              y: clamp((point.y / currentDesign.height) * 100, 0, 100),
            })),
            stroke: "#ef4444",
            strokeWidth: 4,
          };
          onLayersChangeRef.current([...layersRef.current, layer]);
          onSelectionChangeRef.current(layer.id);
        }
        drawingPoints = [];
      };
      canvas.on("mouse:down", startDrawing);
      canvas.on("mouse:move", continueDrawing);
      canvas.on("mouse:up", finishDrawing);

      const resize = () => resizeFabricCanvas(canvas, containerRef.current, designRef.current);
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(containerRef.current);
      resize();
      setReadyVersion((version) => version + 1);
    })();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      const canvas = canvasRef.current;
      canvasRef.current = null;
      fabricRef.current = null;
      if (canvas) void canvas.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    for (const object of canvas.getObjects() as FabricObject[]) {
      if (object.dataLayerId) object.set({ selectable: tool === "select", evented: tool === "select" });
    }
    canvas.selection = tool === "select";
    canvas.defaultCursor = tool === "draw" ? "crosshair" : "default";
    canvas.requestRenderAll();
  }, [readyVersion, tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const fabric = fabricRef.current;
    if (!canvas || !fabric) return;
    const generation = ++renderGenerationRef.current;
    void renderFabricScene({
      canvas,
      fabric,
      imageUrl,
      layers,
      design,
      threadId,
      selectedLayerId,
      generation,
      renderGenerationRef,
      suppressEventsRef,
    });
  }, [design, imageUrl, layers, readyVersion, threadId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const selected = (canvas.getObjects() as FabricObject[])
      .find((object) => object.dataLayerId === selectedLayerId);
    if (selected && canvas.getActiveObject() !== selected) canvas.setActiveObject(selected);
    else if (!selected && canvas.getActiveObject()) canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, [readyVersion, selectedLayerId]);

  return (
    <div ref={containerRef} className="relative flex size-full min-h-0 items-center justify-center overflow-hidden" data-fabric-design-surface>
      <canvas ref={canvasElementRef} aria-label="Fabric 电商设计画布" />
    </div>
  );
});

async function renderFabricScene({
  canvas,
  fabric,
  imageUrl,
  layers,
  design,
  threadId,
  selectedLayerId,
  generation,
  renderGenerationRef,
  suppressEventsRef,
}: {
  canvas: FabricCanvas;
  fabric: FabricModule;
  imageUrl: string;
  layers: CreativeCanvasEditorLayer[];
  design: { width: number; height: number; background: string };
  threadId: string;
  selectedLayerId: string | null;
  generation: number;
  renderGenerationRef: React.MutableRefObject<number>;
  suppressEventsRef: React.MutableRefObject<boolean>;
}) {
  suppressEventsRef.current = true;
  canvas.discardActiveObject();
  canvas.clear();
  canvas.backgroundColor = design.background;
  resizeFabricCanvas(canvas, canvas.getElement().parentElement?.parentElement ?? null, design);
  const base = await fabric.FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" });
  if (generation !== renderGenerationRef.current) return;
  fitBaseImage(base, design);
  base.set({ selectable: false, evented: false, excludeFromExport: false, dataLayerId: undefined });
  canvas.add(base);
  for (const layer of layers) {
    const object = await fabricObjectFromLayer(fabric, layer, imageUrl, threadId, design);
    if (generation !== renderGenerationRef.current) return;
    if (!object) continue;
    object.set({
      dataLayerId: layer.id,
      selectable: !layer.locked,
      evented: !layer.locked,
      hasControls: !layer.locked,
      borderColor: "#0d0d0d",
      cornerColor: "#ffffff",
      cornerStrokeColor: "#0d0d0d",
      cornerStyle: "circle",
      transparentCorners: false,
      padding: 2,
    });
    canvas.add(object);
  }
  const selected = (canvas.getObjects() as FabricObject[]).find((object) => object.dataLayerId === selectedLayerId);
  if (selected) canvas.setActiveObject(selected);
  canvas.requestRenderAll();
  suppressEventsRef.current = false;
}

async function fabricObjectFromLayer(
  fabric: FabricModule,
  layer: CreativeCanvasEditorLayer,
  baseImageUrl: string,
  threadId: string,
  design: { width: number; height: number },
): Promise<FabricObject | null> {
  const left = (layer.x / 100) * design.width;
  const top = (layer.y / 100) * design.height;
  const targetWidth = (layer.width / 100) * design.width;
  const targetHeight = (layer.height / 100) * design.height;
  const common = {
    left,
    top,
    originX: "left" as const,
    originY: "top" as const,
    angle: layer.rotation,
    opacity: layer.opacity,
    visible: layer.visible,
    lockMovementX: layer.locked,
    lockMovementY: layer.locked,
    lockScalingX: layer.locked,
    lockScalingY: layer.locked,
    lockRotation: layer.locked,
  };
  if (layer.kind === "text") {
    return new fabric.Textbox(layer.text, {
      ...common,
      width: targetWidth,
      fontSize: layer.fontSize,
      fill: layer.color,
      textAlign: layer.align,
      fontWeight: layer.fontWeight,
      splitByGrapheme: true,
    }) as FabricObject;
  }
  if (layer.kind === "shape") {
    const shape = layer.shape === "ellipse"
      ? new fabric.Ellipse({ ...common, rx: targetWidth / 2, ry: targetHeight / 2 })
      : new fabric.Rect({ ...common, width: targetWidth, height: targetHeight });
    shape.set({ fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth });
    return shape as FabricObject;
  }
  if (layer.kind === "drawing") {
    return new fabric.Polyline(layer.points.map((point) => ({
      x: (point.x / 100) * design.width,
      y: (point.y / 100) * design.height,
    })), {
      ...common,
      fill: "transparent",
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth,
      strokeLineCap: "round",
      strokeLineJoin: "round",
      objectCaching: false,
    }) as FabricObject;
  }
  const sourceUrl = layer.source === "canvas_asset" && layer.assetId
    ? `/api/agent/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(layer.assetId)}`
    : baseImageUrl;
  const image = await fabric.FabricImage.fromURL(sourceUrl, { crossOrigin: "anonymous" });
  if (!image.width || !image.height) return null;
  if (layer.crop) {
    image.set({
      cropX: (layer.crop.x / 100) * image.width,
      cropY: (layer.crop.y / 100) * image.height,
      width: (layer.crop.width / 100) * image.width,
      height: (layer.crop.height / 100) * image.height,
    });
  }
  image.set({
    ...common,
    scaleX: targetWidth / (image.width || 1),
    scaleY: targetHeight / (image.height || 1),
  });
  if (layer.filters) {
    image.filters = [
      new fabric.filters.Brightness({ brightness: layer.filters.brightness }),
      new fabric.filters.Contrast({ contrast: layer.filters.contrast }),
      new fabric.filters.Saturation({ saturation: layer.filters.saturation }),
      new fabric.filters.Blur({ blur: layer.filters.blur }),
    ];
    image.applyFilters();
  }
  return image as FabricObject;
}

function fabricObjectToLayer(
  object: FabricObject,
  layer: CreativeCanvasEditorLayer,
  design: { width: number; height: number },
): CreativeCanvasEditorLayer {
  const common = {
    x: clamp(((object.left ?? 0) / design.width) * 100, -100, 200),
    y: clamp(((object.top ?? 0) / design.height) * 100, -100, 200),
    width: clamp((object.getScaledWidth() / design.width) * 100, 1, 200),
    height: clamp((object.getScaledHeight() / design.height) * 100, 1, 200),
    rotation: object.angle ?? 0,
    opacity: object.opacity ?? 1,
    visible: object.visible !== false,
  };
  if (layer.kind === "text" && "text" in object) {
    const textObject = object as import("fabric").Textbox;
    return {
      ...layer,
      ...common,
      text: textObject.text,
      fontSize: textObject.fontSize ?? layer.fontSize,
      color: typeof textObject.fill === "string" ? textObject.fill : layer.color,
      align: textObject.textAlign === "center" || textObject.textAlign === "right" ? textObject.textAlign : "left",
      fontWeight: normalizeFontWeight(textObject.fontWeight, layer.fontWeight),
    };
  }
  return { ...layer, ...common } as CreativeCanvasEditorLayer;
}

function fitBaseImage(image: import("fabric").FabricImage, design: { width: number; height: number }) {
  const scale = Math.min(design.width / (image.width || 1), design.height / (image.height || 1));
  image.set({
    left: (design.width - (image.width || 1) * scale) / 2,
    top: (design.height - (image.height || 1) * scale) / 2,
    originX: "left",
    originY: "top",
    scaleX: scale,
    scaleY: scale,
  });
}

function resizeFabricCanvas(
  canvas: FabricCanvas,
  container: HTMLElement | null,
  design: { width: number; height: number },
) {
  if (!container) return;
  const availableWidth = Math.max(200, container.clientWidth - 40);
  const availableHeight = Math.max(200, container.clientHeight - 40);
  const scale = Math.min(availableWidth / design.width, availableHeight / design.height);
  canvas.setDimensions({ width: Math.round(design.width * scale), height: Math.round(design.height * scale) });
  canvas.setViewportTransform([scale, 0, 0, scale, 0, 0]);
  canvas.calcOffset();
}

function normalizeFontWeight(value: string | number | undefined, fallback: 400 | 500 | 600 | 700) {
  const numeric = typeof value === "number" ? value : Number(value);
  return numeric === 400 || numeric === 500 || numeric === 600 || numeric === 700 ? numeric : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
