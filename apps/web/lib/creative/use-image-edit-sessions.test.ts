import { describe, expect, it } from "vitest";

import {
  findImageEditSession,
  needsImageEditSessionReconciliation,
  type ImageEditSession,
} from "./use-image-edit-sessions";

const projectThreadId = "project-test123";
const rootFilename = "1789000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png";

function session(threadId: string, assetFilename = rootFilename): ImageEditSession {
  return {
    threadId,
    projectThreadId,
    sourceFilename: rootFilename,
    assetFilename,
    thread: {
      threadId,
      title: "图片编辑",
      createdAt: "2026-09-14T00:00:00.000Z",
      status: "failed",
      activeTurnId: null,
      turnStartedAt: null,
      durationMs: null,
      recipeId: "creative_project",
      category: "creative",
      updatedAt: "2026-09-14T00:00:00.000Z",
      toolContractVersion: 1,
    },
  };
}

describe("persisted image-edit session lookup", () => {
  it("reuses the asset-root editor even when its controller is not currently running", () => {
    const reusable = session("editor-test123");
    const other = session("editor-other123", "other-root.png");

    expect(findImageEditSession([other, reusable], projectThreadId, rootFilename)).toBe(reusable);
  });

  it("does not cross project or asset-root boundaries", () => {
    const reusable = session("editor-test123");
    expect(findImageEditSession([reusable], "another-project", rootFilename)).toBeUndefined();
    expect(findImageEditSession([reusable], projectThreadId, "other-root.png")).toBeUndefined();
  });

  it("asks the server to verify only an editor that has not started a native Turn", () => {
    const empty = session("editor-empty123");
    const started = session("editor-started123");
    started.thread.turnStartedAt = "2026-09-14T00:01:00.000Z";

    expect(needsImageEditSessionReconciliation(empty)).toBe(true);
    expect(needsImageEditSessionReconciliation(started)).toBe(false);
  });
});
