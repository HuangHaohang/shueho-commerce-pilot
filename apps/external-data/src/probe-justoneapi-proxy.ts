import { Agent, request } from "node:https";
import { parseArgs } from "node:util";
import { JustOneApiProxyPool, openProxyTunnel, readProxyManifest, type ProxyNode } from "./justoneapi-proxy-pool.js";

let pool: JustOneApiProxyPool | undefined;
try {
  const { values } = parseArgs({ options: {
    "nodes-file": { type: "string" },
    target: { type: "string", default: "https://api.justoneapi.com" },
    samples: { type: "string", default: "6" },
    "verify-exit": { type: "boolean", default: false },
  } });
  const samples = Number(values.samples);
  const target = new URL(values.target);
  if (!values["nodes-file"] || !Number.isInteger(samples) || samples < 1 || samples > 128 ||
      target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") throw new Error();
  const manifest = await readProxyManifest(values["nodes-file"]);
  pool = new JustOneApiProxyPool(manifest, target, {
    connectTimeoutMs: 5000, healthIntervalMs: 60_000, cooldownMs: 60_000, maxConnectAttempts: 3,
  });
  await pool.refresh();
  const selected: string[] = [];
  const observedExits = new Set<string>();
  const directExit = values["verify-exit"] ? await exitAddress() : null;
  for (let index = 0; index < samples; index += 1) {
    const lease = await pool.acquire();
    selected.push(lease.nodeId);
    lease.socket.destroy();
    if (values["verify-exit"]) {
      const node = manifest.nodes.find((entry) => entry.id === lease.nodeId)!;
      const exit = await exitAddress(node);
      if (exit === directExit) throw new Error();
      observedExits.add(exit);
    }
  }
  console.log(JSON.stringify({
    ...pool.status(), samples: selected, paidHttpRequests: 0,
    exitCheck: values["verify-exit"] ? { distinctExits: observedExits.size, allDifferentFromDirect: true } : "not_requested",
  }, null, 2));
} catch {
  console.error("JustOneAPI proxy verification failed; no paid provider HTTP request was sent.");
  process.exitCode = 1;
} finally {
  await pool?.close();
}

/** Optional free third-party IP echo; never receives the provider credential or business parameters. */
async function exitAddress(node?: ProxyNode): Promise<string> {
  const url = new URL("https://api.ipify.org?format=json");
  const socket = node ? await openProxyTunnel(node, url, 5000) : undefined;
  const agent = socket ? new Agent({ keepAlive: false }) : undefined;
  if (agent && socket) agent.createConnection = () => socket;
  try {
    return await new Promise<string>((resolve, reject) => {
      const outgoing = request(url, { agent: agent ?? false, signal: AbortSignal.timeout(10_000) }, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("error", reject);
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024) { response.destroy(); reject(new Error()); return; }
          chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { ip?: unknown };
            if (response.statusCode !== 200 || typeof parsed.ip !== "string" || !/^[0-9a-fA-F:.]+$/.test(parsed.ip)) throw new Error();
            resolve(parsed.ip);
          } catch { reject(new Error()); }
        });
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  } finally { agent?.destroy(); socket?.destroy(); }
}
