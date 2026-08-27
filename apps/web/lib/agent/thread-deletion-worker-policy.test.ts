import { describe, expect, it } from "vitest";

import { shouldRetryThreadDeletionGatewayStatus } from "./thread-deletion-worker-policy";

describe("thread deletion worker retry policy", () => {
  it("retries transient infrastructure and stale service-credential responses", () => {
    expect(shouldRetryThreadDeletionGatewayStatus(401)).toBe(true);
    expect(shouldRetryThreadDeletionGatewayStatus(502)).toBe(true);
    expect(shouldRetryThreadDeletionGatewayStatus(503)).toBe(true);
    expect(shouldRetryThreadDeletionGatewayStatus(504)).toBe(true);
  });

  it("does not retry invalid or forbidden product requests forever", () => {
    expect(shouldRetryThreadDeletionGatewayStatus(400)).toBe(false);
    expect(shouldRetryThreadDeletionGatewayStatus(403)).toBe(false);
    expect(shouldRetryThreadDeletionGatewayStatus(404)).toBe(false);
  });
});
