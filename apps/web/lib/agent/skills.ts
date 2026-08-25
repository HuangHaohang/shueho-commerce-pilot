export type SkillInventoryItem = {
  name: string;
  description: string;
  enabled: boolean;
  scope: string;
  displayName: string;
  shortDescription: string;
  dependencyCount: number;
  creator: boolean;
  applicationManaged: boolean;
};

export type SkillInventoryResponse = {
  skills: SkillInventoryItem[];
  errors: string[];
};

export function sortSkillInventory(skills: SkillInventoryItem[]): SkillInventoryItem[] {
  return [...skills].sort((left, right) => {
    if (left.creator !== right.creator) return left.creator ? -1 : 1;
    if (left.applicationManaged !== right.applicationManaged) return left.applicationManaged ? -1 : 1;
    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });
}

export async function getSkills(): Promise<SkillInventoryResponse> {
  const response = await fetch("/api/skills", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as SkillInventoryResponse | { error?: string } | null;
  if (!response.ok || !payload || !("skills" in payload)) {
    throw new Error(payload && "error" in payload ? payload.error : "Skills unavailable.");
  }
  return payload;
}
