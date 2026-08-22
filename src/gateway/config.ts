import { cwd } from "node:process";
import { resolve } from "node:path";

import { resolveCodexBin } from "../codex/resolve-codex-bin.js";

export type GatewayConfig = {
  host: string;
  port: number;
  codexBin: string;
  codexHome: string;
  runtimeRoot: string;
  internalToken?: string;
  maxTurnDurationMs: number;
  autoCompactThresholdPercent: number;
  compactionTimeoutMs: number;
  provider: CommerceProviderConfig;
  defaultModel?: string;
  defaultModelProvider?: string;
};

export type CommerceProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnvName: string;
  apiKey?: string;
  imageModel: string;
  agentModelSelectors: string[];
  modelCacheTtlMs: number;
  webSearchTimeoutMs: number;
  webSearchMaxAttempts: number;
};

export function readGatewayConfig(): GatewayConfig {
  const appRoot = cwd();
  const provider = readCommerceProviderConfig();
  const codexHome = resolve(appRoot, process.env.CODEX_HOME || ".runtime/codex");
  const internalToken = emptyToUndefined(process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN);
  if (process.env.NODE_ENV === "production" && (!internalToken || internalToken.length < 32)) {
    throw new Error("COMMERCE_GATEWAY_INTERNAL_TOKEN must contain at least 32 characters in production.");
  }
  return {
    host: process.env.COMMERCE_AGENT_HOST || "127.0.0.1",
    port: parsePort(process.env.COMMERCE_AGENT_PORT || "8787"),
    codexBin: resolveCodexBin(appRoot, process.env.CODEX_BIN),
    codexHome,
    runtimeRoot: resolve(codexHome, "workspaces/default"),
    internalToken,
    maxTurnDurationMs: parsePositiveInteger(
      process.env.COMMERCE_AGENT_MAX_TURN_DURATION_MS || "600000",
      "COMMERCE_AGENT_MAX_TURN_DURATION_MS",
    ),
    autoCompactThresholdPercent: parsePercentage(
      process.env.COMMERCE_AGENT_AUTO_COMPACT_THRESHOLD_PERCENT || "75",
      "COMMERCE_AGENT_AUTO_COMPACT_THRESHOLD_PERCENT",
    ),
    compactionTimeoutMs: parsePositiveInteger(
      process.env.COMMERCE_AGENT_COMPACTION_TIMEOUT_MS || "180000",
      "COMMERCE_AGENT_COMPACTION_TIMEOUT_MS",
    ),
    provider,
    defaultModel: emptyToUndefined(process.env.CODEX_DEFAULT_MODEL),
    defaultModelProvider: emptyToUndefined(process.env.CODEX_DEFAULT_MODEL_PROVIDER) ?? provider.id,
  };
}

function readCommerceProviderConfig(): CommerceProviderConfig {
  const id = process.env.COMMERCE_PROVIDER_ID?.trim() || "luusmosh_cpa";
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("COMMERCE_PROVIDER_ID may contain only letters, numbers, underscores, and hyphens.");
  }

  return {
    id,
    name: process.env.COMMERCE_PROVIDER_NAME?.trim() || "Luusmosh CPA",
    baseUrl: parseProviderBaseUrl(process.env.COMMERCE_PROVIDER_BASE_URL || "https://cpa.luusmosh.com/v1"),
    apiKeyEnvName: "COMMERCE_PROVIDER_API_KEY",
    apiKey: emptyToUndefined(process.env.COMMERCE_PROVIDER_API_KEY),
    imageModel: process.env.COMMERCE_IMAGE_MODEL?.trim() || "gpt-image-2",
    agentModelSelectors: parseCsv(
      process.env.COMMERCE_AGENT_MODEL_SELECTORS ||
        "gpt-5.5,gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol,gemini-3.7-flash*,claude-sonnet-4-6,claude-opus-4-6-thinking",
    ),
    modelCacheTtlMs: parsePositiveInteger(process.env.COMMERCE_PROVIDER_MODEL_CACHE_TTL_MS || "60000", "COMMERCE_PROVIDER_MODEL_CACHE_TTL_MS"),
    webSearchTimeoutMs: parsePositiveInteger(
      process.env.COMMERCE_WEB_SEARCH_TIMEOUT_MS || "90000",
      "COMMERCE_WEB_SEARCH_TIMEOUT_MS",
    ),
    webSearchMaxAttempts: parseBoundedInteger(
      process.env.COMMERCE_WEB_SEARCH_MAX_ATTEMPTS || "2",
      "COMMERCE_WEB_SEARCH_MAX_ATTEMPTS",
      1,
      3,
    ),
  };
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid COMMERCE_AGENT_PORT: ${value}`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function parsePercentage(value: string, name: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 95) {
    throw new Error(`${name} must be between 1 and 95.`);
  }
  return parsed;
}

function parseBoundedInteger(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseProviderBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported COMMERCE_PROVIDER_BASE_URL protocol: ${url.protocol}`);
  }
  return url.toString().replace(/\/$/, "");
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function parseCsv(value: string): string[] {
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error("COMMERCE_AGENT_MODEL_SELECTORS must contain at least one selector.");
  }
  return values;
}
