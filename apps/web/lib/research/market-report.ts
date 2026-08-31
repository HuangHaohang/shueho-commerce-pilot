import { z } from "zod";

const subjectSchema = z.object({
  mode: z.enum(["selected", "auto", "none"]),
  title: z.string().max(500),
  subjectRef: z.string().max(500),
  snapshotSha256: z.string().max(128),
  productCount: z.number().int().min(0).max(20),
  factLimitations: z.array(z.string().max(1_000)).max(50),
}).strict();

const scopeSchema = z.object({
  decisionObjective: z.string().max(2_000),
  platforms: z.array(z.string().max(160)).max(20),
  markets: z.array(z.string().max(160)).max(20),
  period: z.string().max(500),
  requestedEvidence: z.array(z.string().max(500)).max(50),
}).strict();

const claimSchema = z.object({
  claimId: z.string().min(1).max(160),
  type: z.enum(["product_fact", "market_signal", "derived_comparison", "hypothesis"]),
  text: z.string().min(1).max(4_000),
  evidenceIds: z.array(z.string().max(500)).max(100),
  productFactRefs: z.array(z.string().max(500)).max(100),
  companyEvidenceRefs: z.array(z.string().max(500)).max(0).default([]),
  confidence: z.enum(["high", "medium", "low"]),
  limitations: z.array(z.string().max(1_000)).max(50),
}).strict().superRefine((value, context) => {
  const needsProductFact = value.type === "product_fact";
  const needsMarketEvidence = value.type === "market_signal" || value.type === "derived_comparison";
  if (needsProductFact && value.productFactRefs.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.type} 必须绑定至少一个产品事实引用。`,
      path: ["productFactRefs"],
    });
  }
  if (needsMarketEvidence && value.evidenceIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.type} 必须绑定至少一个市场证据引用。`,
      path: ["evidenceIds"],
    });
  }
  if (
    value.type === "derived_comparison" &&
    value.evidenceIds.length + value.productFactRefs.length + value.companyEvidenceRefs.length < 2
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "derived_comparison 必须绑定至少两个可比较的事实或证据引用。",
      path: ["evidenceIds"],
    });
  }
});

const recommendationSchema = z.object({
  recommendationId: z.string().min(1).max(160),
  priority: z.enum(["high", "medium", "low"]),
  title: z.string().min(1).max(500),
  rationale: z.string().min(1).max(4_000),
  evidenceIds: z.array(z.string().max(500)).max(100),
  productFactRefs: z.array(z.string().max(500)).max(100),
  companyEvidenceRefs: z.array(z.string().max(500)).max(0).default([]),
  validationMetric: z.string().min(1).max(1_000),
  timeHorizon: z.string().min(1).max(500),
}).strict();

const receiptSchema = z.object({
  researchRequestId: z.string().min(1).max(160),
  platform: z.string().max(160),
  observedAt: z.string().max(160),
  evidenceCount: z.number().int().min(0).max(1_000_000),
  reviewEvidenceCount: z.number().int().min(0).max(1_000_000),
  evidenceKinds: z.array(z.string().max(160)).max(100),
  coverageSummary: z.string().max(2_000),
  limitations: z.array(z.string().max(1_000)).max(50),
}).strict().superRefine((value, context) => {
  if (value.reviewEvidenceCount > value.evidenceCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "评论证据数量不能超过全部证据数量。",
      path: ["reviewEvidenceCount"],
    });
  }
});

export const marketResearchResponseSchema = z.object({
  responseType: z.enum(["report", "answer"]),
  insightType: z.enum(["market_research", "new_product_development", "product_retrospective"])
    .default("market_research"),
  subject: subjectSchema,
  scope: scopeSchema,
  executiveSummary: z.string().max(8_000),
  reportMarkdown: z.string().max(80_000),
  claims: z.array(claimSchema).max(200),
  receipts: z.array(receiptSchema).max(100),
  recommendations: z.array(recommendationSchema).max(100).default([]),
  message: z.string().max(20_000),
}).strict().superRefine((value, context) => {
  if (value.responseType === "report" && !value.reportMarkdown.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "商品决策报告必须包含 Markdown 正文。",
      path: ["reportMarkdown"],
    });
  }
  if (value.responseType === "answer" && !value.message.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "普通回答必须包含消息正文。",
      path: ["message"],
    });
  }
  if (
    value.responseType === "answer" &&
    (value.reportMarkdown.length > 0 || value.claims.length > 0 || value.receipts.length > 0 || value.recommendations.length > 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "普通回答不能携带报告正文、结论或数据回执。",
      path: ["responseType"],
    });
  }
});

export type MarketResearchResponse = z.infer<typeof marketResearchResponseSchema>;
export type MarketResearchClaim = MarketResearchResponse["claims"][number];
export type MarketResearchReceipt = MarketResearchResponse["receipts"][number];

export function parseMarketResearchResponse(content: string): MarketResearchResponse | null {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = marketResearchResponseSchema.safeParse(JSON.parse(normalized) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function tryParseMarketResearchAnswer(content: string): string | null {
  const parsed = parseMarketResearchResponse(content);
  return parsed?.responseType === "answer" ? parsed.message : null;
}
