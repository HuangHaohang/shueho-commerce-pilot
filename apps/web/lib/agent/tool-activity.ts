import { readWebSourcesFromToolItem, type WebSource } from "./web-sources";

export type ToolActivityMetadata = {
  kind: "image" | "search" | "tool";
  detail: string | null;
  isWebSearch: boolean;
  namespace: string;
  sources: WebSource[];
  tool: string;
};

export function readDynamicToolActivity(item: Record<string, unknown>): ToolActivityMetadata {
  const namespace = typeof item.namespace === "string" ? item.namespace : "";
  const tool = typeof item.tool === "string" ? item.tool : "工具";
  const isWebSearch = namespace === "commerce_web";
  return {
    namespace,
    tool,
    isWebSearch,
    kind: namespace === "commerce_image" ? "image" : isWebSearch ? "search" : "tool",
    detail: isWebSearch ? readWebSearchFailure(item) : namespace ? `${namespace}.${tool}` : tool,
    sources: isWebSearch ? readWebSourcesFromToolItem(item) : [],
  };
}

export function readMcpToolActivity(item: Record<string, unknown>): ToolActivityMetadata {
  const namespace = typeof item.server === "string" ? item.server : "";
  const tool = typeof item.tool === "string" ? item.tool : "";
  const isWebSearch = namespace === "commerce_web" && tool === "search";
  return {
    namespace,
    tool,
    isWebSearch,
    kind: isWebSearch ? "search" : "tool",
    detail: isWebSearch ? readWebSearchFailure(item) : tool || null,
    sources: isWebSearch ? readWebSourcesFromToolItem(item) : [],
  };
}

function readWebSearchFailure(item: Record<string, unknown>): string | null {
  if (item.status !== "failed") return null;
  const result = isRecord(item.result) ? item.result : null;
  const structured = result && isRecord(result.structuredContent) ? result.structuredContent : null;
  const structuredError = structured && typeof structured.error === "string" ? structured.error.trim() : "";
  if (structuredError) return structuredError.slice(0, 300);
  const content = result && Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter(isRecord)
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text as string)
    .join(" ")
    .trim();
  if (/Provider request timed out/i.test(text)) return "网页搜索服务超时，请缩短查询范围后重试。";
  if (/no source URL/i.test(text)) return "网页搜索服务未返回可核验来源，请更换查询词后重试。";
  return text ? "网页搜索服务暂时不可用。" : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
