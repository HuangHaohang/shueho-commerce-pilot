import { isAbsolute } from "node:path";

import type { UserInput } from "./generated/v2/UserInput.js";
import { isAppOwnedManagedSkillName } from "./managed-workflows.js";

export const CODEX_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ExplicitSkillSelection = {
  name: string;
  path: string;
};

export function resolveExplicitSkillFromCatalog(
  value: unknown,
  cwd: string,
  requestedName: string,
): ExplicitSkillSelection | null {
  if (
    !CODEX_SKILL_NAME_PATTERN.test(requestedName) ||
    isAppOwnedManagedSkillName(requestedName) ||
    !isRecord(value) ||
    !Array.isArray(value.data)
  ) {
    return null;
  }
  const entry = value.data.find((item) => isRecord(item) && item.cwd === cwd);
  if (!isRecord(entry) || !Array.isArray(entry.skills)) return null;
  const skill = entry.skills.find(
    (item) => isRecord(item) && item.name === requestedName && item.enabled !== false,
  );
  if (!isRecord(skill) || typeof skill.path !== "string" || !isAbsolute(skill.path)) return null;
  return { name: requestedName, path: skill.path };
}

export function buildExplicitSkillTurn(
  skill: ExplicitSkillSelection,
  message: string,
): { input: UserInput[] } {
  return {
    input: [
      {
        type: "text",
        text: message,
        text_elements: [],
      },
      {
        type: "skill",
        name: skill.name,
        path: skill.path,
      },
    ],
  };
}

export function readVisibleExplicitSkillMessage(value: string): string {
  return value
    .replace(/^\$[a-z0-9]+(?:-[a-z0-9]+)*[ \t]*(?:\r?\n|$)/, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
