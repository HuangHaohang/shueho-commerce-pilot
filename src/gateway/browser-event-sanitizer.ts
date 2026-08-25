import type { AppServerEvent } from "../codex/protocol.js";

export function sanitizeBrowserAppServerEvent(event: AppServerEvent): AppServerEvent {
  if (event.type !== "notification" || !isRecord(event.params) || !isRecord(event.params.item)) return event;
  const item = event.params.item;
  if (item.type !== "userMessage" || !Array.isArray(item.content)) return event;
  const content = item.content
    .filter(isRecord)
    .flatMap((entry): Record<string, unknown>[] => {
      if (entry.type === "localImage") return [{ type: "localImage" }];
      if (entry.type === "text" && typeof entry.text === "string") {
        if (entry.text.trimStart().startsWith("<commerce_attachment_context")) return [];
        return [{ ...entry, text: stripAttachmentContextBlocks(entry.text) }];
      }
      return [entry];
    });
  return {
    ...event,
    params: {
      ...event.params,
      item: { ...item, content },
    },
  } as AppServerEvent;
}

export function stripAttachmentContextBlocks(value: string): string {
  return value.replace(/\n?<commerce_attachment_context\b[\s\S]*$/i, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
