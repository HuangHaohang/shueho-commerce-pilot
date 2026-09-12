import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { compileProxySubscription, verifyExistingProxyRevision, writeProxyBundle } from "./justoneapi-proxy-subscription.js";

const node = { name: "香港", type: "hysteria2", server: "proxy.example.com", port: 443, password: "subscription-private", sni: "proxy.example.com" };
const options = { proxyHost: "127.0.0.1", listen: "127.0.0.1" as const, firstPort: 19000 };

describe("protected proxy subscription import", () => {
  it("imports dedicated fixed-node listeners, excludes notices and duplicates, and ignores subscription policies", () => {
    const source = stringify({
      proxies: [{ name: "跳转域名{请勿连接}", type: "ss" }, node, { ...node, name: "重复节点" }],
      "external-controller": "0.0.0.0:9090", tun: { enable: true }, rules: ["MATCH,DIRECT"],
      listeners: [{ name: "unmanaged", port: 9000 }],
    });
    const bundle = compileProxySubscription(source, options);
    const config = parse(bundle.mihomoYaml);
    expect(bundle.receipt).toMatchObject({ imported: 1, excludedNotices: 1, duplicates: 1 });
    expect(config.listeners).toEqual([{ name: `in-${bundle.manifest.nodes[0]!.id}`, type: "http", listen: "127.0.0.1", port: 19000, proxy: bundle.manifest.nodes[0]!.id }]);
    expect(config.rules).toEqual(["MATCH,REJECT"]);
    expect(config).not.toHaveProperty("external-controller");
    expect(config).not.toHaveProperty("tun");
    expect(config["log-level"]).toBe("silent");
    expect(JSON.stringify(bundle.receipt)).not.toContain("subscription-private");
    expect(JSON.stringify(bundle.manifest)).not.toContain("proxy.example.com");
  });

  it("excludes unreviewed filesystem/routing fields, direct nodes, and disabled TLS verification", () => {
    const bundle = compileProxySubscription(stringify({ proxies: [node,
      { ...node, name: "unsafe", "skip-cert-verify": true },
      { ...node, name: "file", certificate: "/etc/passwd" },
      { ...node, name: "route", "dialer-proxy": "DIRECT" },
      { ...node, name: "direct", type: "direct" },
      { ...node, name: "script", "plugin-opts": { command: "echo unsafe" } },
    ] }), options);
    expect(bundle.receipt).toMatchObject({ imported: 1, excludedUnsupported: 5 });
    expect(() => compileProxySubscription("proxies: []", options)).toThrow("no supported secure nodes");
  });

  it("bounds YAML parsing and rejects duplicate keys without leaking input", () => {
    expect(() => compileProxySubscription("proxies: []\nproxies: [private]", options)).toThrow("bounded Clash YAML");
    expect(() => compileProxySubscription("x".repeat(2_097_153), options)).toThrow("size");
    expect(() => compileProxySubscription(stringify({ proxies: [node] }), { ...options, proxyHost: "user:password@host" })).toThrow("listener options");
  });

  it("writes immutable 0600 revisions, replays identical imports, and detects tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "proxy-subscription-test-"));
    try {
      const bundle = compileProxySubscription(stringify({ proxies: [node] }), options);
      const directory = await writeProxyBundle(root, bundle);
      expect(await writeProxyBundle(root, bundle)).toBe(directory);
      const renamed = compileProxySubscription(stringify({ proxies: [{ ...node, name: "订阅更新后的显示名称" }] }), options);
      expect(renamed.mihomoYaml).toBe(bundle.mihomoYaml);
      expect(await writeProxyBundle(root, renamed)).not.toBe(directory);
      expect(JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")).sourceSha256).toBe(bundle.receipt.sourceSha256);
      if (process.platform !== "win32") expect((await stat(join(directory, "mihomo.yaml"))).mode & 0o777).toBe(0o600);
      expect(await readFile(join(directory, "nodes.json"), "utf8")).not.toContain("subscription-private");
      await writeFile(join(directory, "mihomo.yaml"), "tampered");
      await expect(writeProxyBundle(root, bundle)).rejects.toThrow("immutable content");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("accepts Windows EPERM only after exact existing-directory readback; other permission errors still fail", async () => {
    const root = await mkdtemp(join(tmpdir(), "proxy-replay-errors-"));
    const files = { "mihomo.yaml": "fixture-yaml", "nodes.json": "fixture-nodes", "receipt.json": "fixture-receipt" };
    const permission = Object.assign(new Error("rename permission denied"), { code: "EPERM" });
    try {
      for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
      await expect(verifyExistingProxyRevision(root, files, permission, "win32")).resolves.toBeUndefined();
      await expect(verifyExistingProxyRevision(root, files, permission, "linux")).rejects.toBe(permission);
      const access = Object.assign(new Error("access denied"), { code: "EACCES" });
      await expect(verifyExistingProxyRevision(root, files, access, "win32")).rejects.toBe(access);
      await expect(verifyExistingProxyRevision(join(root, "missing"), files, permission, "win32")).rejects.toBe(permission);
      await expect(verifyExistingProxyRevision(join(root, "receipt.json"), files, permission, "win32")).rejects.toBe(permission);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects tampering of every immutable file as well as missing and extra files", async () => {
    const root = await mkdtemp(join(tmpdir(), "proxy-replay-content-"));
    const files = { "mihomo.yaml": "fixture-yaml", "nodes.json": "fixture-nodes", "receipt.json": "fixture-receipt" };
    const permission = Object.assign(new Error("rename permission denied"), { code: "EPERM" });
    try {
      for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
      for (const [name, content] of Object.entries(files)) {
        await writeFile(join(root, name), `${content}-changed`);
        await expect(verifyExistingProxyRevision(root, files, permission, "win32")).rejects.toThrow("immutable content");
        await writeFile(join(root, name), content);
      }
      await writeFile(join(root, "unmanaged.txt"), "extra");
      await expect(verifyExistingProxyRevision(root, files, permission, "win32")).rejects.toThrow("immutable content");
      await rm(join(root, "unmanaged.txt"));
      await rm(join(root, "receipt.json"));
      await expect(verifyExistingProxyRevision(root, files, permission, "win32")).rejects.toThrow("immutable content");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not reuse a linked revision directory even when its target content matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "proxy-replay-link-"));
    const directory = join(root, "revision");
    const target = join(root, "target");
    const files = { "receipt.json": "fixture" };
    const permission = Object.assign(new Error("rename permission denied"), { code: "EPERM" });
    try {
      await mkdir(target);
      await writeFile(join(target, "receipt.json"), "fixture");
      await symlink(target, directory, process.platform === "win32" ? "junction" : "dir");
      await expect(verifyExistingProxyRevision(directory, files, permission, "win32")).rejects.toBe(permission);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
