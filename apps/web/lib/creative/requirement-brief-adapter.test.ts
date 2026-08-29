import { describe, expect, it } from "vitest";

import { createMockCreativeSpaceAdapter } from "./creative-space-adapter";
import { createMockRequirementBriefAdapter } from "./requirement-brief-adapter";

describe("requirement brief mock adapter", () => {
  it("keeps source facts separate while confirming a versioned brief", () => {
    const creative = createMockCreativeSpaceAdapter();
    const requirements = createMockRequirementBriefAdapter();
    const snapshot = creative.getSnapshot();
    const project = snapshot.projects[0];
    const initial = requirements.get(project);

    requirements.addSupplement({ project, text: "这批视频优先为直播引流，不要讲得太科普。" });
    requirements.updateDocuments({ project, documentIds: [snapshot.documents[0].id, "unknown"], documents: snapshot.documents });
    const confirmed = requirements.confirm(project);

    expect(confirmed.source.rawContent).toBe(initial.source.rawContent);
    expect(confirmed.brief?.version).toBe(1);
    expect(confirmed.brief?.documentIds).toEqual([snapshot.documents[0].id]);
    expect(confirmed.brief?.analysis.constraints.at(-1)?.source).toBe("人工补充");
    expect(confirmed.status).toBe("已确认");
  });

  it("marks an existing brief for reconfirmation after a human answer", () => {
    const creative = createMockCreativeSpaceAdapter();
    const requirements = createMockRequirementBriefAdapter();
    const project = creative.getSnapshot().projects[0];
    requirements.confirm(project);
    const updated = requirements.answerQuestion({ project, questionId: "priority", answer: "先解释结构，再展示效果。", status: "已补充" });

    expect(updated.status).toBe("已更新待重新确认");
    expect(updated.questions.find((question) => question.id === "priority")).toMatchObject({ status: "已补充", answer: "先解释结构，再展示效果。" });
  });
});
