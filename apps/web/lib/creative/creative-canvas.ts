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
  const documents = messages
    .map(toDocumentCandidate)
    .filter((delivery): delivery is CreativeCanvasDocumentCandidate => Boolean(delivery));
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
    deliverableType: metadata.deliverableType,
    channel: metadata.channel,
  };
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
