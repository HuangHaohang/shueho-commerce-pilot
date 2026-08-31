import type {
  ConversationMessage,
  GeneratedImageItem,
} from "@/lib/agent/use-agent-thread";
import {
  tryParseStructuredCopywritingAnswer,
  tryParseStructuredCopywritingDraft,
  type CopywritingDraft,
} from "@/lib/copywriting/brief";

import {
  isCreativeMethod,
  type CreativeMethod,
} from "./creative-method-contract";
import type {
  CreativeCanvasBlock,
  CreativeCanvasImageTextLayer,
  CreativeCanvasLayout,
  CreativeCanvasSourceNode,
  CreativeCanvasTableContent,
} from "./creative-canvas-types";

type CreativeCanvasDeliveryBase = {
  id: string;
  sequence: number;
  turnId: string | null;
  deliverableType: CreativeMethod | null;
  channel: string | null;
  ordinal: number;
  total: number;
};

export type CreativeCanvasDocumentDelivery = CreativeCanvasDeliveryBase & {
  kind: "document";
  content: string;
  draft: CopywritingDraft | null;
  blocks: CreativeCanvasBlock[];
};

export type CreativeCanvasImageGroupDelivery = CreativeCanvasDeliveryBase & {
  kind: "imageGroup";
  images: GeneratedImageItem[];
  companion: CreativeCanvasDocumentDelivery | null;
};

export type CreativeCanvasDelivery =
  | CreativeCanvasDocumentDelivery
  | CreativeCanvasImageGroupDelivery;

type CreativeCanvasDocumentCandidate = Omit<CreativeCanvasDocumentDelivery, "ordinal" | "total">;
type CreativeCanvasImageGroupCandidate = Omit<CreativeCanvasImageGroupDelivery, "ordinal" | "total" | "companion"> & {
  companion: CreativeCanvasDocumentCandidate | null;
};

/**
 * Projects and conversations remain authoritative in Codex App Server. The
 * canvas is only a projection of persisted Harness items and owns no version
 * state of its own.
 */
export function listCreativeCanvasDeliveries(
  messages: readonly ConversationMessage[],
  images: readonly GeneratedImageItem[],
): CreativeCanvasDelivery[] {
  const seenDocuments = new Set<string>();
  const documents = messages
    .map(toDocumentCandidate)
    .filter((delivery): delivery is CreativeCanvasDocumentCandidate => Boolean(delivery))
    .filter((delivery) => {
      const key = `${delivery.turnId ?? delivery.id}\u0000${delivery.content}`;
      if (seenDocuments.has(key)) return false;
      seenDocuments.add(key);
      return true;
    });
  const imageGroups = groupImagesByTurn(images);
  const documentsMergedIntoImageTurns = new Set<string>();

  for (const group of imageGroups) {
    if (!group.turnId) continue;
    const companions = documents.filter((document) => document.turnId === group.turnId);
    if (!companions.length) continue;
    const companion = companions.reduce((latest, document) =>
      document.sequence > latest.sequence ? document : latest,
    );
    group.companion = companion;
    group.sequence = Math.max(group.sequence, companion.sequence);
    group.deliverableType = companion.deliverableType;
    group.channel = companion.channel;
    documentsMergedIntoImageTurns.add(group.turnId);
  }

  const candidates: Array<CreativeCanvasDocumentCandidate | CreativeCanvasImageGroupCandidate> = [
    ...documents.filter((document) => !document.turnId || !documentsMergedIntoImageTurns.has(document.turnId)),
    ...imageGroups,
  ].sort((left, right) => left.sequence - right.sequence);
  const total = candidates.length;

  return candidates.map((candidate, index) => {
    const ordinal = index + 1;
    if (candidate.kind === "imageGroup") {
      return {
        ...candidate,
        companion: candidate.companion
          ? { ...candidate.companion, ordinal, total }
          : null,
        ordinal,
        total,
      };
    }
    return { ...candidate, ordinal, total };
  });
}

export function selectLatestCreativeCanvasDelivery(
  messages: readonly ConversationMessage[],
  images: readonly GeneratedImageItem[],
): CreativeCanvasDelivery | null {
  const deliveries = listCreativeCanvasDeliveries(messages, images);
  return deliveries.at(-1) ?? null;
}

export function listCreativeCanvasSourceNodes(
  messages: readonly ConversationMessage[],
  images: readonly GeneratedImageItem[],
): CreativeCanvasSourceNode[] {
  const sources: Omit<CreativeCanvasSourceNode, "layout">[] = [];
  const deliveries = listCreativeCanvasDeliveries(messages, images);

  for (const delivery of deliveries) {
    if (delivery.kind === "imageGroup") {
      for (const block of delivery.companion?.blocks.filter((entry) => entry.type !== "image") ?? []) {
        const title = boundedText(block.title || delivery.companion?.draft?.title || "未命名创作", 240);
        sources.push({
          sourceKind: "agent_message",
          sourceItemId: delivery.companion?.id ?? delivery.id,
          sourceBlockKey: safeBlockKey(block.key),
          sourceTurnId: delivery.turnId,
          sourceSequence: delivery.companion?.sequence ?? delivery.sequence,
          messageItemId: delivery.companion?.id ?? null,
          nodeType: block.type,
          deliverableType: delivery.deliverableType,
          channel: delivery.channel,
          title,
          content: block.type === "table"
            ? tableContentFromBlock(title, block)
            : {
                kind: "document",
                title,
                body: block.body || delivery.companion?.draft?.body || "",
                callToAction: delivery.companion?.draft?.callToAction ?? "",
                complianceNotes: delivery.companion?.draft?.complianceNotes ?? [],
              },
        });
      }
      const imageBlocks = delivery.companion?.blocks.filter((block) => block.type === "image") ?? [];
      delivery.images.forEach((image, index) => {
        const block = imageBlocks[index] ?? null;
        const title = boundedText(
          block?.title || delivery.companion?.draft?.title || `创作图片 ${index + 1}`,
          240,
        );
        sources.push({
          sourceKind: "image_generation",
          sourceItemId: image.id,
          sourceBlockKey: safeBlockKey(block?.key || `image-${index + 1}`),
          sourceTurnId: delivery.turnId,
          sourceSequence: image.sequence,
          messageItemId: delivery.companion?.id ?? null,
          nodeType: "image",
          deliverableType: delivery.deliverableType,
          channel: delivery.channel,
          title,
          content: {
            kind: "image",
            title,
            description: block?.body || delivery.companion?.draft?.body || "",
            image: {
              artifactId: image.id,
              url: image.url,
              filename: image.filename,
              model: image.model,
            },
            textLayers: block?.textLayers ?? [],
            complianceNotes: delivery.companion?.draft?.complianceNotes ?? [],
          },
        });
      });
      continue;
    }

    if (delivery.deliverableType === "main_image" || delivery.deliverableType === "gallery_images") {
      // Native imageGeneration Items are the only image artifact authority.
      // A model-authored image block without a completed artifact must never
      // materialize as a document node that looks like a generated image.
      continue;
    }

    const materializedBlocks = delivery.blocks.filter((block) => block.type !== "image");
    if (materializedBlocks.length > 0) {
      for (const block of materializedBlocks) {
        const title = boundedText(block.title || delivery.draft?.title || "未命名创作", 240);
        if (block.type === "table") {
          sources.push({
            sourceKind: "agent_message",
            sourceItemId: delivery.id,
            sourceBlockKey: safeBlockKey(block.key),
            sourceTurnId: delivery.turnId,
            sourceSequence: delivery.sequence,
            messageItemId: delivery.id,
            nodeType: "table",
            deliverableType: delivery.deliverableType,
            channel: delivery.channel,
            title,
            content: tableContentFromBlock(title, block),
          });
        } else {
          sources.push({
            sourceKind: "agent_message",
            sourceItemId: delivery.id,
            sourceBlockKey: safeBlockKey(block.key),
            sourceTurnId: delivery.turnId,
            sourceSequence: delivery.sequence,
            messageItemId: delivery.id,
            nodeType: "document",
            deliverableType: delivery.deliverableType,
            channel: delivery.channel,
            title,
            content: {
              kind: "document",
              title,
              body: block.body || delivery.draft?.body || delivery.content,
              callToAction: delivery.draft?.callToAction ?? "",
              complianceNotes: delivery.draft?.complianceNotes ?? [],
            },
          });
        }
      }
      continue;
    }

    const title = boundedText(delivery.draft?.title || "创作文档", 240);
    if (delivery.deliverableType === "shooting_script" || delivery.deliverableType === "video_storyboard") {
      sources.push({
        sourceKind: "agent_message",
        sourceItemId: delivery.id,
        sourceBlockKey: "primary",
        sourceTurnId: delivery.turnId,
        sourceSequence: delivery.sequence,
        messageItemId: delivery.id,
        nodeType: "table",
        deliverableType: delivery.deliverableType,
        channel: delivery.channel,
        title,
        content: tableContentFromMarkdown(
          title,
          delivery.draft?.body || delivery.content,
          delivery.draft?.complianceNotes ?? [],
        ),
      });
    } else {
      sources.push({
        sourceKind: "agent_message",
        sourceItemId: delivery.id,
        sourceBlockKey: "primary",
        sourceTurnId: delivery.turnId,
        sourceSequence: delivery.sequence,
        messageItemId: delivery.id,
        nodeType: "document",
        deliverableType: delivery.deliverableType,
        channel: delivery.channel,
        title,
        content: {
          kind: "document",
          title,
          body: delivery.draft?.body || delivery.content,
          callToAction: delivery.draft?.callToAction ?? "",
          complianceNotes: delivery.draft?.complianceNotes ?? [],
        },
      });
    }
  }

  return applyDefaultCanvasLayouts(
    sources.sort((left, right) => left.sourceSequence - right.sourceSequence),
  );
}

export function parseCreativeCanvasBlocks(content: string): CreativeCanvasBlock[] {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    if (!Array.isArray(parsed.canvasBlocks)) return [];
    const seen = new Set<string>();
    const blocks: CreativeCanvasBlock[] = [];
    for (const value of parsed.canvasBlocks.slice(0, 12)) {
      if (!isRecord(value)) continue;
      const type = value.type === "document" || value.type === "image" || value.type === "table"
        ? value.type
        : null;
      if (!type) continue;
      const key = safeBlockKey(typeof value.key === "string" ? value.key : `block-${blocks.length + 1}`);
      if (seen.has(key)) continue;
      seen.add(key);
      const columns = Array.isArray(value.columns)
        ? value.columns.filter((column): column is string => typeof column === "string").slice(0, 8).map((column) => boundedText(column, 80))
        : [];
      const rows = Array.isArray(value.rows)
        ? value.rows.slice(0, 60).flatMap((row) => {
            if (!isRecord(row) || !Array.isArray(row.cells)) return [];
            return [{ cells: row.cells.slice(0, 8).map((cell) => boundedText(typeof cell === "string" ? cell : "", 2_000)) }];
          })
        : [];
      const textLayers = Array.isArray(value.textLayers)
        ? value.textLayers.slice(0, 24).flatMap((layer, layerIndex) => parseTextLayer(layer, layerIndex))
        : [];
      blocks.push({
        key,
        type,
        title: boundedText(typeof value.title === "string" ? value.title : "未命名内容", 240),
        body: boundedText(typeof value.body === "string" ? value.body : "", 80_000),
        columns,
        rows,
        textLayers,
      });
    }
    return blocks;
  } catch {
    return [];
  }
}

function toDocumentCandidate(message: ConversationMessage): CreativeCanvasDocumentCandidate | null {
  if (
    message.role !== "assistant" ||
    message.status !== "completed" ||
    message.phase === "commentary"
  ) {
    return null;
  }

  const content = message.content.trim();
  if (!content) return null;
  const draft = tryParseStructuredCopywritingDraft(content);
  if (!draft && tryParseStructuredCopywritingAnswer(content)) {
    // A conversational answer should not replace the current creative asset.
    return null;
  }
  const metadata = readCreativeDraftMetadata(content);

  return {
    kind: "document",
    id: message.id,
    sequence: message.sequence,
    turnId: message.turnId ?? null,
    content,
    draft,
    blocks: parseCreativeCanvasBlocks(content),
    deliverableType: metadata.deliverableType,
    channel: metadata.channel,
  };
}

function tableContentFromBlock(title: string, block: CreativeCanvasBlock): CreativeCanvasTableContent {
  if (block.columns.length > 0 && block.rows.length > 0) {
    return {
      kind: "table",
      title,
      columns: block.columns,
      rows: block.rows.map((row, index) => ({
        id: `${safeBlockKey(block.key)}-row-${index + 1}`,
        cells: normalizeCells(row.cells, block.columns.length),
      })),
      notes: [],
    };
  }
  return tableContentFromMarkdown(title, block.body, []);
}

function tableContentFromMarkdown(
  title: string,
  markdown: string,
  notes: string[],
): CreativeCanvasTableContent {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!lines[index]?.startsWith("|") || !/^\|?[\s:|-]+\|?$/.test(lines[index + 1] ?? "")) continue;
    const columns = splitMarkdownRow(lines[index] ?? "").slice(0, 8);
    if (!columns.length) continue;
    const rows: Array<{ id: string; cells: string[] }> = [];
    for (let rowIndex = index + 2; rowIndex < lines.length && lines[rowIndex]?.startsWith("|"); rowIndex += 1) {
      rows.push({ id: `row-${rows.length + 1}`, cells: normalizeCells(splitMarkdownRow(lines[rowIndex] ?? ""), columns.length) });
      if (rows.length >= 60) break;
    }
    if (rows.length) return { kind: "table", title, columns, rows, notes };
  }

  const fallbackRows = markdown
    .split(/\n{2,}|\r?\n/)
    .map((line) => line.replace(/^[-*#\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((line, index) => ({ id: `row-${index + 1}`, cells: [boundedText(line, 2_000)] }));
  return {
    kind: "table",
    title,
    columns: ["脚本内容"],
    rows: fallbackRows.length ? fallbackRows : [{ id: "row-1", cells: [""] }],
    notes,
  };
}

function splitMarkdownRow(row: string): string[] {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => boundedText(cell.trim(), 2_000));
}

function normalizeCells(cells: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => boundedText(cells[index] ?? "", 2_000));
}

function parseTextLayer(value: unknown, index: number): CreativeCanvasImageTextLayer[] {
  if (!isRecord(value)) return [];
  const text = boundedText(typeof value.text === "string" ? value.text : "", 500);
  if (!text) return [];
  return [{
    id: safeBlockKey(typeof value.id === "string" ? value.id : `text-${index + 1}`),
    text,
    x: clampNumber(value.x, 0, 100, 8),
    y: clampNumber(value.y, 0, 100, 8),
    width: clampNumber(value.width, 10, 100, 42),
    fontSize: clampNumber(value.fontSize, 12, 72, 28),
    align: value.align === "center" || value.align === "right" ? value.align : "left",
  }];
}

function applyDefaultCanvasLayouts(
  sources: Array<Omit<CreativeCanvasSourceNode, "layout">>,
): CreativeCanvasSourceNode[] {
  let rowY = 80;
  let lane = 0;
  let rowHeight = 0;
  return sources.map((source, index) => {
    const height = source.nodeType === "image" ? 420 : source.nodeType === "table" ? 360 : 340;
    if (source.nodeType === "table") {
      if (lane > 0) {
        rowY += rowHeight + 100;
        lane = 0;
        rowHeight = 0;
      }
      const layout = { x: 100, y: rowY, width: 760, height, zIndex: index, locked: false };
      rowY += height + 100;
      return { ...source, layout };
    }
    const layout = {
      x: 80 + lane * 520,
      y: rowY,
      width: 440,
      height,
      zIndex: index,
      locked: false,
    };
    rowHeight = Math.max(rowHeight, height);
    lane += 1;
    if (lane === 2) {
      rowY += rowHeight + 100;
      lane = 0;
      rowHeight = 0;
    }
    return { ...source, layout };
  });
}

function safeBlockKey(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return normalized || "primary";
}

function boundedText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function groupImagesByTurn(images: readonly GeneratedImageItem[]): CreativeCanvasImageGroupCandidate[] {
  const groups = new Map<string, CreativeCanvasImageGroupCandidate>();

  for (const image of images) {
    if (!image.url.trim()) continue;
    const turnId = image.turnId?.trim() || null;
    const key = turnId ? `turn:${turnId}` : `image:${image.id}`;
    const current = groups.get(key);
    if (current) {
      current.images.push(image);
      current.images.sort((left, right) => left.sequence - right.sequence);
      current.sequence = Math.max(current.sequence, image.sequence);
      continue;
    }
    groups.set(key, {
      kind: "imageGroup",
      id: turnId ? `creative-images-${turnId}` : `creative-image-${image.id}`,
      sequence: image.sequence,
      turnId,
      deliverableType: null,
      channel: null,
      images: [image],
      companion: null,
    });
  }

  return [...groups.values()];
}

function readCreativeDraftMetadata(content: string): {
  deliverableType: CreativeMethod | null;
  channel: string | null;
} {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    return {
      deliverableType: isCreativeMethod(parsed.deliverableType) ? parsed.deliverableType : null,
      channel: typeof parsed.channel === "string" && parsed.channel.trim()
        ? parsed.channel.trim().slice(0, 80)
        : null,
    };
  } catch {
    return { deliverableType: null, channel: null };
  }
}
