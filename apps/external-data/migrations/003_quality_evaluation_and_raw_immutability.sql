CREATE OR REPLACE FUNCTION external_data_enforce_raw_call_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state IN ('succeeded', 'business_failed', 'unknown') THEN
    RAISE EXCEPTION 'terminal external raw calls are immutable';
  END IF;
  IF OLD.state <> 'dispatched' OR NEW.state NOT IN ('succeeded', 'business_failed', 'unknown') THEN
    RAISE EXCEPTION 'invalid external raw call transition % -> %', OLD.state, NEW.state;
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.user_id <> OLD.user_id
     OR NEW.research_request_id <> OLD.research_request_id
     OR NEW.external_query_id <> OLD.external_query_id
     OR NEW.endpoint_id <> OLD.endpoint_id
     OR NEW.request_params <> OLD.request_params
     OR NEW.request_sha256 <> OLD.request_sha256
     OR NEW.request_bytes <> OLD.request_bytes THEN
    RAISE EXCEPTION 'external raw request identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_api_call_raw_immutability ON external_api_call_raw;
CREATE TRIGGER external_api_call_raw_immutability
BEFORE UPDATE ON external_api_call_raw
FOR EACH ROW EXECUTE FUNCTION external_data_enforce_raw_call_immutability();

CREATE TABLE IF NOT EXISTS ai_decision_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  enrichment_result_id uuid NOT NULL REFERENCES ai_enrichment_result(id) ON DELETE RESTRICT,
  reviewer_user_id text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('correct', 'incorrect', 'needs_review')),
  corrected_decision text CHECK (corrected_decision IS NULL OR corrected_decision IN ('promote', 'hold', 'reject')),
  corrected_normalized_value text,
  reason_codes text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ai_decision_review_result_idx
ON ai_decision_review (tenant_id, workspace_id, enrichment_result_id, created_at DESC);

ALTER TABLE ai_decision_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decision_review FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_data_scope ON ai_decision_review;
CREATE POLICY external_data_scope ON ai_decision_review
USING (
  tenant_id = NULLIF(current_setting('external_data.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('external_data.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('external_data.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('external_data.workspace_id', true), '')::uuid
);

CREATE TABLE IF NOT EXISTS quality_evaluation_case (
  id text PRIMARY KEY,
  query_text text NOT NULL,
  document_text text NOT NULL,
  expected_relevant boolean NOT NULL,
  category text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_evaluation_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embedding_model text NOT NULL,
  embedding_dimensions integer NOT NULL,
  reranker_model text NOT NULL,
  threshold double precision NOT NULL,
  case_count integer NOT NULL,
  passed_count integer NOT NULL,
  accuracy double precision NOT NULL,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_evaluation_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES quality_evaluation_run(id) ON DELETE CASCADE,
  case_id text NOT NULL REFERENCES quality_evaluation_case(id) ON DELETE RESTRICT,
  embedding_score double precision NOT NULL,
  rerank_score double precision NOT NULL,
  predicted_relevant boolean NOT NULL,
  passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, case_id)
);

INSERT INTO quality_evaluation_case (id, query_text, document_text, expected_relevant, category)
VALUES
  ('taobao-spoon-exact', '淘宝蘑菇勺价格带和销量量级', '厨房不锈钢蘑菇造型汤勺，售价19.9元，销量1000+', true, 'exact_product'),
  ('taobao-spoon-adjacent', '淘宝蘑菇勺价格带和销量量级', '家用长柄炒菜勺子蘑菇铲，售价29.9元', true, 'adjacent_product'),
  ('taobao-spoon-laptop', '淘宝蘑菇勺价格带和销量量级', 'RTX4070 高性能游戏笔记本电脑，售价6999元', false, 'cross_category'),
  ('taobao-spoon-phone', '淘宝蘑菇勺价格带和销量量级', '华为畅享手机保护壳，月销1000+', false, 'cross_category'),
  ('taobao-spoon-material', '淘宝蘑菇勺价格带和消费者选择属性', '商品属性：材质；属性值：304不锈钢；覆盖141件商品', true, 'property')
ON CONFLICT (id) DO UPDATE
SET query_text=EXCLUDED.query_text,
    document_text=EXCLUDED.document_text,
    expected_relevant=EXCLUDED.expected_relevant,
    category=EXCLUDED.category,
    active=true;

REVOKE ALL ON ai_decision_review, quality_evaluation_case,
  quality_evaluation_run, quality_evaluation_result FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT SELECT, INSERT, UPDATE ON ai_decision_review TO external_data_app;
    GRANT SELECT ON quality_evaluation_case TO external_data_app;
    GRANT SELECT, INSERT ON quality_evaluation_run, quality_evaluation_result TO external_data_app;
  END IF;
END;
$$;
