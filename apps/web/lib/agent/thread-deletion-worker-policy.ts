const RETRYABLE_GATEWAY_STATUSES = new Set([401, 502, 503, 504]);

export function shouldRetryThreadDeletionGatewayStatus(status: number): boolean {
  return RETRYABLE_GATEWAY_STATUSES.has(status);
}
