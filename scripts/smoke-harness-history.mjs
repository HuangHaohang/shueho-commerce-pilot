// Offline acceptance: real application-owned Harness, loopback fixture Provider,
// disposable CODEX_HOME, no production credentials or conversations.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CodexAppServerClient } from "../dist/src/codex/app-server-client.js";
import { validateRuntimeArtifact } from "./codex-runtime/common.mjs";

const binary = resolve(process.env.CODEX_BIN || `.runtime/bin/${process.platform}-${process.arch}/codex`);
await validateRuntimeArtifact(binary);
const root = await mkdtemp(join(tmpdir(), "commerce-harness-history-"));
const workspace = join(root, "workspaces", "fixture");
const skillPath = join(workspace, ".agents", "skills", "history-fixture", "SKILL.md");
await mkdir(join(workspace, ".agents", "skills", "history-fixture"), { recursive: true });
await writeFile(skillPath, "---\nname: history-fixture\ndescription: Offline native Skill history test.\n---\nReply with OK. Do not call tools.\n");
let providerCalls = 0;
const server = createServer(async (request, response) => {
  for await (const _chunk of request) { /* Consume without recording prompts. */ }
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    response.writeHead(404).end(); return;
  }
  providerCalls++;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const item = { id: `message-${providerCalls}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] };
  for (const event of [
    { type: "response.created", response: { id: `response-${providerCalls}` } },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: `response-${providerCalls}`, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } } },
  ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  response.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await writeFile(join(root, "config.toml"), `model = "gpt-5.6-sol"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[model_providers.fixture]\nname = "Offline fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
let client;
const completed = new Set();
async function start() {
  client = new CodexAppServerClient({ codexBin: binary, cwd: workspace, env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: root }, requestTimeoutMs: 30_000 });
  client.on("event", event => {
    if (event.type === "notification" && event.method === "turn/completed") completed.add(event.params?.turn?.id);
  });
  await client.start();
}
async function runTurn(threadId) {
  const { turn } = await client.request("turn/start", { threadId, input: [{ type: "text", text: "Use the selected Skill.", text_elements: [] }, { type: "skill", name: "history-fixture", path: skillPath }] });
  const deadline = Date.now() + 30_000;
  while (!completed.has(turn.id) && Date.now() < deadline) await delay(25);
  assert.ok(completed.has(turn.id), "native turn/completed missing");
}
async function verify(threadId, count) {
  const page = await client.request("thread/turns/list", { threadId, limit: 10, itemsView: "full" });
  assert.equal(page.data.length, count);
  for (const turn of page.data) {
    assert.equal(turn.status, "completed");
    const messages = turn.items.filter(item => item.type === "userMessage");
    assert.equal(messages.length, 1, "native replay duplicated a user message");
    assert.equal(messages[0].content.filter(input => input.type === "skill" && input.name === "history-fixture").length, 1);
  }
}
try {
  await start();
  for (const historyMode of ["legacy", "paginated"]) {
    const { thread } = await client.request("thread/start", { cwd: workspace, historyMode, ephemeral: false });
    await runTurn(thread.id);
    await verify(thread.id, 1);
    await client.stop(); await start();
    await verify(thread.id, 1);
    await client.request("thread/resume", { threadId: thread.id });
    await runTurn(thread.id);
    await verify(thread.id, 2);
    console.log(JSON.stringify({ historyMode, restart: "passed", resume: "passed", skillSelections: "preserved", duplicateMessages: 0 }));
  }
  assert.equal(providerCalls, 4, "unexpected duplicate Provider dispatch");
} finally {
  await client?.stop();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
