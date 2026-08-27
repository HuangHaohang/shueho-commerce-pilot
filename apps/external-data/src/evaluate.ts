import assert from "node:assert/strict";

import { config } from "./config.js";
import { database } from "./database.js";
import { LocalModelClient } from "./local-model-client.js";

const models = new LocalModelClient();
const health = await models.health();
assert.equal(health.fake, false, "quality evaluation requires the real local models");
const cases = await database.query<{
  id: string;
  query_text: string;
  document_text: string;
  expected_relevant: boolean;
  category: string;
}>(`
  SELECT id, query_text, document_text, expected_relevant, category
  FROM quality_evaluation_case WHERE active=true ORDER BY id
`);
if (!cases.rowCount) throw new Error("No active quality evaluation cases are registered.");

const details: Array<Record<string, unknown>> = [];
for (const row of cases.rows) {
  const [queryVector] = await models.embed([row.query_text], "query");
  const [documentVector] = await models.embed([row.document_text], "document");
  if (!queryVector || !documentVector) throw new Error(`Missing embedding for evaluation case ${row.id}.`);
  const embeddingScore = cosine(queryVector, documentVector);
  const [rerankScore] = await models.rerank(row.query_text, [row.document_text]);
  if (rerankScore === undefined) throw new Error(`Missing rerank score for evaluation case ${row.id}.`);
  const predictedRelevant = rerankScore >= config.localModels.rerankMinScore;
  details.push({
    id: row.id,
    category: row.category,
    expectedRelevant: row.expected_relevant,
    predictedRelevant,
    embeddingScore,
    rerankScore,
    passed: predictedRelevant === row.expected_relevant,
  });
}
const passed = details.filter((detail) => detail.passed).length;
const accuracy = passed / details.length;
const client = await database.connect();
try {
  await client.query("BEGIN");
  const run = await client.query<{ id: string }>(`
    INSERT INTO quality_evaluation_run (
      embedding_model,embedding_dimensions,reranker_model,threshold,
      case_count,passed_count,accuracy,details
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id
  `, [config.localModels.embeddingVersion, config.localModels.embeddingDimensions,
    config.localModels.rerankerVersion, config.localModels.rerankMinScore,
    details.length, passed, accuracy, JSON.stringify({ cases: details })]);
  const runId = run.rows[0]?.id;
  if (!runId) throw new Error("Evaluation run insert returned no id.");
  for (const detail of details) {
    await client.query(`
      INSERT INTO quality_evaluation_result (
        run_id,case_id,embedding_score,rerank_score,predicted_relevant,passed
      ) VALUES ($1,$2,$3,$4,$5,$6)
    `, [runId, detail.id, detail.embeddingScore, detail.rerankScore,
      detail.predictedRelevant, detail.passed]);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}

console.log(JSON.stringify({
  passed,
  total: details.length,
  accuracy,
  threshold: config.localModels.rerankMinScore,
  cases: details,
}, null, 2));
await database.end();
assert.ok(accuracy >= 0.9, `local retrieval quality accuracy ${accuracy} is below 0.9`);

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}
