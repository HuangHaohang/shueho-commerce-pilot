CREATE TABLE IF NOT EXISTS research_workflow_business_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  workflow_execution_id uuid NOT NULL
    REFERENCES research_workflow_execution(id) ON DELETE RESTRICT,
  workflow_step_execution_id uuid NOT NULL
    REFERENCES research_workflow_step_execution(id) ON DELETE RESTRICT,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  source_record_id uuid NOT NULL REFERENCES generic_source_record(id) ON DELETE RESTRICT,
  source_raw_call_id uuid NOT NULL REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('discovery', 'detail', 'price', 'reviews', 'sku')),
  evidence_kind text NOT NULL,
  provider_entity_id text,
  title text,
  summary text,
  canonical_url text,
  metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
  quality_basis text NOT NULL
    CHECK (quality_basis IN ('ai_promoted_text', 'deterministic_structured_metric')),
  relevance_score double precision CHECK (relevance_score IS NULL OR relevance_score BETWEEN 0 AND 1),
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_json_pointer text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workflow_execution_id, workflow_step_execution_id, source_record_id, quality_basis)
);

CREATE INDEX IF NOT EXISTS research_workflow_business_evidence_lookup_idx
ON research_workflow_business_evidence
  (tenant_id, workspace_id, workflow_execution_id, role, created_at);

ALTER TABLE research_workflow_business_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_workflow_business_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_data_scope ON research_workflow_business_evidence;
CREATE POLICY external_data_scope ON research_workflow_business_evidence
USING (
  tenant_id = NULLIF(current_setting('external_data.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('external_data.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('external_data.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('external_data.workspace_id', true), '')::uuid
);

REVOKE ALL ON research_workflow_business_evidence FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT SELECT, INSERT, UPDATE ON research_workflow_business_evidence TO external_data_app;
  END IF;
END;
$$;

COMMENT ON TABLE research_workflow_business_evidence IS
  'Curated workflow-step evidence: text requires AI promotion, while text-free numeric metrics may pass deterministic structured rules.';
