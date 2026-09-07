import { config } from "./config.js";
import { JustOneApiProxyPool, readProxyManifest } from "./justoneapi-proxy-pool.js";

let pool: JustOneApiProxyPool | null = null;
let initialization: Promise<JustOneApiProxyPool> | null = null;

export async function getJustOneApiProxyPool(): Promise<JustOneApiProxyPool | null> {
  const options = config.justOneApi.proxy;
  if (options.mode === "off") return null;
  initialization ??= (async () => {
    if (!options.nodesFile) throw new Error("JustOneAPI proxy manifest is required.");
    const manifest = await readProxyManifest(options.nodesFile);
    pool = new JustOneApiProxyPool(manifest, new URL(config.justOneApi.baseUrl), options);
    await pool.start();
    return pool;
  })();
  return initialization;
}

export function justOneApiProxyStatus() {
  return pool?.status() ?? {
    mode: config.justOneApi.proxy.mode,
    configured: config.justOneApi.proxy.mode === "off",
    totalNodes: 0,
    healthyNodes: 0,
    checkedAt: null,
  };
}

export async function closeJustOneApiProxyPool(): Promise<void> {
  await pool?.close();
}
