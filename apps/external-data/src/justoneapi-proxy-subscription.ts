import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseDocument, stringify } from "yaml";
import { z } from "zod";

import { parseProxyManifest, type ProxyManifest } from "./justoneapi-proxy-pool.js";

const text = z.string().min(1).max(2048).refine((value) => !/[\r\n\0]/.test(value));
const headerValues = z.record(text, text);
const nodeSchema = z.object({
  name: text,
  type: z.enum(["ss", "vmess", "vless", "trojan", "hysteria2"]),
  server: z.string().min(1).max(253).regex(/^[a-zA-Z0-9.:-]+$/),
  port: z.number().int().min(1).max(65535),
  password: text.optional(),
  cipher: text.optional(),
  uuid: text.optional(),
  alterId: z.number().int().min(0).optional(),
  udp: z.boolean().optional(),
  tls: z.boolean().optional(),
  servername: text.optional(),
  sni: text.optional(),
  alpn: z.array(text).max(8).optional(),
  "skip-cert-verify": z.literal(false).optional(),
  "client-fingerprint": text.optional(),
  "fingerprint": text.optional(),
  "packet-encoding": z.enum(["xudp", "packetaddr"]).optional(),
  "udp-over-tcp": z.boolean().optional(),
  "udp-over-tcp-version": z.number().int().optional(),
  flow: text.optional(),
  network: z.enum(["tcp", "ws", "http", "h2", "grpc"]).optional(),
  "ws-opts": z.object({
    path: text.optional(), headers: headerValues.optional(),
    "max-early-data": z.number().int().min(0).max(65536).optional(),
    "early-data-header-name": text.optional(),
  }).strict().optional(),
  "grpc-opts": z.object({ "grpc-service-name": text.optional() }).strict().optional(),
  "h2-opts": z.object({ host: z.array(text).max(8).optional(), path: text.optional() }).strict().optional(),
  "http-opts": z.object({
    method: text.optional(), path: z.array(text).max(8).optional(),
    headers: z.record(text, z.array(text).max(8)).optional(),
  }).strict().optional(),
  "reality-opts": z.object({ "public-key": text, "short-id": z.string().max(32) }).strict().optional(),
  obfs: z.literal("salamander").optional(),
  "obfs-password": text.optional(),
  up: z.union([text, z.number().positive()]).optional(),
  down: z.union([text, z.number().positive()]).optional(),
  ports: text.optional(),
  "hop-interval": z.number().positive().optional(),
  plugin: z.enum(["obfs", "v2ray-plugin"]).optional(),
  "plugin-opts": z.object({
    mode: text.optional(), host: text.optional(), path: text.optional(),
    tls: z.boolean().optional(), mux: z.boolean().optional(),
    "skip-cert-verify": z.literal(false).optional(),
  }).strict().optional(),
}).strict().superRefine((node, context) => {
  if (["ss", "trojan", "hysteria2"].includes(node.type) && !node.password) {
    context.addIssue({ code: "custom", message: "credential missing" });
  }
  if (["vless", "vmess"].includes(node.type) && !node.uuid) {
    context.addIssue({ code: "custom", message: "credential missing" });
  }
  if (node.type === "ss" && !node.cipher) context.addIssue({ code: "custom", message: "cipher missing" });
});

const noticePattern = /请勿连接|跳转域名|剩余流量|流量重置|套餐到期|到期时间/;

export type ProxyBundle = {
  mihomoYaml: string;
  manifest: ProxyManifest;
  receipt: {
    schemaVersion: 1;
    sourceSha256: string;
    revision: string;
    configSha256: string;
    imported: number;
    excludedNotices: number;
    duplicates: number;
    excludedUnsupported: number;
  };
};

/** Imports only reviewed outbound fields, never a subscription's rules, listeners, DNS or controller. */
export function compileProxySubscription(
  source: string,
  options: { proxyHost: string; listen: "127.0.0.1" | "0.0.0.0"; firstPort: number },
): ProxyBundle {
  if (Buffer.byteLength(source) > 2_097_152 || !/^[a-zA-Z0-9.-]+$/.test(options.proxyHost) ||
      !Number.isInteger(options.firstPort) || options.firstPort < 1024 || options.firstPort > 65280) {
    throw new Error("Invalid proxy import size or listener options.");
  }
  let entries: unknown[];
  try {
    const document = parseDocument(source, { uniqueKeys: true, customTags: [] });
    if (document.errors.length || document.warnings.length) throw new Error();
    const parsed = document.toJS({ maxAliasCount: 20 }) as { proxies?: unknown };
    if (!parsed || !Array.isArray(parsed.proxies) || parsed.proxies.length > 1024) throw new Error();
    entries = parsed.proxies;
  } catch {
    throw new Error("Subscription must be a bounded Clash YAML proxies list.");
  }
  const proxies: Array<z.infer<typeof nodeSchema>> = [];
  const identities = new Set<string>();
  let excludedNotices = 0;
  let excludedUnsupported = 0;
  let duplicates = 0;
  for (const entry of entries) {
    if (entry && typeof entry === "object" && "name" in entry &&
        typeof entry.name === "string" && noticePattern.test(entry.name)) {
      excludedNotices += 1;
      continue;
    }
    const parsed = nodeSchema.safeParse(entry);
    if (!parsed.success) { excludedUnsupported += 1; continue; }
    const { name: _displayName, ...connection } = parsed.data;
    const id = `node-${sha256(JSON.stringify(connection)).slice(0, 16)}`;
    if (identities.has(id)) { duplicates += 1; continue; }
    identities.add(id);
    proxies.push({ name: id, ...connection });
  }
  if (!proxies.length || proxies.length > 256) {
    throw new Error("Subscription has no supported secure nodes, or exceeds the 256-node limit.");
  }
  // A listener has a fixed outbound; no mutable selection group, TUN, system proxy or DIRECT fallback.
  const mihomoYaml = stringify({
    mode: "rule",
    "log-level": "silent",
    "allow-lan": options.listen === "0.0.0.0",
    "bind-address": options.listen,
    ipv6: false,
    profile: { "store-selected": false, "store-fake-ip": false },
    proxies,
    listeners: proxies.map((proxy, index) => ({
      name: `in-${proxy.name}`,
      type: "http",
      listen: options.listen,
      port: options.firstPort + index,
      proxy: proxy.name,
    })),
    rules: ["MATCH,REJECT"],
  });
  const nodes = proxies.map((proxy, index) => ({
    id: proxy.name,
    proxyUrl: `http://${options.proxyHost}:${options.firstPort + index}`,
  }));
  const revision = sha256(JSON.stringify({ compiler: 1, sourceSha256: sha256(source), mihomoYaml, nodes }));
  return {
    mihomoYaml,
    manifest: parseProxyManifest({ schemaVersion: 1, revision, nodes }),
    receipt: {
      schemaVersion: 1,
      sourceSha256: sha256(source),
      revision,
      configSha256: sha256(mihomoYaml),
      imported: proxies.length,
      excludedNotices,
      duplicates,
      excludedUnsupported,
    },
  };
}

export async function writeProxyBundle(root: string, bundle: ProxyBundle): Promise<string> {
  const directory = resolve(root, bundle.manifest.revision);
  await mkdir(resolve(root), { recursive: true, mode: 0o700 });
  const files = {
    "mihomo.yaml": bundle.mihomoYaml,
    "nodes.json": JSON.stringify(bundle.manifest, null, 2) + "\n",
    "receipt.json": JSON.stringify(bundle.receipt, null, 2) + "\n",
  };
  const temp = await mkdtemp(join(resolve(root), ".import-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(temp, name), content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    }
    try {
      await rename(temp, directory);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && ["EEXIST", "ENOTEMPTY"].includes(String(error.code)))) throw error;
      for (const [name, content] of Object.entries(files)) {
        if (await readFile(join(directory, name), "utf8") !== content) {
          throw new Error("Existing proxy revision failed immutable content verification.");
        }
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return directory;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
