import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureAppOwnedCodexConfig } from "../codex/runtime-config.js";
import type { GatewayConfig } from "../gateway/config.js";
import {
  RuntimeProviderProxy,
  createRuntimeProviderProxyIdentity,
  runtimeProviderActorAuthorizationHeader,
} from "./runtime-provider-proxy.js";

test("runtime provider proxy requires actor authorization and injects the upstream credential", async () => {
  const upstreamRequests: Array<{ body: string; headers: Record<string, string | string[] | undefined>; url: string }> = [];
  const upstream = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString("utf8");
    upstreamRequests.push({ body, headers: request.headers, url: request.url ?? "" });
    response.writeHead(200, {
      "content-type": "application/json",
      "x-codex-imagegen-request-id": "image-request-1",
    });
    response.end(JSON.stringify({ ok: true }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== "string");

  const config = createConfig(`http://127.0.0.1:${upstreamAddress.port}/v1`);
  const proxy = new RuntimeProviderProxy(config);
  const gateway = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!proxy.matches(url.pathname)) {
      response.writeHead(404).end();
      return;
    }
    await proxy.handle(request, response, url);
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const gatewayAddress = gateway.address();
  assert.ok(gatewayAddress && typeof gatewayAddress !== "string");

  try {
    const baseUrl = `http://127.0.0.1:${gatewayAddress.port}/api/internal/provider/v1`;
    const denied = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol" }),
    });
    assert.equal(denied.status, 401);
    assert.equal(upstreamRequests.length, 0);

    const allowed = await fetch(`${baseUrl}/responses?trace=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [runtimeProviderActorAuthorizationHeader]: proxy.identity.actorAuthorization,
      },
      body: JSON.stringify({ model: "gpt-5.6-sol" }),
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("x-codex-imagegen-request-id"), "image-request-1");
    assert.deepEqual(await allowed.json(), { ok: true });
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0]?.url, "/v1/responses?trace=1");
    assert.equal(upstreamRequests[0]?.headers.authorization, "Bearer upstream-provider-key");
    assert.equal(upstreamRequests[0]?.headers[runtimeProviderActorAuthorizationHeader], undefined);
    assert.equal(upstreamRequests[0]?.body, JSON.stringify({ model: "gpt-5.6-sol" }));

    const unsupported = await fetch(`${baseUrl}/files`, {
      headers: { [runtimeProviderActorAuthorizationHeader]: proxy.identity.actorAuthorization },
    });
    assert.equal(unsupported.status, 404);
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => gateway.close(() => resolve())),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
    ]);
  }
});

test("runtime provider identity is stable for one configured gateway and scoped to its provider", () => {
  const config = createConfig("https://provider.example/v1");
  assert.deepEqual(createRuntimeProviderProxyIdentity(config), createRuntimeProviderProxyIdentity(config));
  assert.notEqual(
    createRuntimeProviderProxyIdentity(config).actorAuthorization,
    createRuntimeProviderProxyIdentity({
      ...config,
      provider: { ...config.provider, id: "other-provider" },
    }).actorAuthorization,
  );
});

test("generated Codex config uses the actor-authorized relay and disables uncertain stream replays", async () => {
  const directory = await mkdtemp(join(tmpdir(), "commerce-provider-config-"));
  const config = {
    ...createConfig("https://provider.example/v1"),
    codexHome: directory,
    runtimeRoot: join(directory, "runtime"),
  };
  try {
    const path = await ensureAppOwnedCodexConfig(config);
    const content = await readFile(path, "utf8");
    const identity = createRuntimeProviderProxyIdentity(config);
    assert.match(content, new RegExp(`base_url = ${escapeRegExp(JSON.stringify(identity.baseUrl))}`));
    assert.ok(content.includes(`"${runtimeProviderActorAuthorizationHeader}" = ${JSON.stringify(identity.actorAuthorization)}`));
    assert.match(content, /^request_max_retries = 0$/m);
    assert.match(content, /^stream_max_retries = 0$/m);
    assert.match(content, /^stream_idle_timeout_ms = 120000$/m);
    assert.doesNotMatch(content, /^request_max_retries = [1-9][0-9]*$/m);
    assert.doesNotMatch(content, /^stream_max_retries = [1-9][0-9]*$/m);
    assert.ok(!content.includes(`env_key = ${JSON.stringify(config.provider.apiKeyEnvName)}`));
    assert.ok(!content.includes(config.provider.apiKey ?? "upstream-provider-key"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function createConfig(providerBaseUrl: string): GatewayConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    codexBin: "/tmp/codex",
    codexHome: "/tmp/codex-home",
    runtimeRoot: "/tmp/codex-home/runtime",
    internalToken: "gateway-internal-token-with-more-than-32-characters",
    maxTurnDurationMs: 600_000,
    autoCompactThresholdPercent: 75,
    compactionTimeoutMs: 180_000,
    authorizationPollMs: 10_000,
    maxAgentThreadsPerSession: 4,
    provider: {
      id: "provider",
      name: "Provider",
      baseUrl: providerBaseUrl,
      apiKeyEnvName: "COMMERCE_PROVIDER_API_KEY",
      apiKey: "upstream-provider-key",
      imageModel: "gpt-image-2",
      webSearchModel: "gpt-5.6-luna",
      agentModelSelectors: ["gpt-5.6-sol"],
      modelCacheTtlMs: 60_000,
      webSearchTimeoutMs: 30_000,
      webSearchMaxAttempts: 1,
    },
    titleModel: "gpt-5.3-codex-spark",
    externalDataService: {
      url: "http://127.0.0.1:8791/mcp",
      timeoutMs: 300_000,
      maxResultBytes: 1_048_576,
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
