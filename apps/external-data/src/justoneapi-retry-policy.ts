import type { ProviderCallResult } from "./types.js";
import { isQuotaExhaustionResponse, providerTokenFeedback } from './justoneapi-errors.js';

export type JustOneApiResilienceOptions = {
  maxAttempts: number;
  totalTimeoutMs: number;
  minimumAttemptWindowMs: number;
  retryBaseMs: number;
  throttleBaseMs: number;
  maxCooldownMs: number;
  maxConcurrent: number;
  endpointMaxConcurrent: number;
  minIntervalMs: number;
  endpointMinIntervalMs: number;
};

export const defaultJustOneApiResilience: JustOneApiResilienceOptions = {
  maxAttempts: 3, totalTimeoutMs: 180_000, minimumAttemptWindowMs: 60_000,
  retryBaseMs: 1_000, throttleBaseMs: 15_000, maxCooldownMs: 120_000,
  maxConcurrent: 4, endpointMaxConcurrent: 1, minIntervalMs: 1_000, endpointMinIntervalMs: 2_000,
};

/** Only explicit documented non-billable rejections authorize another attempt. */
export function isRetryableProviderRejection(result: ProviderCallResult): boolean {
  if (isQuotaExhaustionResponse(result) || providerTokenFeedback(result) === 'invalid') return true;
  return result.state === "business_failed" && (result.httpStatus >= 200 && result.httpStatus < 300 || result.httpStatus === 429) &&
    (result.providerCode === 301 || result.providerCode === 302) && result.payload?.code === result.providerCode;
}

export function providerResultUncertain(result: ProviderCallResult): boolean {
  return result.httpStatus >= 500 || result.providerCode === 500 || result.providerCode === null ||
    result.payload === null || (result.providerCode === 0 && result.state !== "succeeded");
}

/** Never shorten a valid Retry-After, even when it exceeds this call's retry budget. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const duration = Number(text) * 1_000;
    return Number.isSafeInteger(Math.ceil(duration)) && Number.isFinite(new Date(now + duration).getTime()) ? Math.ceil(duration) : null;
  }
  if (/^[+-]?\d/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

export function retryDelayMs(attempt: number, options: JustOneApiResilienceOptions, random = Math.random): number {
  return Math.min(10_000, options.retryBaseMs * 2 ** Math.max(0, attempt - 1)) + Math.floor(random() * options.retryBaseMs);
}
