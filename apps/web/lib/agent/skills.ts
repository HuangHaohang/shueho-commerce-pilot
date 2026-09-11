export type SkillExample = { title: string; url: string; detail_url?: string; product_fraction?: number };
export type SkillPresentation = {
  order?: number; title: string; category: string; summary: string; required_assets: string;
  preview_url: string; preview_layout: "strips" | "a-plus" | "cover";
  preview_examples: SkillExample[];
};

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
  presentation?: SkillPresentation;
};

export type SkillInventoryResponse = {
  skills: SkillInventoryItem[];
  errors: string[];
};

export function sortSkillInventory(skills: SkillInventoryItem[]): SkillInventoryItem[] {
  return [...skills].sort((left, right) => {
    if (Boolean(left.presentation) !== Boolean(right.presentation)) return left.presentation ? -1 : 1;
    if (left.presentation && right.presentation) return (left.presentation.order ?? 0) - (right.presentation.order ?? 0);
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
