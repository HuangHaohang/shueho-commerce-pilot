import {
  commerceInsightMethodForSkillName,
  creativeMethodForSkillName,
  isAppOwnedManagedSkillName,
  isManagedWorkflowId,
  type CommerceInsightMethod,
  type CreativeMethod,
  type ManagedWorkflowId,
} from "../codex/managed-workflows.js";

export type HarnessRetryContract = {
  workflow: ManagedWorkflowId | null;
  creativeMethod: CreativeMethod | null;
  insightMethod: CommerceInsightMethod | null;
  explicitSkillName: string | null;
  productContextMode: "auto" | "selected" | "none";
};

export type NativeHarnessRetryHistoryRequest =
  | { method: "thread/revert"; params: { threadId: string; beforeTurnId: string } }
  | { method: "thread/rollback"; params: { threadId: string; numTurns: number } };

export function isHarnessMessageItemId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function buildNativeHarnessRetryHistoryRequest(input: {
  historyMode: "legacy" | "paginated";
  threadId: string;
  sourceTurnId: string;
  revertedTurnCount: number;
}): NativeHarnessRetryHistoryRequest {
  if (input.historyMode === "paginated") {
    return {
      method: "thread/revert",
      params: { threadId: input.threadId, beforeTurnId: input.sourceTurnId },
    };
  }
  if (!Number.isSafeInteger(input.revertedTurnCount) || input.revertedTurnCount < 1) {
    throw new Error("Legacy Harness retry requires at least one reverted Turn.");
  }
  return {
    method: "thread/rollback",
    params: { threadId: input.threadId, numTurns: input.revertedTurnCount },
  };
}

export function readHarnessRetryContract(content: unknown): HarnessRetryContract {
  const entries = Array.isArray(content) ? content.filter(isRecord) : [];
  const skillNames = entries
    .filter((entry) => entry.type === "skill" && typeof entry.name === "string")
    .map((entry) => entry.name as string);
  let workflow = skillNames.find(isManagedWorkflowId) ?? null;
  const creativeMethod = skillNames.map(creativeMethodForSkillName).find(Boolean) ?? null;
  const insightMethod = skillNames.map(commerceInsightMethodForSkillName).find(Boolean) ?? null;
  if (!workflow && creativeMethod) workflow = "commerce-creative-project";
  if (!workflow && insightMethod) workflow = "commerce-product-insight";
  const explicitSkillName = workflow
    ? null
    : [...skillNames].reverse().find((name) => !isAppOwnedManagedSkillName(name)) ?? null;
  const productContextMode = readProductContextMode(entries);
  return {
    workflow,
    creativeMethod,
    insightMethod,
    explicitSkillName,
    productContextMode,
  };
}

function readProductContextMode(
  entries: Record<string, unknown>[],
): HarnessRetryContract["productContextMode"] {
  for (const entry of entries) {
    if (entry.type !== "text" || typeof entry.text !== "string") continue;
    if (!entry.text.includes("<commerce_product_context>")) continue;
    if (/(?:^|[;\n])\s*mode=selected(?:[;\n]|$)/m.test(entry.text)) return "selected";
    if (/(?:^|[;\n])\s*mode=auto(?:[;\n]|$)/m.test(entry.text)) return "auto";
  }
  return "none";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
