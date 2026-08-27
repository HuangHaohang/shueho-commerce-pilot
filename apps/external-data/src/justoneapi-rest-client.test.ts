import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { config } from "./config.js";
import { JustOneApiRestClient } from "./justoneapi-rest-client.js";
import { buildProviderTransportRequest } from "./transport-request.js";
import type { ProviderEndpoint } from "./types.js";

const endpoint: ProviderEndpoint = {
  endpointId: "search.search_v1",
  platformId: "social",
  platformName: "跨平台搜索",
  displayName: "test",
  capability: "test",
  apiPath: "/test",
  httpMethod: "GET",
  schemaVersion: "v1",
  requestSchema: {},
  responseSchema: {},
  requestCodec: { query: ["keyword"], form: [], path: [], header: [], bodyContentType: null },
  paginationStrategy: {},
  responseFamily: "social_search_v1",
  normalizerVersion: "1.0.0",
  catalogStatus: "active",
  pricingStatus: "priced",
  permissionStatus: "allowed",
  enabled: true,
  documentationUrl: null,
  openapiUrl: null,
};

const originalBaseUrl = config.justOneApi.baseUrl;
const originalToken = config.justOneApi.token;

afterEach(() => {
  config.justOneApi.baseUrl = originalBaseUrl;
  config.justOneApi.token = originalToken;
});

describe("JustOneApiRestClient", () => {
  it("returns exact bytes for non-JSON HTTP responses instead of discarding them", async () => {
    const body = Buffer.from([0x66, 0x61, 0x69, 0x6c, 0xff]);
    const server = createServer((_request, response) => {
      response.writeHead(502, { "Content-Type": "application/octet-stream" });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind");
      config.justOneApi.baseUrl = `http://127.0.0.1:${address.port}`;
      config.justOneApi.token = "test-token";
      const result = await new JustOneApiRestClient().call(endpoint, buildProviderTransportRequest(endpoint, { keyword: "蘑菇勺" }));
      expect(result.state).toBe("business_failed");
      expect(result.payload).toBeNull();
      expect(Buffer.from(result.rawBytes)).toEqual(body);
      expect(result.responseBytes).toBe(body.byteLength);
      expect(result.providerMessage).toContain("non-JSON");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("dispatches form POST endpoints with the provider token only in the URL", async () => {
    let captured: { method?: string; url?: string; contentType?: string; body?: string } = {};
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString("utf8");
      captured = {
        method: request.method,
        url: request.url,
        contentType: request.headers["content-type"],
        body,
      };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: 0, message: "", data: { items: [] } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind");
      config.justOneApi.baseUrl = `http://127.0.0.1:${address.port}`;
      config.justOneApi.token = "test-token";
      const postEndpoint: ProviderEndpoint = {
        ...endpoint,
        endpointId: "weixin.search_article_v2",
        apiPath: "/post",
        httpMethod: "POST",
        requestCodec: {
          query: [], form: ["keyword", "currentPage"], path: [], header: [],
          bodyContentType: "application/x-www-form-urlencoded",
        },
      };
      const request = buildProviderTransportRequest(postEndpoint, { keyword: "通勤包", currentPage: 1 });
      const result = await new JustOneApiRestClient().call(postEndpoint, request);
      expect(result.state).toBe("succeeded");
      expect(captured).toMatchObject({
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: "currentPage=1&keyword=%E9%80%9A%E5%8B%A4%E5%8C%85",
      });
      expect(captured.url).toBe("/post?token=test-token");
      expect(captured.body).not.toContain("token");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
