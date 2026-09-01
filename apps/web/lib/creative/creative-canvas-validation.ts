import { z } from "zod";

import type {
  CreativeCanvasLayout,
  CreativeCanvasNodeContent,
  CreativeCanvasViewport,
} from "./creative-canvas-types";

const boundedText = (maximum: number) => z.string().max(maximum);
const safeId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const noteList = z.array(boundedText(2_000)).max(40);

const documentContentSchema = z.object({
  kind: z.literal("document"),
  title: z.string().trim().min(1).max(240),
  body: boundedText(80_000),
  callToAction: boundedText(4_000),
  complianceNotes: noteList,
}).strict();

const tableContentSchema = z.object({
  kind: z.literal("table"),
  title: z.string().trim().min(1).max(240),
  columns: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  rows: z.array(z.object({
    id: safeId,
    cells: z.array(boundedText(2_000)).min(1).max(8),
  }).strict()).min(1).max(60),
  notes: noteList,
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, row] of value.rows.entries()) {
    if (row.cells.length !== value.columns.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rows", index, "cells"],
        message: "表格行列数量不一致。",
      });
    }
    if (ids.has(row.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rows", index, "id"],
        message: "表格行标识重复。",
      });
    }
    ids.add(row.id);
  }
});

const imageTextLayerSchema = z.object({
  id: safeId,
  text: z.string().trim().min(1).max(500),
  x: z.number().finite().min(0).max(100),
  y: z.number().finite().min(0).max(100),
  width: z.number().finite().min(10).max(100),
  fontSize: z.number().finite().min(12).max(72),
  align: z.enum(["left", "center", "right"]),
}).strict();

const editorLayerBase = {
  id: safeId,
  name: z.string().trim().min(1).max(120),
  x: z.number().finite().min(-100).max(200),
  y: z.number().finite().min(-100).max(200),
  width: z.number().finite().min(1).max(200),
  height: z.number().finite().min(1).max(200),
  rotation: z.number().finite().min(-360).max(360),
  opacity: z.number().finite().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
};
const safeColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const editorLayerSchema = z.discriminatedUnion("kind", [
  z.object({
    ...editorLayerBase,
    kind: z.literal("text"),
    text: boundedText(2_000),
    fontSize: z.number().finite().min(8).max(240),
    color: safeColor,
    align: z.enum(["left", "center", "right"]),
    fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
  }).strict(),
  z.object({
    ...editorLayerBase,
    kind: z.literal("shape"),
    shape: z.enum(["rectangle", "ellipse"]),
    fill: safeColor,
    stroke: safeColor,
    strokeWidth: z.number().finite().min(0).max(40),
  }).strict(),
  z.object({
    ...editorLayerBase,
    kind: z.literal("image"),
    source: z.literal("base"),
    fit: z.enum(["contain", "cover"]),
  }).strict(),
  z.object({
    ...editorLayerBase,
    kind: z.literal("drawing"),
    points: z.array(z.object({
      x: z.number().finite().min(0).max(100),
      y: z.number().finite().min(0).max(100),
    }).strict()).min(2).max(1_500),
    stroke: safeColor,
    strokeWidth: z.number().finite().min(1).max(80),
  }).strict(),
]);

const imageContentUpdateSchema = z.object({
  kind: z.literal("image"),
  title: z.string().trim().min(1).max(240),
  description: boundedText(20_000),
  textLayers: z.array(imageTextLayerSchema).max(24),
  editorLayers: z.array(editorLayerSchema).max(64).optional(),
  complianceNotes: noteList,
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, layer] of value.textLayers.entries()) {
    if (ids.has(layer.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["textLayers", index, "id"],
        message: "文字图层标识重复。",
      });
    }
    ids.add(layer.id);
  }
  const editorIds = new Set<string>();
  for (const [index, layer] of (value.editorLayers ?? []).entries()) {
    if (editorIds.has(layer.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["editorLayers", index, "id"],
        message: "编辑图层标识重复。",
      });
    }
    editorIds.add(layer.id);
  }
});

export const creativeCanvasLayoutSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: z.number().finite().min(240).max(1_600),
  height: z.number().finite().min(180).max(1_600),
  zIndex: z.number().int().min(-100_000).max(100_000),
  locked: z.boolean(),
}).strict();

export const creativeCanvasViewportSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  zoom: z.number().finite().min(0.1).max(4),
}).strict();

export const creativeCanvasNodePatchSchema = z.object({
  content: z.unknown().optional(),
  layout: creativeCanvasLayoutSchema.optional(),
}).strict().refine((value) => value.content !== undefined || value.layout !== undefined, {
  message: "至少需要一项画布修改。",
});

export function parseCreativeCanvasContentUpdate(
  current: CreativeCanvasNodeContent,
  value: unknown,
): CreativeCanvasNodeContent {
  if (current.kind === "document") return documentContentSchema.parse(value);
  if (current.kind === "table") return tableContentSchema.parse(value);
  const update = imageContentUpdateSchema.parse(value);
  return {
    ...update,
    editorLayers: update.editorLayers ?? current.editorLayers,
    image: current.image,
  };
}

export function parseCreativeCanvasLayout(value: unknown): CreativeCanvasLayout {
  return creativeCanvasLayoutSchema.parse(value);
}

export function parseCreativeCanvasViewport(value: unknown): CreativeCanvasViewport {
  return creativeCanvasViewportSchema.parse(value);
}
