import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { config } from "./config.js";
import { JustOneApiProxyPool, openProxyTunnel, type ProxyNode } from "./justoneapi-proxy-pool.js";
import { createTransportTestClient } from "./justoneapi-transport-test-support.js";
import { buildProviderTransportRequest } from "./transport-request.js";
import type { ProviderEndpoint } from "./types.js";

const endpoint: ProviderEndpoint = {
  endpointId: "test.endpoint", platformId: "test", platformName: "test", displayName: "test", capability: "test",
  apiPath: "/paid", httpMethod: "GET", schemaVersion: "v1", requestSchema: {}, responseSchema: {},
  requestCodec: { query: ["keyword"], form: [], path: [], header: [], bodyContentType: null },
  paginationStrategy: {}, responseFamily: "test", normalizerVersion: "1.0.0", catalogStatus: "active",
  pricingStatus: "priced", permissionStatus: "allowed", enabled: true, documentationUrl: null, openapiUrl: null,
};
const original = { baseUrl: config.justOneApi.baseUrl, token: config.justOneApi.token, timeoutMs: config.justOneApi.timeoutMs,
  maxResponseBytes: config.justOneApi.maxResponseBytes, proxy: { ...config.justOneApi.proxy } };
let certificate: Buffer;
let key: Buffer;
let fixtureDirectory: string;
const cleanup: Array<() => Promise<void>> = [];

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "justoneapi-proxy-tls-test-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", join(fixtureDirectory, "key.pem"), "-out", join(fixtureDirectory, "cert.pem"),
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
  [certificate, key] = await Promise.all([readFile(join(fixtureDirectory, "cert.pem")), readFile(join(fixtureDirectory, "key.pem"))]);
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  Object.assign(config.justOneApi, original, { proxy: { ...original.proxy } });
});
afterAll(async () => { await rm(fixtureDirectory, { recursive: true, force: true }); });

async function listen(server: Server): Promise<number> {
  const sockets = new Set<Duplex>();
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind");
  return address.port;
}

async function environment(handler?: (request: IncomingMessage, response: ServerResponse) => void) {
  const paid: Array<{ path: string; proxy: string | null; method: string }> = [];
  const upstreamPorts = new Map<number, string>();
  const origin = createHttpsServer({ key, cert: certificate }, (request, response) => {
    paid.push({ path: request.url!, proxy: upstreamPorts.get(request.socket.remotePort!) ?? null, method: request.method! });
    if (handler) handler(request, response);
    else { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"code":0,"data":{"items":[]}}'); }
  });
  const originPort = await listen(origin);
  const target = new URL(`https://localhost:${originPort}`);
  const connects: Array<{ node: string; target: string; headers: IncomingMessage["headers"] }> = [];
  const disabled = new Set<string>();
  const peers = new Set<Socket>();
  const nodes: ProxyNode[] = [];
  for (let id = 1; id <= 3; id += 1) {
    const nodeId = `node-${String(id).padStart(16, "0")}`;
    const proxy = createHttpServer((_request, response) => { response.writeHead(405); response.end(); });
    proxy.on("connect", (request, socket, head) => {
      connects.push({ node: nodeId, target: request.url!, headers: request.headers });
      if (disabled.has(nodeId)) { socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); return; }
      const upstream = connect(originPort, "127.0.0.1");
      peers.add(upstream);
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
      upstream.on("close", () => { peers.delete(upstream); socket.destroy(); });
      upstream.once("connect", () => {
        upstreamPorts.set(upstream.localPort!, nodeId);
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
    });
    nodes.push({ id: nodeId, proxyUrl: `http://127.0.0.1:${await listen(proxy)}` });
  }
  const pool = new JustOneApiProxyPool({ schemaVersion: 1, revision: "a".repeat(64), nodes }, target,
    { connectTimeoutMs: 500, healthIntervalMs: 10_000, cooldownMs: 1000, maxConnectAttempts: 3 },
    (node, url, timeout) => openProxyTunnel(node, url, timeout, certificate), Date.now, () => 0);
  cleanup.push(async () => { await pool.close(); for (const socket of peers) socket.destroy(); });
  config.justOneApi.baseUrl = target.origin;
  config.justOneApi.token = "private-test-provider-token";
  config.justOneApi.proxy.mode = "off";
  const client = createTransportTestClient(pool);
  return { client, pool, nodes, paid, connects, disabled, target };
}

describe("JustOneAPI HTTP/TLS proxy boundary", () => {
  it("probes without paid HTTP, rotates each actual request, and never sends the token to CONNECT", async () => {
    const fixture = await environment();
    await fixture.pool.refresh();
    expect(fixture.paid).toEqual([]);
    for (let index = 0; index < 6; index += 1) {
      const result = await fixture.client.call(endpoint, buildProviderTransportRequest(endpoint, { keyword: "通勤包" }));
      expect(result.state).toBe("succeeded");
      expect(result.rawBody).toBe('{"code":0,"data":{"items":[]}}');
    }
    expect(fixture.paid).toHaveLength(6);
    expect(new Set(fixture.paid.slice(0, 3).map((call) => call.proxy)).size).toBe(3);
    expect(new Set(fixture.paid.slice(3).map((call) => call.proxy)).size).toBe(3);
    expect(fixture.paid.every((call) => call.proxy && call.path.includes("token=private-test-provider-token"))).toBe(true);
    expect(JSON.stringify(fixture.connects)).not.toContain("private-test-provider-token");
    expect(fixture.connects.every((call) => call.target === fixture.target.host)).toBe(true);
  });

  it("switches a failed CONNECT before dispatch, sends a POST once, and leaves other HTTP requests direct", async () => {
    const fixture = await environment();
    await fixture.pool.refresh();
    fixture.disabled.add(fixture.nodes[1]!.id);
    const postEndpoint = { ...endpoint, httpMethod: "POST" as const, requestCodec: { query: [], form: ["keyword"], bodyContentType: "application/x-www-form-urlencoded" } };
    await fixture.client.call(postEndpoint, buildProviderTransportRequest(postEndpoint, { keyword: "hello" }));
    expect(fixture.paid).toHaveLength(1);
    expect(fixture.paid[0]).toMatchObject({ proxy: fixture.nodes[2]!.id, method: "POST" });
    const directServer = createHttpServer((_request, response) => response.end("direct-other-service"));
    const directPort = await listen(directServer);
    const previousConnects = fixture.connects.length;
    expect(await (await fetch(`http://127.0.0.1:${directPort}`)).text()).toBe("direct-other-service");
    expect(fixture.connects.length).toBe(previousConnects);
  });

  it("never sends a provider request when all proxies fail", async () => {
    const fixture = await environment();
    fixture.nodes.forEach((node) => fixture.disabled.add(node.id));
    await expect(fixture.client.call(endpoint, buildProviderTransportRequest(endpoint, {})))
      .rejects.toMatchObject({ code: "PROXY_UNAVAILABLE", uncertain: false });
    expect(fixture.paid).toHaveLength(0);
    expect(fixture.pool.status().healthyNodes).toBe(0);
  });

  it.each(["GET", "POST"] as const)("never replays an uncertain %s after the provider received it", async (httpMethod) => {
    const fixture = await environment((request) => request.socket.destroy());
    const requestEndpoint = { ...endpoint, httpMethod };
    await expect(fixture.client.call(requestEndpoint, buildProviderTransportRequest(requestEndpoint, {})))
      .rejects.toMatchObject({ code: "RESULT_UNKNOWN", uncertain: true });
    expect(fixture.paid).toHaveLength(1);
    expect(fixture.pool.status().healthyNodes).toBe(2);
  });

  it("keeps body truncation and total response timeout uncertain without sending again", async () => {
    const fixture = await environment((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "1000" });
      response.write('{"code":0');
    });
    await fixture.pool.refresh();
    config.justOneApi.timeoutMs = 100;
    await expect(fixture.client.call(endpoint, buildProviderTransportRequest(endpoint, {})))
      .rejects.toMatchObject({ code: "RESULT_UNKNOWN", uncertain: true });
    expect(fixture.paid).toHaveLength(1);
  });

  it("does not follow redirects and does not treat HTTP errors as a reason to replay", async () => {
    const fixture = await environment((_request, response) => {
      response.writeHead(302, { Location: "https://untrusted.invalid/collect", "Content-Type": "application/json" });
      response.end('{"code":1}');
    });
    const result = await fixture.client.call(endpoint, buildProviderTransportRequest(endpoint, {}));
    expect(result.state).toBe("business_failed");
    expect(result.httpStatus).toBe(302);
    expect(fixture.paid).toHaveLength(1);
    expect(fixture.pool.status().healthyNodes).toBe(3);
  });

  it("rejects untrusted target certificates before any paid HTTP bytes", async () => {
    const fixture = await environment();
    await expect(openProxyTunnel(fixture.nodes[0]!, fixture.target, 1000)).rejects.toThrow("provider request was not sent");
    await expect(openProxyTunnel(fixture.nodes[0]!, new URL("https://wrong-host.invalid"), 1000, certificate)).rejects.toThrow("provider request was not sent");
    expect(fixture.paid).toHaveLength(0);
  });

  it("bounds response bytes without quarantining a healthy proxy or replaying the call", async () => {
    const fixture = await environment((_request, response) => {
      response.writeHead(200, { "Content-Length": "1024" });
      response.end("x".repeat(1024));
    });
    config.justOneApi.maxResponseBytes = 100;
    await expect(fixture.client.call(endpoint, buildProviderTransportRequest(endpoint, {})))
      .rejects.toMatchObject({ code: "RESULT_TOO_LARGE", uncertain: true });
    expect(fixture.paid).toHaveLength(1);
    expect(fixture.pool.status().healthyNodes).toBe(3);
  });

  it("rejects origin escapes, header overrides and missing required manifests without direct fallback", async () => {
    const fixture = await environment();
    for (const path of ["//untrusted.invalid/paid", "https://untrusted.invalid/paid", "https://["]) {
      const escaped = { ...endpoint, apiPath: path };
      await expect(fixture.client.call(escaped, buildProviderTransportRequest(escaped, {})))
        .rejects.toMatchObject({ code: "INVALID_PARAMETER", uncertain: false });
    }
    await expect(fixture.client.call(endpoint, { ...buildProviderTransportRequest(endpoint, {}), headers: { Host: "untrusted.invalid" } }))
      .rejects.toMatchObject({ code: "INVALID_PARAMETER", uncertain: false });
    config.justOneApi.proxy.mode = "required";
    config.justOneApi.proxy.nodesFile = join(fixtureDirectory, "does-not-exist.json");
    await expect(createTransportTestClient().call(endpoint, buildProviderTransportRequest(endpoint, {})))
      .rejects.toMatchObject({ code: "PROXY_UNAVAILABLE", uncertain: false });
    expect(fixture.paid).toHaveLength(0);
  });
});
