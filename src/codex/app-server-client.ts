import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

import type {
  AppServerClientOptions,
  AppServerEvent,
  JsonRpcError,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./protocol.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type PendingServerRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
  receivedAt: string;
};

export class CodexAppServerError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "CodexAppServerError";
  }
}

export class CodexAppServerClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private initialized = false;
  private pending = new Map<JsonRpcId, PendingRequest>();
  private pendingServerRequests = new Map<string, PendingServerRequest>();

  constructor(private readonly options: AppServerClientOptions) {
    super();
  }

  get isRunning(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  listPendingServerRequests(): PendingServerRequest[] {
    return Array.from(this.pendingServerRequests.values());
  }

  async start(): Promise<void> {
    if (this.isRunning && this.initialized) {
      return;
    }

    if (this.child) {
      throw new Error("Codex app-server process exists but is not ready.");
    }

    const args = ["app-server", "--listen", "stdio://"];
    this.child = spawn(this.options.codexBin, args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.emitEvent({
      type: "process",
      event: "started",
      data: {
        pid: this.child.pid,
        command: `${this.options.codexBin} ${args.join(" ")}`,
      },
      at: new Date().toISOString(),
    });

    createInterface({ input: this.child.stdout }).on("line", (line) => {
      this.handleStdoutLine(line);
    });

    createInterface({ input: this.child.stderr }).on("line", (line) => {
      this.emitEvent({
        type: "process",
        event: "stderr",
        data: line,
        at: new Date().toISOString(),
      });
    });

    this.child.once("exit", (code, signal) => {
      this.initialized = false;
      this.emitEvent({
        type: "process",
        event: "exit",
        data: { code, signal },
        at: new Date().toISOString(),
      });
      this.rejectAllPending(new Error(`Codex app-server exited: code=${code}, signal=${signal}`));
      this.child = undefined;
    });

    await this.initialize();
  }

  async stop(): Promise<void> {
    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = undefined;
    this.initialized = false;
    child.kill("SIGTERM");
  }

  async request(method: string, params?: unknown, timeoutMs = this.options.requestTimeoutMs ?? 60_000): Promise<unknown> {
    if (!this.isRunning) {
      await this.start();
    }

    const id = this.nextId++;
    const message: JsonRpcRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server response to ${method}.`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.writeJson(message);
    });
  }

  respondToServerRequest(id: JsonRpcId, result: unknown): void {
    this.ensureProcess();
    this.pendingServerRequests.delete(String(id));
    this.writeJson({ id, result });
    this.emitEvent({
      type: "server_request_resolved",
      id,
      at: new Date().toISOString(),
    });
  }

  rejectServerRequest(id: JsonRpcId, error: JsonRpcError): void {
    this.ensureProcess();
    this.pendingServerRequests.delete(String(id));
    this.writeJson({ id, error });
    this.emitEvent({
      type: "server_request_resolved",
      id,
      at: new Date().toISOString(),
    });
  }

  private async initialize(): Promise<void> {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "shueho-commerce-pilot",
        title: "SHUEHO Commerce Agent Gateway",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });

    this.writeJson({ method: "initialized" });
    this.initialized = true;

    this.emitEvent({
      type: "notification",
      method: "gateway/initialized",
      params: result,
      at: new Date().toISOString(),
    });
  }

  private async ensureStarted(): Promise<void> {
    if (!this.isRunning) {
      await this.start();
    }
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (!this.child || !this.isRunning) {
      throw new Error("Codex app-server is not running.");
    }
    return this.child;
  }

  private writeJson(message: unknown): void {
    const child = this.ensureProcess();
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdoutLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.emitEvent({
        type: "process",
        event: "stderr",
        data: `Non-JSON app-server stdout line: ${line}`,
        at: new Date().toISOString(),
      });
      return;
    }

    if (!isObject(message)) {
      return;
    }

    if ("id" in message && ("result" in message || "error" in message) && !("method" in message)) {
      this.handleResponse(message as JsonRpcResponse);
      return;
    }

    if ("method" in message && typeof message.method === "string" && "id" in message) {
      this.handleServerRequest(message as JsonRpcRequest);
      return;
    }

    if ("method" in message && typeof message.method === "string") {
      this.emitEvent({
        type: "notification",
        method: message.method,
        params: "params" in message ? message.params : undefined,
        at: new Date().toISOString(),
      });
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      this.emitEvent({
        type: "client_response",
        id: response.id,
        result: response.result,
        error: response.error,
        at: new Date().toISOString(),
      });
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(pending.timeout);

    if (response.error) {
      pending.reject(new CodexAppServerError(response.error.message, response.error.code, response.error.data));
      return;
    }

    pending.resolve(response.result);
  }

  private handleServerRequest(request: JsonRpcRequest): void {
    if (request.method === "currentTime/read") {
      this.respondToServerRequest(request.id, {
        currentTimeAt: Math.floor(Date.now() / 1000),
      });
      return;
    }

    const pendingRequest: PendingServerRequest = {
      id: request.id,
      method: request.method,
      params: request.params,
      receivedAt: new Date().toISOString(),
    };

    this.pendingServerRequests.set(String(request.id), pendingRequest);
    this.emitEvent({
      type: "server_request",
      id: request.id,
      method: request.method,
      params: request.params,
      at: pendingRequest.receivedAt,
    });
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emitEvent(event: AppServerEvent): void {
    this.emit("event", event);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
