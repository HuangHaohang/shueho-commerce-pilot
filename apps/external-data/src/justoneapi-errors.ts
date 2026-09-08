export class JustOneApiError extends Error {
  researchRequestId?: string;
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "METHOD_UNSUPPORTED" | "INVALID_PARAMETER" | "RESULT_UNKNOWN" |
      "RESULT_TOO_LARGE" | "INVALID_RESPONSE" | "PROXY_UNAVAILABLE" | "TOKEN_QUOTA_UNAVAILABLE" | "CALL_ALREADY_CLAIMED" | "QUOTA_STORE_UNAVAILABLE",
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
