import type { AppServerEvent } from "../codex/protocol.js";

export function sanitizeBrowserAppServerEvent(event: AppServerEvent): AppServerEvent {
  if (event.type !== "notification" || !isRecord(event.params) || !isRecord(event.params.item)) return event;
  const item = sanitizeBrowserThreadItem(event.params.item);
  return {
    ...event,
    params: {
      ...event.params,
      item,
    },
  } as AppServerEvent;
}

export function sanitizeBrowserThreadItem(item: Record<string, unknown>): Record<string, unknown> {
  if (item.type === "imageGeneration") {
    const { result: _result, savedPath: _savedPath, ...browserItem } = item;
    return browserItem;
  }
  if (item.type !== "userMessage" || !Array.isArray(item.content)) return item;
  const content = item.content
    .filter(isRecord)
    .flatMap((entry): Record<string, unknown>[] => {
      if (entry.type === "localImage") return [{ type: "localImage" }];
      if ((entry.type === "skill" || entry.type === "mention") && typeof entry.name === "string") {
        return [{ type: entry.type, name: entry.name }];
      }
      if (entry.type === "text" && typeof entry.text === "string") {
        if (
          entry.text.trimStart().startsWith("<commerce_attachment_context") ||
          entry.text.trimStart().startsWith("<commerce_product_context")
        ) return [];
        return [{ ...entry, text: stripAttachmentContextBlocks(entry.text) }];
      }
      return [entry];
    });
  return { ...item, content };
}

export function stripAttachmentContextBlocks(value: string): string {
  return value
    .replace(/\n?<commerce_(?:attachment|product)_context\b[\s\S]*$/i, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
