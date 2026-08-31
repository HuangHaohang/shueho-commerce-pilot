import { isAppOwnedManagedSkillName } from "@/lib/creative/creative-method-contract";

export function sanitizeSkillInventoryPayload(payload: unknown): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.skills)) return payload;
  return {
    ...payload,
    skills: payload.skills.filter(
      (skill) => isRecord(skill) && !isAppOwnedManagedSkillName(skill.name),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
