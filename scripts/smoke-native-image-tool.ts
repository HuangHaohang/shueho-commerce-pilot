import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CodexAppServerClient } from "../src/codex/app-server-client.js";
import { resolveCodexBin } from "../src/codex/resolve-codex-bin.js";

type ProviderScenario = {
  actorAuthorization: boolean;
  name: string;
  providerId: string;
  providerName: string;
};

type CapturedRequest = {
  body: Record<string, unknown>;
  method: string;
  path: string;
};

const codexBin = resolveCodexBin(process.cwd(), process.env.CODEX_BIN);
const scenarios: ProviderScenario[] = [
  {
    name: "custom-provider",
    providerId: "smoke_custom",
    providerName: "Custom smoke provider",
    actorAuthorization: false,
  },
  {
    name: "actor-authorized-provider",
    providerId: "smoke_actor_authorized",
    providerName: "Commerce Pilot Provider Proxy",
    actorAuthorization: true,
  },
];

const results = [];
for (const scenario of scenarios) {
  try {
    results.push(await inspectScenario(scenario));
  } catch (error) {
    results.push({
      scenario: scenario.name,
      providerId: scenario.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const actorAuthorized = results.find((result) => result.scenario === "actor-authorized-provider");
if (!actorAuthorized || !("hasNativeImageTool" in actorAuthorized) || actorAuthorized.hasNativeImageTool !== true) {
  throw new Error(
    `Codex did not expose native image_gen for the actor-authorized provider. Results: ${JSON.stringify(results)}`,
  );
}
console.log(JSON.stringify({ codexBin, results }, null, 2));

async function inspectScenario(scenario: ProviderScenario) {
  const capturedRequests: CapturedRequest[] = [];
  let resolveFirstRequest: ((request: CapturedRequest) => void) | null = null;
  const firstRequest = new Promise<CapturedRequest>((resolve) => {
    resolveFirstRequest = resolve;
  });
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    const captured = {
      body,
      method: request.method ?? "",
      path: request.url ?? "",
    };
    capturedRequests.push(captured);
    if (request.method === "GET" && request.url?.startsWith("/v1/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "gpt-5.6-sol", object: "model" }] }));
      return;
    }
    resolveFirstRequest?.(captured);
    resolveFirstRequest = null;
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "intentional smoke response" } }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Smoke server did not bind a TCP port.");
  const codexHome = await mkdtemp(join(tmpdir(), `commerce-image-tool-${scenario.providerId}-`));
  const runtimeRoot = join(codexHome, "runtime");
  await writeFile(
    join(codexHome, "config.toml"),
    renderConfig(scenario, `http://127.0.0.1:${address.port}/v1`),
    "utf8",
  );
  const clientEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: codexHome,
    SMOKE_PROVIDER_API_KEY: "smoke-key",
  };
  delete clientEnv.OPENAI_API_KEY;
  const client = new CodexAppServerClient({
    codexBin,
    cwd: process.cwd(),
    env: clientEnv,
    requestTimeoutMs: 20_000,
  });

  try {
    await client.start();
    const started = await client.request("thread/start", {
      serviceName: "shueho-image-tool-smoke",
      model: "gpt-5.6-sol",
      modelProvider: scenario.providerId,
      cwd: runtimeRoot,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: {
        web_search: "disabled",
      },
      developerInstructions: "Use the native image_gen tool for image requests.",
      ephemeral: true,
      experimentalRawEvents: true,
      dynamicTools: [
        {
          type: "namespace",
          name: "smoke",
          description: "Smoke-test namespace.",
          tools: [
            {
              type: "function",
              name: "noop",
              description: "No-op tool used only to activate the dynamic tool surface.",
              deferLoading: false,
              inputSchema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
            },
          ],
        },
      ],
    });
    const threadId = readThreadId(started);
    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "Reply with OK without calling tools.", text_elements: [] }],
    });
    const captured = await withTimeout(firstRequest, 15_000, "Codex did not call the smoke provider.");
    const toolNames = collectToolNames(captured.body.tools);
    const serializedBody = JSON.stringify(captured.body);
    const nestedImageToolNames = [...serializedBody.matchAll(/image_gen(?:__|\.)imagegen/g)].map(
      (match) => match[0],
    );
    return {
      scenario: scenario.name,
      providerId: scenario.providerId,
      requestPath: captured.path,
      hasNativeImageTool:
        nestedImageToolNames.length > 0 ||
        toolNames.some((name) => name === "image_gen" || name.startsWith("image_gen.")),
      imageToolNames: [...new Set([...toolNames.filter((name) => name.includes("image")), ...nestedImageToolNames])],
      toolNames,
      requestBodyKeys: Object.keys(captured.body).sort(),
      requestCount: capturedRequests.length,
    };
  } finally {
    await client.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // App Server's SQLite handles can remain briefly pending on Windows after
    // the child process exits. Retry bounded cleanup so a transient file lock
    // cannot turn a successful capability smoke test into a false failure.
    await rm(codexHome, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 20 : 2,
      retryDelay: 100,
    });
  }
}

function renderConfig(scenario: ProviderScenario, baseUrl: string): string {
  const { actorAuthorization, providerId, providerName } = scenario;
  const lines = [
    `model_provider = ${JSON.stringify(providerId)}`,
    'model = "gpt-5.6-sol"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    'cli_auth_credentials_store = "file"',
    "",
    "[features]",
    "image_generation = true",
    "enable_request_compression = false",
    "code_mode = true",
    "code_mode_host = true",
    "code_mode_only = true",
    "shell_tool = false",
    "unified_exec = false",
    "",
  ];
  lines.push(
    `[model_providers.${providerId}]`,
    `name = ${JSON.stringify(providerName)}`,
    `base_url = ${JSON.stringify(baseUrl)}`,
    'env_key = "SMOKE_PROVIDER_API_KEY"',
    'wire_api = "responses"',
    "requires_openai_auth = false",
    ...(actorAuthorization
      ? ['http_headers = { "x-openai-actor-authorization" = "smoke-actor-token" }']
      : []),
    "request_max_retries = 0",
    "stream_max_retries = 0",
    "stream_idle_timeout_ms = 120000",
    "supports_websockets = false",
    "",
  );
  return lines.join("\n");
}

function readThreadId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== "string") {
    throw new Error("App Server returned an invalid thread/start response.");
  }
  return value.thread.id;
}

function collectToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  for (const tool of value) {
    if (!isRecord(tool)) continue;
    if (typeof tool.name === "string") names.add(tool.name);
    if (typeof tool.namespace === "string") names.add(tool.namespace);
    if (typeof tool.type === "string" && tool.type.includes("image")) names.add(tool.type);
    if (Array.isArray(tool.tools)) {
      for (const nested of tool.tools) {
        if (!isRecord(nested) || typeof nested.name !== "string") continue;
        const namespace = typeof tool.name === "string" ? `${tool.name}.` : "";
        names.add(`${namespace}${nested.name}`);
      }
    }
  }
  return [...names].sort();
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of request) raw += chunk.toString("utf8");
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return isRecord(parsed) ? parsed : {};
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
