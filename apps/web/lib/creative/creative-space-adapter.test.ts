import { describe, expect, it } from "vitest";

import { createMockCreativeSpaceAdapter } from "./creative-space-adapter";

describe("creative space mock adapter", () => {
  it("creates a collaborative project with at most one source task", () => {
    const adapter = createMockCreativeSpaceAdapter();
    const snapshot = adapter.getSnapshot();
    const project = adapter.createProject({
      name: "测试内容方向",
      linkedTaskIds: [snapshot.tasks[0].id, snapshot.tasks[1].id],
      productIds: [snapshot.products[0].id],
      platforms: ["抖音"],
      contentGoal: "验证基础项目创建",
      leadId: snapshot.people[0].id,
      memberIds: [snapshot.people[1].id],
    });

    expect(project.linkedTasks.map((task) => task.id)).toEqual([snapshot.tasks[0].id, snapshot.tasks[1].id]);
    expect(project.members.map((member) => member.id)).toEqual([
      snapshot.people[0].id,
      snapshot.people[1].id,
    ]);
    expect(adapter.getSnapshot().projects[0].id).toBe(project.id);
  });

  it("keeps chapter notes and linked system documents in the project context", () => {
    const adapter = createMockCreativeSpaceAdapter();
    const snapshot = adapter.getSnapshot();
    const project = snapshot.projects[0];
    const updated = adapter.updateChapter({
      projectId: project.id,
      chapter: "产品确认",
      body: "补充无吸管结构的清洁证据。",
      documentIds: [snapshot.documents[0].id, "unknown-document"],
    });

    expect(updated.chapters.产品确认).toEqual({
      body: "补充无吸管结构的清洁证据。",
      documentIds: [snapshot.documents[0].id],
    });
    expect(updated.currentChapter).toBe("产品确认");
  });
});
