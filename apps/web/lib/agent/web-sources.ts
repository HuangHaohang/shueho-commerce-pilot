export type WebSource = {
  url: string;
  title: string | null;
};

export function readWebSourcesFromToolItem(item: Record<string, unknown>): WebSource[] {
  const result = isRecord(item.result) ? item.result : null;
  const structuredContent = result && isRecord(result.structuredContent) ? result.structuredContent : null;
  const action = isRecord(item.action) ? item.action : null;
  return normalizeWebSources(
    structuredContent?.sources ?? action?.sources ?? item.sources,
  );
}

export function collectRecentWebSources(
  activities: Array<{ sequence: number; sources?: WebSource[] }>,
  limit = 8,
): WebSource[] {
  const collected = new Map<string, WebSource>();
  const newestFirst = [...activities].sort((left, right) => right.sequence - left.sequence);
  for (const activity of newestFirst) {
    for (const source of activity.sources ?? []) {
      const normalized = normalizeSource(source);
      if (!normalized || collected.has(normalized.url)) continue;
      collected.set(normalized.url, normalized);
      if (collected.size >= limit) return [...collected.values()];
    }
  }
  return [...collected.values()];
}

export function selectVisibleWebSources(
  sources: WebSource[],
  expanded: boolean,
  collapsedLimit = 3,
): WebSource[] {
  return expanded ? sources : sources.slice(0, Math.max(0, collapsedLimit));
}

function normalizeWebSources(value: unknown): WebSource[] {
  if (!Array.isArray(value)) return [];
  const sources: WebSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.url !== "string") continue;
    const normalized = normalizeSource({
      url: item.url,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : null,
    });
    if (normalized && !seen.has(normalized.url)) {
      seen.add(normalized.url);
      sources.push(normalized);
    }
  }
  return sources;
}

function normalizeSource(source: WebSource): WebSource | null {
  try {
    const url = new URL(source.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const parameter of [...url.searchParams.keys()]) {
      if (parameter.toLowerCase().startsWith("utm_")) url.searchParams.delete(parameter);
    }
    return { url: url.toString(), title: source.title };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
