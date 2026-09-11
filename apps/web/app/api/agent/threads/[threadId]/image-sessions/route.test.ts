import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), context: vi.fn(), record: vi.fn(), register: vi.fn(), sessions: vi.fn(), sources: vi.fn(), resolver: vi.fn(), limit: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/agent/http", () => ({ requireAgentThreadContext: m.access, requireAgentContext: m.context, gatewayUrl: (p: string) => `http://gateway.test${p}`, gatewayHeaders: () => ({}) }));
vi.mock("@/lib/agent/thread-ownership", () => ({ getAgentThreadForUser: m.record, registerAgentThreadOwner: m.register }));
vi.mock("@/lib/creative/image-session-repository", () => ({ listImageSessions: m.sessions, resolveImageSources: m.sources, createImageAssetResolver: m.resolver }));
vi.mock("@/lib/enterprise/database-context", () => ({ withEnterpriseDatabaseContext: async (_: unknown, run: (client: unknown) => Promise<unknown>) => run({ query: m.query }) }));
vi.mock("@/lib/enterprise/rate-limit", () => ({ enforceEnterpriseRateLimit: m.limit }));
import { POST } from "./route";
const project = "project-test123", editor = "editor-test123", filename = "1789000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png";
const call = () => POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ filename, model: "model" }) }), { params: Promise.resolve({ threadId: project }) });
beforeEach(() => {
  vi.clearAllMocks(); m.access.mockResolvedValue({ ok: true, context: {} }); m.context.mockResolvedValue({ ok: true, context: {} });
  m.sessions.mockResolvedValue([{ threadId: editor, projectThreadId: project, sourceFilename: filename }]); m.resolver.mockResolvedValue(async () => filename); m.limit.mockResolvedValue(null);
  m.record.mockImplementation(async (id) => ({ threadId: id, recipeId: "creative_project", turnStartedAt: id === editor ? null : "date" }));
  m.query.mockImplementation(async (sql: string) => ({ rows: [], rowCount: sql.includes("FOR UPDATE") || sql.includes("FOR KEY SHARE") ? 1 : 0 }));
});
afterEach(() => vi.unstubAllGlobals());
it("reuses an existing durable editor without spending creation quota or probing Harness", async () => {
  m.record.mockResolvedValue({ threadId: editor, recipeId: "creative_project", turnStartedAt: "date" });
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect((await call()).status).toBe(200); expect(m.limit).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
it("does not replace an empty editor on an uncertain upstream failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "timeout" }), { status: 503 })));
  expect((await call()).status).toBe(409); expect(m.register).not.toHaveBeenCalled(); expect(m.query).not.toHaveBeenCalled();
});
it("does not remove a missing editor with any recorded turn reservation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
  m.query.mockImplementation(async (sql: string) => ({ rows: [], rowCount: sql.includes("FOR UPDATE") || sql.includes("commerce_agent_turn_lease") ? 1 : 0 }));
  expect((await call()).status).toBe(409); expect(m.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false); expect(m.register).not.toHaveBeenCalled();
});
it("replaces only a confirmed lost empty binding through native thread creation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ result: { thread: { id: "new-editor123" } } }))));
  const result = await call(); expect(result.status).toBe(200); expect((await result.json()).session.replacedEmptyThreadId).toBe(editor);
  expect(m.register).toHaveBeenCalledWith("new-editor123", expect.anything(), "图片编辑", "creative_project", "creative", expect.objectContaining({ query: m.query }));
});
