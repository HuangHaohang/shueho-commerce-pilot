import { describe, expect, it } from "vitest";

import { createMockCreativeSpaceAdapter } from "./creative-space-adapter";

describe("creative space mock adapter", () => {
  it("creates a collaborative project with at most one source task", () => {
    const adapter = createMockCreativeSpaceAdapter();
    const snapshot = adapter.getSnapshot();
    const project = adapter.createProject({
      name: "测试内容方向",
      linkedTaskId: snapshot.tasks[0].id,
      productId: snapshot.products[0].id,
      platforms: ["抖音"],
      contentGoal: "验证基础项目创建",
      leadId: snapshot.people[0].id,
      memberIds: [snapshot.people[1].id],
    });

    expect(project.linkedTask?.id).toBe(snapshot.tasks[0].id);
    expect(project.members.map((member) => member.id)).toEqual([
      snapshot.people[0].id,
      snapshot.people[1].id,
    ]);
    expect(adapter.getSnapshot().projects[0].id).toBe(project.id);
  });
});
