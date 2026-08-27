export type RequestUserInputOrigin = "codex_app_server" | "commerce_approval";

const LEGACY_COMMERCE_APPROVAL_REQUEST_PREFIXES = ["external_data_", "skill_"] as const;

export function shouldDisplayRequestUserInputAnswer(origin: unknown): boolean {
  return origin === "codex_app_server";
}

export function shouldDisplayPersistedRequestUserInputAnswer(requestId: string): boolean {
  return !LEGACY_COMMERCE_APPROVAL_REQUEST_PREFIXES.some((prefix) => requestId.startsWith(prefix));
}
