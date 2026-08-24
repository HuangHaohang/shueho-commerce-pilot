export type ConversationMinimapMarkerInput = {
  id: string;
  offsetTop: number;
  preview: string;
  kind: "user" | "assistant" | "activity" | "image" | "status";
};

export type ConversationMinimapMarker = ConversationMinimapMarkerInput & {
  positionPercent: number;
};

export type ConversationMinimapState = {
  visible: boolean;
  scrollPercent: number;
  viewportStartPercent: number;
  viewportSizePercent: number;
  markers: ConversationMinimapMarker[];
};

const MINIMAP_IDLE_MARKER_WIDTH = 6;
const MINIMAP_HOVER_MARKER_WIDTHS = [24, 20, 16, 13, 10, 8] as const;

export function calculateConversationMinimap(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  markerInputs: ConversationMinimapMarkerInput[],
): ConversationMinimapState {
  const safeScrollHeight = Math.max(1, scrollHeight);
  const safeClientHeight = Math.max(0, clientHeight);
  const maxScrollTop = Math.max(0, safeScrollHeight - safeClientHeight);
  const clampedScrollTop = clamp(scrollTop, 0, maxScrollTop);
  const viewportSizePercent = clamp((safeClientHeight / safeScrollHeight) * 100, 0, 100);
  const viewportStartPercent = clamp((clampedScrollTop / safeScrollHeight) * 100, 0, 100 - viewportSizePercent);
  const scrollPercent = maxScrollTop > 0 ? (clampedScrollTop / maxScrollTop) * 100 : 0;
  const markers = markerInputs
    .map((marker) => ({
      ...marker,
      positionPercent: clamp((marker.offsetTop / safeScrollHeight) * 100, 0, 100),
    }))
    .sort((left, right) => left.positionPercent - right.positionPercent);

  return {
    visible: maxScrollTop > 48 && markers.length > 1,
    scrollPercent,
    viewportStartPercent,
    viewportSizePercent,
    markers,
  };
}

export function selectConversationMinimapPromptMarkers(
  markers: ConversationMinimapMarkerInput[],
): ConversationMinimapMarkerInput[] {
  return markers.filter((marker) => marker.kind === "user");
}

export function calculateConversationMinimapMarkerWidth(
  markerIndex: number,
  hoveredMarkerIndex: number,
): number {
  if (hoveredMarkerIndex < 0) {
    return MINIMAP_IDLE_MARKER_WIDTH;
  }
  const distance = Math.abs(markerIndex - hoveredMarkerIndex);
  return MINIMAP_HOVER_MARKER_WIDTHS[distance] ?? MINIMAP_IDLE_MARKER_WIDTH;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
