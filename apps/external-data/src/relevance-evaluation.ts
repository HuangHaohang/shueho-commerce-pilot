import assert from "node:assert/strict";
import { enrichCandidates } from "./enrichment.js";
import { applyResearchIntentQuality } from "./intent-quality.js";
import type { LocalModelClient } from "./local-model-client.js";
import type { ResearchIntent } from "./types.js";

const cases = [
  { id: "cookware", topic: "户外炊具", positive: "户外炊具测评：便携不锈钢套锅适合野炊煮饭炖汤。", negative: "今天分享口红试色与眼影画法。", kind: "content" },
  { id: "commuter", topic: "轻量通勤双肩包", positive: "轻量通勤双肩包选购指南，比较重量、容量和电脑夹层。", negative: "RTX4070游戏显卡性能测试。", kind: "content" },
  { id: "shoes", topic: "越野跑鞋", positive: "越野跑鞋实测：碎石路面抓地、防滑和长距离缓震表现。", negative: "咖啡机清洁和除垢方法。", kind: "content" },
  { id: "electronics", topic: "wireless noise cancelling headphones", positive: "Wireless noise cancelling headphones with Bluetooth and active noise cancellation.", negative: "A stainless steel stockpot for cooking soup.", kind: "product" },
  { id: "multilingual", topic: "保温杯", localized: "termo de acero inoxidable", positive: "Termo de acero inoxidable de doble pared para conservar bebidas calientes y frías.", negative: "Zapatos de tacón alto de cuero para mujer.", kind: "product" },
  { id: "explicit-exclusion", topic: "通勤双肩包", excluded: ["真皮材质"], positive: "通勤双肩包，轻量尼龙面料，防泼水耐磨。", negative: "通勤双肩包，头层牛皮真皮材质。", kind: "product" },
] as const;

/** Executes the same query builder, model client, paired gates and date checks as production. */
export async function evaluateProductionRelevance(models: LocalModelClient) {
  await models.health();
  const details: Array<{caseId:string;expected:string|undefined;actual:string;passed:boolean;embeddingScore:number|null;rerankScore:number|null}> = [];
  for (const fixture of cases) {
    const request = `研究最近30天的 ${fixture.topic}，分析播放、点赞、评论、分享和价格销量，按互动排序TOP50，返回时间范围和缺失指标。`;
    const intent: ResearchIntent = {
      platform: "evaluation", targetProduct: fixture.topic,
      localizedKeyword: "localized" in fixture ? fixture.localized : null,
      metrics: ["views", "likes", "comments", "shares", "price_band", "sales_level"],
      expectedCategories: [fixture.topic], excludedCategories: "excluded" in fixture ? [...fixture.excluded] : [],
      originalRequest: request, requestedTopN: 50, currency: null,
      timeRange: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-31T23:59:59.999Z",
        startDate: "2026-08-01", endDate: "2026-08-31", timezone: "UTC" },
    };
    const result = await enrichCandidates({ requestText: request, intent, models,
      candidates: [fixture.positive, fixture.negative, fixture.positive, fixture.positive].map((content, index) => ({
        entityType: "generic_record", entityId: `${fixture.id}-${index}`,
        sourceJsonPointer: `/data/records/${index}`, content,
        quality: applyResearchIntentQuality({ status: "valid", reasons: [], normalizedValue: content },
          index === 2 ? null : index === 3 ? "2026-07-01T00:00:00.000Z" : "2026-08-15T00:00:00.000Z", intent),
        supportsPrice: false, supportsSales: false,
        metadata: { recordKind: fixture.kind, title: content, metrics: {} },
      })),
    });
    const expected = ["promote", "hold", "reject", "reject"];
    result.decisions.forEach((row, index) => details.push({
      caseId: `${fixture.id}-${index}`, expected: expected[index], actual: row.decision,
      passed: expected[index] === row.decision, embeddingScore: row.embeddingScore, rerankScore: row.rerankScore,
    }));
  }
  const failures = details.filter(row => !row.passed);
  console.log(JSON.stringify({ contract: "commerce-relevance-v5", passed: details.length - failures.length, total: details.length, cases: details }));
  assert.equal(failures.length, 0, "Production relevance contract regression failed.");
  return details;
}
