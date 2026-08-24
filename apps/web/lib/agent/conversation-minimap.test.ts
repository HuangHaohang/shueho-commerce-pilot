import { describe, expect, it } from "vitest";

import {
  calculateConversationMinimap,
  calculateConversationMinimapMarkerWidth,
  findClosestConversationMinimapMarker,
} from "./conversation-minimap";

const markers = [
  { id: "first", offsetTop: 100, preview: "first", kind: "user" as const },
  { id: "second", offsetTop: 1_000, preview: "second", kind: "assistant" as const },
  { id: "third", offsetTop: 1_900, preview: "third", kind: "activity" as const },
];

describe("conversation minimap geometry", () => {
  it("maps the viewport and timeline anchors to stable percentages", () => {
    const state = calculateConversationMinimap(600, 2_000, 500, markers);

    expect(state.visible).toBe(true);
    expect(state.scrollPercent).toBe(40);
    expect(state.viewportStartPercent).toBe(30);
    expect(state.viewportSizePercent).toBe(25);
    expect(state.markers.map((marker) => marker.positionPercent)).toEqual([5, 50, 95]);
  });

  it("clamps stale scroll and marker measurements", () => {
    const state = calculateConversationMinimap(5_000, 1_000, 400, [
      { id: "before", offsetTop: -50, preview: "before", kind: "user" },
      { id: "after", offsetTop: 2_000, preview: "after", kind: "assistant" },
    ]);

    expect(state.scrollPercent).toBe(100);
    expect(state.viewportStartPercent).toBe(60);
    expect(state.markers.map((marker) => marker.positionPercent)).toEqual([0, 100]);
  });

  it("stays hidden when the conversation does not overflow", () => {
    const state = calculateConversationMinimap(0, 600, 600, markers);

    expect(state.visible).toBe(false);
    expect(state.viewportSizePercent).toBe(100);
  });

  it("keeps every marker aligned until the timeline is hovered", () => {
    expect(markers.map((_, index) => calculateConversationMinimapMarkerWidth(index, -1))).toEqual([6, 6, 6]);
  });

  it("expands neighboring markers symmetrically into a pyramid", () => {
    expect(Array.from({ length: 11 }, (_, index) => calculateConversationMinimapMarkerWidth(index, 5))).toEqual([
      8,
      10,
      13,
      16,
      20,
      24,
      20,
      16,
      13,
      10,
      8,
    ]);
    expect(calculateConversationMinimapMarkerWidth(12, 5)).toBe(6);
  });

  it("selects the closest timeline marker for track-level hovering", () => {
    const state = calculateConversationMinimap(0, 2_000, 500, markers);

    expect(findClosestConversationMinimapMarker(state.markers, 47)?.id).toBe("second");
    expect(findClosestConversationMinimapMarker(state.markers, 100)?.id).toBe("third");
    expect(findClosestConversationMinimapMarker([], 50)).toBeNull();
  });
});
