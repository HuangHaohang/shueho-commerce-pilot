import assert from "node:assert/strict";
import test from "node:test";

import { CommerceProviderClient } from "./commerce-provider-client.js";

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
      imageModel: "gpt-image-2", webSearchModel: "gpt-5.6-luna", agentModelSelectors: [...DEFAULT_AGENT_MODEL_SELECTORS],
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
