import { PassThrough } from "node:stream";
import type { TLSSocket } from "node:tls";
import { describe, expect, it } from "vitest";

import { JustOneApiProxyPool, parseProxyManifest, type ProxyConnector, type ProxyManifest } from "./justoneapi-proxy-pool.js";

const manifest: ProxyManifest = {
  schemaVersion: 1, revision: "a".repeat(64),
  nodes: [1, 2, 3].map((id) => ({ id: `node-${String(id).padStart(16, "0")}`, proxyUrl: `http://127.0.0.1:${19000 + id}` })),
};
const options = { connectTimeoutMs: 100, healthIntervalMs: 1000, cooldownMs: 100, maxConnectAttempts: 3 };
const socket = () => new PassThrough() as unknown as TLSSocket;

describe("JustOneAPI request proxy pool", () => {
  it("shuffles every complete round, avoids adjacent repeats, and claims nodes safely under concurrency", async () => {
    const pool = new JustOneApiProxyPool(manifest, new URL("https://api.justoneapi.com"), options,
      async () => socket(), () => 1000, () => 0);
    await pool.refresh();
    const leases = await Promise.all(Array.from({ length: 9 }, () => pool.acquire()));
    const ids = leases.map((lease) => lease.nodeId);
    for (let offset = 0; offset < ids.length; offset += 3) expect(new Set(ids.slice(offset, offset + 3)).size).toBe(3);
    expect(ids.every((id, index) => index === 0 || id !== ids[index - 1])).toBe(true);
    leases.forEach((lease) => lease.socket.destroy());
    await pool.close();
  });

  it("quarantines failed connections, safely selects another node, then restores recovered nodes after cooldown", async () => {
    let now = 1000;
    const blocked = new Set<string>();
    const connections: string[] = [];
    const connect: ProxyConnector = async (node) => {
      connections.push(node.id);
      if (blocked.has(node.id)) throw new Error("private failure details");
      return socket();
    };
    const pool = new JustOneApiProxyPool(manifest, new URL("https://api.justoneapi.com"), options, connect, () => now, () => 0);
    await pool.refresh();
    blocked.add(manifest.nodes[1]!.id);
    connections.length = 0;
    const lease = await pool.acquire();
    expect(connections).toEqual([manifest.nodes[1]!.id, manifest.nodes[2]!.id]);
    expect(pool.status().healthyNodes).toBe(2);
    lease.socket.destroy();
    blocked.clear();
    await pool.refresh();
    expect(pool.status().healthyNodes).toBe(2);
    now += 101;
    await pool.refresh();
    expect(pool.status().healthyNodes).toBe(3);
    await pool.close();
  });

  it("fails closed when no nodes are healthy, bounds connection attempts, and never includes private errors", async () => {
    let failed = false;
    let attempts = 0;
    const pool = new JustOneApiProxyPool(manifest, new URL("https://api.justoneapi.com"),
      { ...options, maxConnectAttempts: 2 }, async () => {
        attempts += 1;
        if (failed) throw new Error("https://subscription.invalid/?token=private");
        return socket();
      });
    await pool.refresh();
    failed = true;
    attempts = 0;
    await expect(pool.acquire()).rejects.toThrow("provider request was not sent");
    expect(attempts).toBe(2);
    await expect(pool.acquire()).rejects.not.toThrow("private");
    expect(pool.status().healthyNodes).toBe(0);
    await pool.close();
    await expect(pool.acquire()).rejects.toThrow("provider request was not sent");
  });

  it("does not let an older successful health probe resurrect a newly failed node", async () => {
    let release: (() => void) | undefined;
    let delayed = false;
    const pool = new JustOneApiProxyPool({ ...manifest, nodes: [manifest.nodes[0]!] },
      new URL("https://api.justoneapi.com"), options, async () => {
        if (delayed) await new Promise<void>((resolve) => { release = resolve; });
        return socket();
      });
    await pool.refresh();
    const lease = await pool.acquire();
    delayed = true;
    const refreshing = pool.refresh();
    lease.failed();
    release!();
    await refreshing;
    expect(pool.status().healthyNodes).toBe(0);
    lease.socket.destroy();
    await pool.close();
  });

  it("rejects credentials, duplicate listeners and redirect-like proxy URLs in a manifest", () => {
    for (const proxyUrl of ["http://user:secret@localhost:19000", "http://localhost:19000/?token=secret", "https://localhost:19000", "http://localhost:19000/route"]) {
      expect(() => parseProxyManifest({ ...manifest, nodes: [{ ...manifest.nodes[0], proxyUrl }] })).toThrow("Invalid JustOneAPI proxy manifest");
    }
    expect(() => parseProxyManifest({ ...manifest, nodes: [manifest.nodes[0], manifest.nodes[0]] })).toThrow();
  });

  it("does not hand a paid caller a tunnel after its connection budget expires", async () => {
    let now = 1000;
    const timeouts: number[] = [];
    const pool = new JustOneApiProxyPool({ ...manifest, nodes: [manifest.nodes[0]!] },
      new URL("https://api.justoneapi.com"), options, async (_node, _target, timeout) => {
        timeouts.push(timeout);
        now += 20;
        return socket();
      }, () => now);
    await pool.refresh();
    await expect(pool.acquire(now + 5)).rejects.toThrow("provider request was not sent");
    expect(timeouts.at(-1)).toBe(5);
    await pool.close();
  });
});
