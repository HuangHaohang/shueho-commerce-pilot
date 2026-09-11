import type { ProviderCallResult } from './types.js';

export class JustOneApiError extends Error {
  researchRequestId?: string;
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "METHOD_UNSUPPORTED" | "INVALID_PARAMETER" | "RESULT_UNKNOWN" |
      "ADMISSION_TIMEOUT" | "RESULT_TOO_LARGE" | "INVALID_RESPONSE" | "PROXY_UNAVAILABLE" | "TOKEN_QUOTA_UNAVAILABLE" | "CALL_ALREADY_CLAIMED" | "QUOTA_STORE_UNAVAILABLE",
    readonly uncertain: boolean,
  ) { super(message); this.name = "JustOneApiError"; }
}

export type TokenFeedback = "none" | "invalid" | "endpoint_exhausted" | "endpoint_denied" | "rate_limited";

// Official JustOneAPI business codes, not HTTP status or fuzzy error-message matching.
export function tokenFeedback(providerCode: number | null): TokenFeedback {
  if (providerCode === 100) return "invalid";
  if (providerCode === 303 || providerCode === 601 || providerCode === 602) return "endpoint_exhausted";
  if (providerCode === 600) return "endpoint_denied";
  if (providerCode === 302) return "rate_limited";
  return "none";
}

/** Only the provider's business envelope can change credential eligibility. */
export function providerTokenFeedback(result: ProviderCallResult): TokenFeedback {
  if (result.state !== 'business_failed' ||
      result.providerCode === null || result.payload?.code !== result.providerCode) return 'none';
  // Authentication/permission responses use their own HTTP status, never quota failover.
  if (result.providerCode === 100 && result.httpStatus === 401) return 'invalid';
  if (result.providerCode === 600 && result.httpStatus === 403) return 'endpoint_denied';
  if (!(result.httpStatus >= 200 && result.httpStatus < 300 || result.httpStatus === 429)) return 'none';
  return tokenFeedback(result.providerCode);
}

/** Official non-billable quota/balance/budget codes; never fuzzy-match message text. */
export function isQuotaExhaustionResponse(result: ProviderCallResult): boolean {
  return providerTokenFeedback(result) === 'endpoint_exhausted';
}
