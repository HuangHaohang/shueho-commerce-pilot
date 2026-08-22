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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
