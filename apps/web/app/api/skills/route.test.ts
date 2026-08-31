import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAgentContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({
  gatewayHeaders: () => ({}),
  gatewayUrl: (path: string) => `http://gateway.test${path}`,
  requireAgentContext: mocks.requireAgentContext,
}));

import { sanitizeSkillInventoryPayload } from "@/lib/agent/browser-skill-inventory";

import { GET } from "./route";

describe("browser Skill inventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentContext.mockResolvedValue({
      ok: true,
      context: { tenantId: "tenant-1", workspaceId: "workspace-1", userId: "user-1" },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("filters internal workflow and specialist Skills again at the BFF", () => {
    expect(sanitizeSkillInventoryPayload({
      skills: [
        { name: "commerce-creative-project" },
        { name: "commerce-product-main-image" },
        { name: "skill-creator" },
        { name: "commerce-custom-review" },
      ],
      errors: [],
    })).toEqual({
      skills: [
        { name: "skill-creator" },
        { name: "commerce-custom-review" },
      ],
      errors: [],
    });
  });

  it("never returns internal Skills when the Gateway payload regresses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      skills: [
        { name: "commerce-short-video-storyboard", displayName: "内部视频分镜" },
        { name: "skill-creator", displayName: "创建技能" },
      ],
      errors: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const response = await GET(new Request("http://localhost/api/skills"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      skills: [{ name: "skill-creator", displayName: "创建技能" }],
      errors: [],
    });
  });
});
