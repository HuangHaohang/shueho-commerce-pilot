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
          content: [{ type: "output_text", text: JSON.stringify({ title: "轻量通勤包小红书上新" }) }],
        },
      ],
      usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
    });
  };

  try {
    const client = new CommerceProviderClient({
      id: "test-provider",
      name: "Test Provider",
      baseUrl: "https://provider.example/v1",
      apiKeyEnvName: "TEST_API_KEY",
      apiKey: "secret",
      imageModel: "gpt-image-2",
      agentModelSelectors: ["gpt-5.6-sol"],
      modelCacheTtlMs: 60_000,
      webSearchTimeoutMs: 30_000,
      webSearchMaxAttempts: 1,
    });
    const generated = await client.generateThreadTitle({
      model: "gpt-5.3-codex-spark",
      userText: "给轻量通勤双肩包写一套上新文案",
      assistantText: "已完成小红书上新文案",
    });

    assert.equal(generated.title, "轻量通勤包小红书上新");
    assert.equal(generated.model, "gpt-5.3-codex-spark");
    const titleRequest = requests.find((request) => request.url.endsWith("/responses"));
    assert.ok(titleRequest);
    assert.equal((titleRequest.body as { model?: string }).model, "gpt-5.3-codex-spark");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
