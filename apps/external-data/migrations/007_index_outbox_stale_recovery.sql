CREATE INDEX IF NOT EXISTS index_outbox_processing_recovery_idx
ON index_outbox (updated_at, id)
WHERE state='processing';

CREATE OR REPLACE FUNCTION external_data_claim_index_outbox(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id bigint,
  tenant_id uuid,
  workspace_id uuid,
  aggregate_type text,
  aggregate_id uuid,
  operation text,
  payload jsonb,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'index outbox claim limit must be between 1 and 500';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM index_outbox outbox
    WHERE (
        (outbox.state IN ('pending', 'failed') AND outbox.next_attempt_at <= CURRENT_TIMESTAMP)
        OR (outbox.state='processing' AND outbox.updated_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
      )
      AND outbox.attempt_count < 10
    ORDER BY outbox.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE index_outbox outbox
  SET state='processing', attempt_count=outbox.attempt_count+1, updated_at=CURRENT_TIMESTAMP
  FROM candidates
  WHERE outbox.id=candidates.id
  RETURNING outbox.id, outbox.tenant_id, outbox.workspace_id,
            outbox.aggregate_type, outbox.aggregate_id, outbox.operation,
            outbox.payload, outbox.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION external_data_claim_index_outbox(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT EXECUTE ON FUNCTION external_data_claim_index_outbox(integer) TO external_data_app;
  END IF;
END;
$$;
