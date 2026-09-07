import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { z } from "zod";

const nodeSchema = z.object({
  id: z.string().regex(/^node-[0-9a-f]{16}$/),
  proxyUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "http:" && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash && Boolean(url.port);
  }),
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  nodes: z.array(nodeSchema).min(1).max(256),
}).strict().refine(({ nodes }) => new Set(nodes.map((node) => node.id)).size === nodes.length &&
  new Set(nodes.map((node) => node.proxyUrl)).size === nodes.length);

export type ProxyNode = z.infer<typeof nodeSchema>;
export type ProxyManifest = z.infer<typeof manifestSchema>;
export type ProxyConnector = (node: ProxyNode, target: URL, timeoutMs: number) => Promise<TLSSocket>;

export class ProxyUnavailableError extends Error {
  constructor() {
    super("No usable JustOneAPI proxy tunnel; provider request was not sent.");
    this.name = "ProxyUnavailableError";
  }
}

export async function readProxyManifest(path: string): Promise<ProxyManifest> {
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > 262_144) throw new Error();
    return parseProxyManifest(JSON.parse(bytes.toString("utf8")));
  } catch {
    // Never echo a protected filename, subscription URL, proxy address or parser input.
    throw new Error("JustOneAPI proxy manifest is missing or invalid.");
  }
}

export function parseProxyManifest(value: unknown): ProxyManifest {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid JustOneAPI proxy manifest.");
  return parsed.data;
}

/** Only CONNECT and a verified TLS handshake occur here. No HTTP request or API token is sent. */
export function openProxyTunnel(
  node: ProxyNode,
  target: URL,
  timeoutMs: number,
  trustedCa?: string | Buffer,
): Promise<TLSSocket> {
  if (target.protocol !== "https:" || target.username || target.password) {
    return Promise.reject(new ProxyUnavailableError());
  }
  return new Promise((resolve, reject) => {
    const proxy = new URL(node.proxyUrl);
    const hostname = target.hostname.replace(/^\[|\]$/g, "");
    const authority = `${target.hostname}:${target.port || "443"}`;
    let tls: TLSSocket | undefined;
    let settled = false;
    const request = httpRequest({
      hostname: proxy.hostname,
      port: proxy.port,
      method: "CONNECT",
      path: authority,
      headers: { Host: authority },
      agent: false,
      maxHeaderSize: 16_384,
    });
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      tls?.destroy();
      reject(new ProxyUnavailableError());
    };
    const timer = setTimeout(fail, timeoutMs);
    request.once("error", fail);
    request.once("response", (response) => { response.destroy(); fail(); });
    request.once("connect", (response, socket, head) => {
      if (settled || response.statusCode !== 200 || head.length > 0) {
        socket.destroy();
        fail();
        return;
      }
      tls = tlsConnect({
        socket,
        host: hostname,
        servername: isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true,
        ...(trustedCa ? { ca: trustedCa } : {}),
        ALPNProtocols: ["http/1.1"],
      });
      tls.once("error", fail);
      tls.once("close", fail);
      tls.once("secureConnect", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(tls!);
      });
    });
    request.end();
  });
}

type NodeState = {
  node: ProxyNode;
  healthy: boolean;
  checkedAt: number;
  retryAt: number;
  failures: number;
  generation: number;
};

export type ProxyLease = {
  nodeId: string;
  socket: TLSSocket;
  failed: () => void;
};

export type ProxyPoolOptions = {
  connectTimeoutMs: number;
  healthIntervalMs: number;
  cooldownMs: number;
  maxConnectAttempts: number;
};

/** Process-owned, per-request shuffle bag. It has no method that dispatches a paid HTTP request. */
export class JustOneApiProxyPool {
  private readonly states: NodeState[];
  private bag: NodeState[] = [];
  private lastId: string | null = null;
  private refreshing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    readonly manifest: ProxyManifest,
    private readonly target: URL,
    private readonly options: ProxyPoolOptions,
    private readonly connect: ProxyConnector = openProxyTunnel,
    private readonly now: () => number = Date.now,
    private readonly random: (maximum: number) => number = randomInt,
  ) {
    parseProxyManifest(manifest);
    if (target.protocol !== "https:") throw new Error("JustOneAPI proxy mode requires HTTPS.");
    this.states = manifest.nodes.map((node) => ({
      node, healthy: false, checkedAt: 0, retryAt: 0, failures: 0, generation: 0,
    }));
  }

  async start(): Promise<void> {
    await this.refresh();
    if (!this.timer && !this.closed) {
      this.timer = setInterval(() => { void this.refresh(); }, this.options.healthIntervalMs);
      this.timer.unref();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.refreshing;
  }

  status() {
    const checkedAt = Math.max(...this.states.map((state) => state.checkedAt));
    return {
      mode: "required" as const,
      configured: true,
      totalNodes: this.states.length,
      healthyNodes: this.states.filter((state) => this.usable(state)).length,
      checkedAt: checkedAt ? new Date(checkedAt).toISOString() : null,
    };
  }

  allowsTarget(url: URL): boolean {
    return url.origin === this.target.origin;
  }

  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    const pending = this.states.filter((state) => state.retryAt <= this.now());
    this.refreshing = Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      for (;;) {
        const state = pending.shift();
        if (!state || this.closed) return;
        const generation = state.generation;
        try {
          const socket = await this.connect(state.node, this.target, this.options.connectTimeoutMs);
          socket.destroy();
          if (generation === state.generation) this.succeeded(state);
        } catch {
          if (generation === state.generation) this.failed(state);
        }
      }
    })).then(() => undefined).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async acquire(deadline = Number.POSITIVE_INFINITY): Promise<ProxyLease> {
    if (this.closed) throw new ProxyUnavailableError();
    if (!this.states.some((state) => this.usable(state))) await this.refresh();
    const attempted = new Set<string>();
    for (let attempt = 0; attempt < this.options.maxConnectAttempts; attempt += 1) {
      const state = this.select(attempted);
      if (!state || this.closed || this.now() >= deadline) break;
      attempted.add(state.node.id);
      const generation = state.generation;
      try {
        const socket = await this.connect(state.node, this.target, Math.min(this.options.connectTimeoutMs, deadline - this.now()));
        if (this.closed || this.now() >= deadline) { socket.destroy(); break; }
        if (generation === state.generation) this.succeeded(state);
        return { nodeId: state.node.id, socket, failed: () => this.failed(state) };
      } catch {
        this.failed(state);
      }
    }
    throw new ProxyUnavailableError();
  }

  private usable(state: NodeState): boolean {
    return state.healthy && this.now() - state.checkedAt <= this.options.healthIntervalMs * 3;
  }

  private select(attempted: Set<string>): NodeState | undefined {
    this.bag = this.bag.filter((state) => this.usable(state) && !attempted.has(state.node.id));
    if (!this.bag.length) {
      this.bag = this.states.filter((state) => this.usable(state) && !attempted.has(state.node.id));
      for (let index = this.bag.length - 1; index > 0; index -= 1) {
        const other = this.random(index + 1);
        [this.bag[index], this.bag[other]] = [this.bag[other]!, this.bag[index]!];
      }
      if (this.bag.length > 1 && this.bag[0]!.node.id === this.lastId) {
        [this.bag[0], this.bag[1]] = [this.bag[1]!, this.bag[0]!];
      }
    }
    const chosen = this.bag.shift();
    if (chosen) this.lastId = chosen.node.id;
    return chosen;
  }

  private succeeded(state: NodeState): void {
    state.healthy = true;
    state.checkedAt = this.now();
    state.retryAt = 0;
    state.failures = 0;
  }

  private failed(state: NodeState): void {
    state.generation += 1;
    state.healthy = false;
    state.checkedAt = this.now();
    state.failures += 1;
    state.retryAt = this.now() + Math.min(this.options.cooldownMs * 2 ** Math.min(state.failures - 1, 5), 900_000);
  }
}
