import { describe, expect, it } from "vitest";

import { createMockCreativeSpaceAdapter } from "./creative-space-adapter";
import { filterMyCreativeDashboard, getMockMyCreativeDashboard } from "./my-creative-adapter";

describe("my creative dashboard adapter", () => {
  it("maps task facts onto existing content projects", () => {
    const projects = createMockCreativeSpaceAdapter().getSnapshot().projects;
    const dashboard = getMockMyCreativeDashboard(projects);

    expect(dashboard.focuses[0].projectName).toBe(projects[0].name);
    expect(dashboard.focuses[0].sourceTask).toBe(projects[0].linkedTask?.name);
    expect(dashboard.summaries.map((summary) => summary.id)).toEqual(["active", "pending", "output"]);
    expect(dashboard.focuses[0].platforms).toEqual(projects[0].platforms);
    expect(dashboard.actions.every((action) => projects.some((project) => project.id === action.projectId))).toBe(true);
  });

  it("keeps role ordering and stage filtering outside the page component", () => {
    const projects = createMockCreativeSpaceAdapter().getSnapshot().projects;
    const editorDashboard = getMockMyCreativeDashboard(projects, "剪辑");
    const filtered = filterMyCreativeDashboard(editorDashboard, {
      range: "week",
      role: "全部",
      stage: "剪辑",
      query: "",
    });

    expect(editorDashboard.actions[0].stage).toBe("剪辑");
    expect(filtered.actions.length).toBeGreaterThan(0);
    expect(filtered.actions.every((action) => action.stage === "剪辑")).toBe(true);
  });

  it("applies time, role, and search filters consistently", () => {
    const projects = createMockCreativeSpaceAdapter().getSnapshot().projects;
    const dashboard = getMockMyCreativeDashboard(projects);
    const filtered = filterMyCreativeDashboard(dashboard, {
      range: "today",
      role: "策划",
      stage: null,
      query: "喷油壶",
    });

    expect(filtered.focuses).toHaveLength(1);
    expect(filtered.actions).toHaveLength(1);
    expect(filtered.recent.every((item) => item.role === "策划")).toBe(true);
  });
});
