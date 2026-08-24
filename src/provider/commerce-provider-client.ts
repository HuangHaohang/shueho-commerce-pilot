import type { CommerceProviderConfig } from "../gateway/config.js";

export type ProviderModelKind = "agent" | "image" | "other";

export type ProviderModel = {
  id: string;
  ownedBy: string | null;
  kind: ProviderModelKind;
  isConfiguredImageModel: boolean;
};

export type ProviderModelCatalog = {
  provider: {
    id: string;
    name: string;
    baseUrl: string;
    wireApi: "responses";
  };
  fetchedAt: string;
  agentModels: ProviderModel[];
  imageModels: ProviderModel[];
  otherModels: ProviderModel[];
  configuredImageModel: string;
};

export type GeneratedImage = {
  responseId: string | null;
  model: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
  quality: string | null;
  size: string | null;
  usage: unknown;
};

export type WebSearchResult = {
  responseId: string | null;
  model: string;
  answer: string;
  sources: Array<{ url: string; title: string | null }>;
  usage: unknown;
};

export type GeneratedThreadTitle = {
  responseId: string | null;
  model: string;
  title: string;
  usage: unknown;
};

type CachedCatalog = {
  expiresAt: number;
  staleUntil: number;
  value: ProviderModelCatalog;
};

export class CommerceProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
    readonly upstreamStatus?: number,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "CommerceProviderError";
  }
}

export class CommerceProviderClient {
  private cache?: CachedCatalog;
  private availableModelIds = new Set<string>();

  constructor(private readonly config: CommerceProviderConfig) {}

  async listModels(forceRefresh = false): Promise<ProviderModelCatalog> {
    if (!forceRefresh && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }

    let response: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await this.request("models", { method: "GET" }, 15_000);
        break;
      } catch (error) {
        lastError = error;
        if (!isRetryableModelCatalogError(error) || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (!response) {
      if (!forceRefresh && this.cache && this.cache.staleUntil > Date.now()) return this.cache.value;
      throw lastError;
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    const rows = readModelRows(payload);
    const models = rows.map((row) => normalizeModel(row, this.config.imageModel));
    this.availableModelIds = new Set(models.map((model) => model.id));
    const catalog: ProviderModelCatalog = {
      provider: {
        id: this.config.id,
        name: this.config.name,
        baseUrl: this.config.baseUrl,
        wireApi: "responses",
      },
      fetchedAt: new Date().toISOString(),
      agentModels: models.filter(
        (model) => model.kind === "agent" && matchesAnySelector(model.id, this.config.agentModelSelectors),
      ),
      imageModels: models.filter((model) => model.kind === "image"),
      otherModels: models.filter((model) => model.kind === "other"),
      configuredImageModel: this.config.imageModel,
    };

    if (!catalog.imageModels.some((model) => model.id === this.config.imageModel)) {
      throw new CommerceProviderError(`Configured image model ${this.config.imageModel} is not available from the provider.`, 503);
    }

    this.cache = {
      expiresAt: Date.now() + this.config.modelCacheTtlMs,
      staleUntil: Date.now() + Math.max(10 * this.config.modelCacheTtlMs, 10 * 60_000),
      value: catalog,
    };
    return catalog;
  }

  async assertAgentModel(modelId: string): Promise<void> {
    const catalog = await this.listModels();
    if (!catalog.agentModels.some((model) => model.id === modelId)) {
      throw new CommerceProviderError(`Model ${modelId} is not an available agent model.`, 400);
    }
  }

  async assertModelAvailable(modelId: string): Promise<void> {
    await this.listModels();
    if (!this.availableModelIds.has(modelId)) {
      throw new CommerceProviderError(`Model ${modelId} is not available from the provider.`, 503);
    }
  }

  async generateThreadTitle(input: {
    model: string;
    userText: string;
    assistantText: string;
  }): Promise<GeneratedThreadTitle> {
    await this.assertModelAvailable(input.model);
    const response = await this.request(
      "responses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          input: [
            {
              role: "developer",
              content: [
                {
                  type: "input_text",
                  text: [
                    "Generate one concise Chinese task title from the user's goal and the completed result.",
                    "The title must describe the business object and outcome, not the conversation mechanics.",
                    "Use 8-24 Chinese characters when possible. Do not use prefixes such as 任务、对话、文案生成、帮我、请帮我.",
                    "Do not add quotation marks, punctuation at the end, emoji, model names, or technical terms.",
                  ].join(" "),
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `用户目标：${input.userText.slice(0, 4_000)}\n\n完成结果：${input.assistantText.slice(0, 4_000)}`,
                },
              ],
            },
          ],
          reasoning: { effort: "low" },
          max_output_tokens: 80,
          text: {
            format: {
              type: "json_schema",
              name: "thread_title",
              strict: true,
              schema: {
                type: "object",
                properties: { title: { type: "string" } },
                required: ["title"],
                additionalProperties: false,
              },
            },
          },
          stream: false,
        }),
      },
      30_000,
    );
    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) throw new CommerceProviderError("Title provider returned an invalid response.");
    const outputText = readResponseOutputText(payload.output);
    const title = normalizeGeneratedTitle(outputText);
    if (!title) throw new CommerceProviderError("Title provider returned no usable title.");
    return {
      responseId: typeof payload.id === "string" ? payload.id : null,
      model: input.model,
      title,
      usage: payload.usage ?? null,
    };
  }

  async generateImage(input: ImageGenerationInput): Promise<GeneratedImage> {
    const catalog = await this.listModels();
    if (input.model !== catalog.configuredImageModel) {
      throw new CommerceProviderError(`Image generation is fixed to ${catalog.configuredImageModel}.`, 400);
    }

    const response = await this.request(
      "images/generations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          quality: input.quality ?? "auto",
          size: input.size ?? "auto",
          n: input.n ?? 1,
        }),
      },
      120_000,
    );
    const payload = (await response.json()) as unknown;
    if (!isRecord(payload) || !Array.isArray(payload.data) || !isRecord(payload.data[0])) {
      throw new CommerceProviderError("Image provider returned an invalid response.");
    }
    const base64 = payload.data[0].b64_json;
    if (typeof base64 !== "string" || base64.length === 0) {
      throw new CommerceProviderError("Image provider returned no image data.");
    }

    return {
      responseId: typeof payload.id === "string" ? payload.id : null,
      model: input.model,
      mimeType: inferImageMimeType(payload.output_format),
      base64,
      quality: typeof payload.quality === "string" ? payload.quality : null,
      size: typeof payload.size === "string" ? payload.size : null,
      usage: payload.usage ?? null,
    };
  }

  async searchWeb(input: WebSearchInput): Promise<WebSearchResult> {
    await this.assertAgentModel(input.model);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < this.config.webSearchMaxAttempts; attempt += 1) {
      const timeoutMs =
        attempt === 0 && this.config.webSearchMaxAttempts > 1
          ? Math.min(this.config.webSearchTimeoutMs, 45_000)
          : this.config.webSearchTimeoutMs;
      try {
        return await this.searchWebOnce(input, timeoutMs);
      } catch (error) {
        lastError = error;
        if (!isRetryableWebSearchError(error) || attempt === this.config.webSearchMaxAttempts - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private async searchWebOnce(input: WebSearchInput, timeoutMs: number): Promise<WebSearchResult> {
    const response = await this.request(
      "responses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          input: input.query,
          tools: [{ type: "web_search" }],
          tool_choice: "auto",
          include: ["web_search_call.action.sources"],
          stream: false,
        }),
      },
      timeoutMs,
    );
    const payload = (await response.json()) as unknown;
    if (!isRecord(payload) || !Array.isArray(payload.output)) {
      throw new CommerceProviderError("Web search provider returned an invalid response.");
    }
    const answerParts: string[] = [];
    const sources = new Map<string, { url: string; title: string | null }>();
    for (const output of payload.output.filter(isRecord)) {
      if (output.type === "message" && Array.isArray(output.content)) {
        for (const content of output.content.filter(isRecord)) {
          if (content.type === "output_text" && typeof content.text === "string") {
            answerParts.push(content.text);
          }
          collectUrlCitations(content.annotations, sources);
        }
      }
      if (output.type === "web_search_call" && isRecord(output.action)) {
        collectSearchSources(output.action.sources, sources);
      }
    }
    const answer = answerParts.join("\n").trim();
    if (!answer) {
      throw new CommerceProviderError("Web search provider returned no answer.");
    }
    if (sources.size === 0) {
      throw new CommerceProviderError("Web search provider returned no source URL.", 502);
    }
    return {
      responseId: typeof payload.id === "string" ? payload.id : null,
      model: input.model,
      answer,
      sources: [...sources.values()].slice(0, 20),
      usage: payload.usage ?? null,
    };
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    if (!this.config.apiKey) {
      throw new CommerceProviderError(`${this.config.apiKeyEnvName} is not configured.`, 503);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}/${path.replace(/^\//, "")}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: unknown } | null;
        const message = typeof errorPayload?.error === "string" ? errorPayload.error : `Provider request failed with HTTP ${response.status}.`;
        throw new CommerceProviderError(
          message,
          response.status === 401 || response.status === 403 ? 502 : response.status,
          response.status,
          response.headers.get("x-cpa-trace-id") ?? undefined,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof CommerceProviderError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new CommerceProviderError("Provider request timed out.", 504);
      }
      throw new CommerceProviderError(error instanceof Error ? error.message : "Provider request failed.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isRetryableModelCatalogError(error: unknown): boolean {
  return (
    error instanceof CommerceProviderError &&
    (error.statusCode === 429 || error.statusCode === 502 || error.statusCode === 503 || error.statusCode === 504)
  );
}

export type ImageGenerationInput = {
  model: string;
  prompt: string;
  quality?: "auto" | "low" | "medium" | "high";
  size?: string;
  n?: number;
};

export type WebSearchInput = {
  model: string;
  query: string;
};

function readModelRows(payload: unknown): Array<Record<string, unknown>> {
  if (!isRecord(payload)) {
    throw new CommerceProviderError("Provider models response must be an object.");
  }
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.filter(isRecord);
}

function normalizeModel(row: Record<string, unknown>, configuredImageModel: string): ProviderModel {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) {
    throw new CommerceProviderError("Provider returned a model without an id.");
  }

  return {
    id,
    ownedBy: typeof row.owned_by === "string" ? row.owned_by : null,
    kind: classifyModel(id),
    isConfiguredImageModel: id === configuredImageModel,
  };
}

function classifyModel(id: string): ProviderModelKind {
  const normalized = id.toLowerCase();
  if (/(^|[-_.])(gpt[-_.]?image|image)([-_.]|$)/.test(normalized)) {
    return "image";
  }
  if (/(embedding|rerank|moderation|whisper|speech|tts|audio|video|auto-review)/.test(normalized)) {
    return "other";
  }
  return "agent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRetryableWebSearchError(error: unknown): boolean {
  return (
    error instanceof CommerceProviderError &&
    (error.statusCode === 429 || error.statusCode === 502 || error.statusCode === 503 || error.statusCode === 504)
  );
}

function inferImageMimeType(outputFormat: unknown): GeneratedImage["mimeType"] {
  if (outputFormat === "jpeg" || outputFormat === "jpg") {
    return "image/jpeg";
  }
  if (outputFormat === "webp") {
    return "image/webp";
  }
  return "image/png";
}

function matchesAnySelector(modelId: string, selectors: string[]): boolean {
  return selectors.some((selector) => {
    const escaped = selector.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(modelId);
  });
}

function collectUrlCitations(
  value: unknown,
  sources: Map<string, { url: string; title: string | null }>,
): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const annotation of value.filter(isRecord)) {
    const url = typeof annotation.url === "string" ? annotation.url : null;
    if (url && isHttpUrl(url)) {
      sources.set(url, { url, title: typeof annotation.title === "string" ? annotation.title : null });
    }
  }
}

function collectSearchSources(
  value: unknown,
  sources: Map<string, { url: string; title: string | null }>,
): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const source of value.filter(isRecord)) {
    const url = typeof source.url === "string" ? source.url : null;
    if (url && isHttpUrl(url)) {
      sources.set(url, { url, title: typeof source.title === "string" ? source.title : null });
    }
  }
}

function readResponseOutputText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const parts: string[] = [];
  for (const output of value.filter(isRecord)) {
    if (output.type !== "message" || !Array.isArray(output.content)) continue;
    for (const content of output.content.filter(isRecord)) {
      if (content.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function normalizeGeneratedTitle(value: string): string {
  let title = value.trim();
  try {
    const parsed = JSON.parse(title) as unknown;
    if (isRecord(parsed) && typeof parsed.title === "string") title = parsed.title;
  } catch {
    // Compatibility with providers that return the schema content as plain text.
  }
  title = title
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^(标题|任务标题|对话标题)\s*[：:]\s*/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[。！？!?；;，,：:]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(title);
  return characters.length > 32 ? `${characters.slice(0, 32).join("")}…` : title;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
