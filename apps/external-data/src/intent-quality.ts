import type { QualityDecision, ResearchIntent } from "./types.js";

export function applyResearchIntentQuality(
  quality: QualityDecision,
  publishedAt: string | null,
  intent: ResearchIntent,
): QualityDecision {
  const range = intent.timeRange;
  if (!range) return quality;
  const reasons = new Set(quality.reasons);
  if (!publishedAt) {
    reasons.add("PUBLISHED_AT_MISSING");
    return { ...quality, status: "rejected", reasons: [...reasons] };
  }
  const published = Date.parse(publishedAt);
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  if (![published, start, end].every(Number.isFinite)) {
    reasons.add("PUBLISHED_AT_INVALID");
    return { ...quality, status: "rejected", reasons: [...reasons] };
  }
  if (published < start || published > end) {
    reasons.add("OUTSIDE_REQUESTED_WINDOW");
    return { ...quality, status: "rejected", reasons: [...reasons] };
  }
  return quality;
}
