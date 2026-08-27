import { describe, expect, it } from "vitest";

import {
  approvalModeAfterTaskBoundary,
  requiresExternalDataApproval,
} from "./external-data-policy";

describe("external data approval policy", () => {
  it("always requires a confirmation for the safe default", () => {
    expect(requiresExternalDataApproval(
      { approvalMode: "policy", perCallAutoApprovalMicros: 10_000_000 },
      "always_ask",
      1_000_000,
    )).toBe(true);
  });

  it("allows a task-level grant only when enterprise policy permits it", () => {
    expect(requiresExternalDataApproval(
      { approvalMode: "always_ask", perCallAutoApprovalMicros: null },
      "task",
      null,
    )).toBe(true);
    expect(requiresExternalDataApproval(
      { approvalMode: "task", perCallAutoApprovalMicros: null },
      "task",
      null,
    )).toBe(false);
    expect(requiresExternalDataApproval(
      { approvalMode: "policy", perCallAutoApprovalMicros: 1_000_000 },
      "task",
      1_000_000,
    )).toBe(false);
  });

  it("requires a priced rate card and per-call ceiling for policy automation", () => {
    expect(requiresExternalDataApproval(
      { approvalMode: "policy", perCallAutoApprovalMicros: null },
      "policy",
      1_000_000,
    )).toBe(true);
    expect(requiresExternalDataApproval(
      { approvalMode: "policy", perCallAutoApprovalMicros: 2_000_000 },
      "policy",
      null,
    )).toBe(true);
    expect(requiresExternalDataApproval(
      { approvalMode: "policy", perCallAutoApprovalMicros: 2_000_000 },
      "policy",
      2_000_001,
    )).toBe(true);
    expect(requiresExternalDataApproval(
      { approvalMode: "policy", perCallAutoApprovalMicros: 2_000_000 },
      "policy",
      2_000_000,
    )).toBe(false);
  });

  it("ends a task-scoped grant at the next task boundary", () => {
    expect(approvalModeAfterTaskBoundary("task")).toBe("always_ask");
    expect(approvalModeAfterTaskBoundary("always_ask")).toBe("always_ask");
    expect(approvalModeAfterTaskBoundary("policy")).toBe("policy");
  });
});
