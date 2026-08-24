export const copywritingChannels = ["淘宝/天猫", "抖音", "小红书", "京东", "私域"] as const;
export const copywritingTypes = ["商品卖点", "商品详情", "活动推广", "社媒种草"] as const;
export const copywritingTones = ["专业克制", "自然种草", "简洁有力", "轻松活泼"] as const;
export const copywritingLengths = [80, 150, 300, 500] as const;

export type CopywritingBrief = {
  channel: (typeof copywritingChannels)[number];
  copyType: (typeof copywritingTypes)[number];
  productName: string;
  sellingPoints: string;
  audience: string;
  tone: (typeof copywritingTones)[number];
  approximateLength: (typeof copywritingLengths)[number];
  requiredWording: string;
  prohibitedWording: string;
};

export type CopywritingDraft = {
  title: string;
  body: string;
  callToAction: string;
  complianceNotes: string[];
};

export function validateCopywritingBrief(brief: CopywritingBrief): string | null {
  if (!brief.productName.trim()) return "请输入商品名称。";
  if (!brief.sellingPoints.trim()) return "请输入至少一个核心卖点。";
  return null;
}

export function buildCopywritingPrompt(brief: CopywritingBrief): string {
  return [
    "请根据以下结构化电商文案 Brief 生成一个可直接编辑的中文版本。",
    "",
    `渠道：${brief.channel}`,
    `文案类型：${brief.copyType}`,
    `商品名称：${brief.productName.trim()}`,
    `核心卖点：${brief.sellingPoints.trim()}`,
    `目标人群：${brief.audience.trim() || "未指定"}`,
    `表达语气：${brief.tone}`,
    `目标字数：约 ${brief.approximateLength} 字`,
    `必须包含：${brief.requiredWording.trim() || "无"}`,
    `禁止使用：${brief.prohibitedWording.trim() || "无"}`,
    "",
    "只使用 Brief 中可以确认的事实；不确定的信息不要补造，并在合规备注中指出。",
  ].join("\n");
}

export function buildCopywritingAdjustmentPrompt(instruction: string): string {
  return [
    "请基于当前文案和最初 Brief 生成一个新版本，并保持原有事实约束。",
    `调整要求：${instruction.trim()}`,
  ].join("\n");
}

export function parseCopywritingBriefPrompt(content: string): CopywritingBrief | null {
  const fields = new Map<string, string>();
  const knownLabels = new Set([
    "渠道",
    "文案类型",
    "商品名称",
    "核心卖点",
    "目标人群",
    "表达语气",
    "目标字数",
    "必须包含",
    "禁止使用",
  ]);
  let activeLabel: string | null = null;
  for (const line of content.split("\n")) {
    const separatorIndex = line.indexOf("：");
    const possibleLabel = separatorIndex > 0 ? line.slice(0, separatorIndex).trim() : "";
    if (knownLabels.has(possibleLabel)) {
      activeLabel = possibleLabel;
      fields.set(possibleLabel, line.slice(separatorIndex + 1).trim());
      continue;
    }
    if (activeLabel === "核心卖点" && line.trim()) {
      fields.set(activeLabel, `${fields.get(activeLabel) ?? ""}\n${line.trim()}`.trim());
    }
  }

  const channel = fields.get("渠道");
  const copyType = fields.get("文案类型");
  const tone = fields.get("表达语气");
  const lengthMatch = fields.get("目标字数")?.match(/(80|150|300|500)/);
  const productName = fields.get("商品名称") ?? "";
  const sellingPoints = fields.get("核心卖点") ?? "";
  if (
    !copywritingChannels.includes(channel as CopywritingBrief["channel"]) ||
    !copywritingTypes.includes(copyType as CopywritingBrief["copyType"]) ||
    !copywritingTones.includes(tone as CopywritingBrief["tone"]) ||
    !lengthMatch ||
    !productName ||
    !sellingPoints
  ) {
    return null;
  }

  return {
    channel: channel as CopywritingBrief["channel"],
    copyType: copyType as CopywritingBrief["copyType"],
    productName,
    sellingPoints,
    audience: normalizeOptionalBriefField(fields.get("目标人群")),
    tone: tone as CopywritingBrief["tone"],
    approximateLength: Number(lengthMatch[1]) as CopywritingBrief["approximateLength"],
    requiredWording: normalizeOptionalBriefField(fields.get("必须包含")),
    prohibitedWording: normalizeOptionalBriefField(fields.get("禁止使用")),
  };
}

export function parseCopywritingDraft(content: string): CopywritingDraft {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    if (typeof parsed.body === "string") {
      return {
        title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "未命名文案",
        body: parsed.body,
        callToAction: typeof parsed.callToAction === "string" ? parsed.callToAction : "",
        complianceNotes: Array.isArray(parsed.complianceNotes)
          ? parsed.complianceNotes.filter((note): note is string => typeof note === "string")
          : [],
      };
    }
  } catch {
    // Older threads may contain plain text; preserve it as an editable draft.
  }

  return {
    title: "生成文案",
    body: content.trim(),
    callToAction: "",
    complianceNotes: [],
  };
}

function normalizeOptionalBriefField(value: string | undefined): string {
  return !value || value === "无" || value === "未指定" ? "" : value;
}
