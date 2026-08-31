import { isAppOwnedManagedSkillName } from "../codex/managed-workflows.js";

export type BrowserSkillInventory = {
  skills: Array<Record<string, unknown>>;
  errors: string[];
};

export function readBrowserSkillInventory(
  value: unknown,
  runtimeRoot: string,
): BrowserSkillInventory {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return { skills: [], errors: ["Invalid skills/list response."] };
  }
  const entry = value.data.find((item) => isRecord(item) && item.cwd === runtimeRoot);
  if (!isRecord(entry)) return { skills: [], errors: ["Runtime skill catalog was not returned."] };
  const errors = Array.isArray(entry.errors)
    ? entry.errors.filter((error): error is string => typeof error === "string").slice(0, 20)
    : [];
  const skills = Array.isArray(entry.skills)
    ? entry.skills
        .filter(isRecord)
        .filter((skill) => !isAppOwnedManagedSkillName(skill.name))
        .map((skill) => {
          const skillInterface = isRecord(skill.interface) ? skill.interface : {};
          const dependencies = isRecord(skill.dependencies) && Array.isArray(skill.dependencies.tools)
            ? skill.dependencies.tools.length
            : 0;
          const name = typeof skill.name === "string" ? skill.name : "";
          return {
            name,
            description: typeof skill.description === "string" ? skill.description : "",
            enabled: skill.enabled !== false,
            scope: typeof skill.scope === "string" ? skill.scope : "unknown",
            displayName:
              name === "skill-creator"
                ? "创建技能"
                : typeof skillInterface.displayName === "string"
                  ? skillInterface.displayName
                  : formatSkillDisplayName(name),
            shortDescription:
              name === "skill-creator"
                ? "创建或更新可复用的 Agent 技能"
                : typeof skillInterface.shortDescription === "string"
                  ? skillInterface.shortDescription
                  : typeof skill.description === "string"
                    ? skill.description
                    : "",
            dependencyCount: dependencies,
            creator: name === "skill-creator",
            applicationManaged: name.startsWith("commerce-"),
          };
        })
        .filter((skill) => skill.name)
    : [];
  return { skills, errors };
}

function formatSkillDisplayName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
