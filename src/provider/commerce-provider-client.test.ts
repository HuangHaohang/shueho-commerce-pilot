import assert from "node:assert/strict";
import test from "node:test";

import { CommerceProviderClient, CommerceProviderError } from "./commerce-provider-client.js";
import type { CommerceProviderConfig } from "../gateway/config.js";

test("generates structured outcome titles with the configured Spark model", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/models")) {
      return Response.json({
        data: [
          { id: "gpt-image-2", owned_by: "provider" },
          { id: "gpt-5.3-codex-spark", owned_by: "provider" },
        ],
      });
    }
    return Response.json({
      id: "resp-title-1",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ title: "轻量通勤包小红书上新", category: "creative" }),
            },
          ],
        },
      ],
      usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
    });
  };

  try {
    let harnessModel="";
    const client = new CommerceProviderClient({
      id: "test-provider",
      name: "Test Provider",
      baseUrl: "https://provider.example/v1",
      apiKeyEnvName: "TEST_API_KEY",
      apiKey: "secret",
      imageModel: "gpt-image-2",
      imageQuality: "auto",
      webSearchModel: "gpt-5.6-luna",
      agentModelSelectors: ["gpt-5.6-sol"],
      modelCacheTtlMs: 60_000,
      webSearchTimeoutMs: 30_000,
      webSearchMaxAttempts: 1,
    },async input=>{harnessModel=input.model;return {text:JSON.stringify({title:"轻量通勤包小红书上新",category:"creative"}),turnId:"turn-title",usage:null,sources:[]};});
    const generated = await client.generateThreadTitle({
      model: "gpt-5.3-codex-spark",
      userText: "给轻量通勤双肩包写一套上新文案",
      assistantText: "已完成小红书上新文案",
    });

    assert.equal(generated.title, "轻量通勤包小红书上新");
    assert.equal(generated.category, "creative");
    assert.equal(generated.model, "gpt-5.3-codex-spark");
    const titleRequest = requests.find((request) => request.url.endsWith("/responses"));
    assert.equal(titleRequest,undefined);
    assert.equal(harnessModel,"gpt-5.3-codex-spark");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { DEFAULT_AGENT_MODEL_SELECTORS } from "../gateway/config.js";

test("agent selection exposes only Luna from 5.6 and verifies new models against upstream", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [
    "gpt-image-2", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gemini-3.8-flash-high", "unconfigured-model",
  ].map((id) => ({ id })) });
  try {
    const client = new CommerceProviderClient({
      id: "fixture", name: "Fixture", baseUrl: "https://provider.example/v1", apiKeyEnvName: "TEST_API_KEY", apiKey: "fixture",
      imageModel: "gpt-image-2", imageQuality: "auto", webSearchModel: "gpt-5.6-luna", agentModelSelectors: [...DEFAULT_AGENT_MODEL_SELECTORS],
      modelCacheTtlMs: 60_000, webSearchTimeoutMs: 30_000, webSearchMaxAttempts: 1,
    });
    assert.deepEqual((await client.listModels()).agentModels.map((model) => model.id), ["gpt-5.6-luna", "gpt-6-astra", "gemini-3.8-flash-high"]);
    await client.assertAgentModel("gpt-6-astra");
    await client.assertAgentModel("gemini-3.8-flash-high");
    await assert.rejects(client.assertAgentModel("gpt-5.6-sol"));
    await assert.rejects(client.assertAgentModel("gpt-5.6-terra"));
    globalThis.fetch = async () => Response.json({ data: [{ id: "gpt-image-2" }, { id: "gpt-5.6-luna" }] });
    assert.deepEqual((await client.listModels(true)).agentModels.map((model) => model.id), ["gpt-5.6-luna"]);
    await assert.rejects(client.assertAgentModel("gpt-6-astra"));
  } finally { globalThis.fetch = originalFetch; }
});

const discoveryConfig: CommerceProviderConfig = {
  id: "fixture", name: "Fixture", baseUrl: "https://provider.example/v1",
  apiKeyEnvName: "TEST_API_KEY", apiKey: "fixture",
  imageModel: "gpt-image-2", imageQuality: "auto", webSearchModel: "gpt-5.6-luna",
  agentModelSelectors: ["gpt-5.6-luna"], modelCacheTtlMs: 60_000,
  webSearchTimeoutMs: 30_000, webSearchMaxAttempts: 1,
};
const discoveryPayload = { data: [{ id: "gpt-image-2" }, { id: "gpt-5.6-luna" }] };

test("100 concurrent model reads and forced refreshes share one discovery request", async (t) => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    await gate;
    return Response.json(discoveryPayload);
  });
  const client = new CommerceProviderClient(discoveryConfig);
  const reads = Array.from({ length: 100 }, (_, index) => client.listModels(index % 2 === 0));
  assert.equal(calls, 1);
  release();
  const catalogs = await Promise.all(reads);
  assert.equal(catalogs.length, 100);
  assert.ok(catalogs.every((catalog) => catalog.agentModels[0]?.id === "gpt-5.6-luna"));
  await client.assertAgentModel("gpt-5.6-luna");
  assert.equal(calls, 1);
});

test("revoked provider credentials invalidate cached discovery without retry or stale success", async (t) => {
  let calls = 0;
  let rejected = false;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return rejected
      ? Response.json({ error: "sensitive upstream diagnostic" }, { status: 401 })
      : Response.json(discoveryPayload);
  });
  const client = new CommerceProviderClient(discoveryConfig);
  await client.listModels();
  rejected = true;
  await assert.rejects(client.listModels(true), (error: unknown) => {
    assert.ok(error instanceof CommerceProviderError);
    assert.equal(error.upstreamStatus, 401);
    assert.doesNotMatch(error.message, /sensitive/);
    return true;
  });
  assert.equal(calls, 2);
  await assert.rejects(client.listModels(), /HTTP 401/);
  assert.equal(calls, 3);
  rejected = false;
  assert.equal((await client.listModels()).agentModels.length, 1);
  assert.equal(calls, 4, "a failed in-flight request must not poison future reads");
});

test("shared transient refresh preserves strict refresh semantics for each caller", async (t) => {
  let failing = false;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return failing ? new Response(null, { status: 503 }) : Response.json(discoveryPayload);
  });
  const client = new CommerceProviderClient({ ...discoveryConfig, modelCacheTtlMs: -1 });
  const original = await client.listModels();
  failing = true;
  const [strict, tolerant] = await Promise.allSettled([client.listModels(true), client.listModels()]);
  assert.equal(strict.status, "rejected");
  assert.equal(tolerant.status, "fulfilled");
  if (tolerant.status === "fulfilled") assert.equal(tolerant.value.fetchedAt, original.fetchedAt);
  assert.equal(calls, 3, "one initial fetch and one shared read-only retry sequence");
});

test("oversized catalogs without Content-Length are bounded before JSON parsing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)));
  const client = new CommerceProviderClient(discoveryConfig);
  await assert.rejects(client.listModels(), /catalog is too large/);
});

test("an upstream 500 can use a bounded last-known catalog for ordinary reads", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? Response.json(discoveryPayload) : new Response(null, { status: 500 }));
  const client = new CommerceProviderClient({ ...discoveryConfig, modelCacheTtlMs: -1 });
  const previous = await client.listModels();
  assert.equal(await client.listModels(), previous);
  assert.equal(calls, 3);
});

test("a definitive catalog change cannot publish half-validated models or reuse a removed image capability", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(calls === 1 ? discoveryPayload : { data: [{ id: "new-utility-model" }] });
  });
  const client = new CommerceProviderClient(discoveryConfig);
  await client.listModels();
  await assert.rejects(client.listModels(true), /Configured image model/);
  await assert.rejects(client.assertModelAvailable("new-utility-model"), /Configured image model/);
  assert.equal(calls, 3, "invalid catalogs are not retried or published as stale capabilities");
});

test("catalog deadline includes a body that stalls after successful headers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    calls++;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal!.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
      },
    }));
  });
  const client = new CommerceProviderClient(discoveryConfig);
  const result = client.listModels().then(() => null, (error: unknown) => error);
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(15_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(300);
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(15_000);
  const error = await result;
  assert.ok(error instanceof CommerceProviderError);
  assert.equal(error.statusCode, 504);
  assert.equal(calls, 2);
});
