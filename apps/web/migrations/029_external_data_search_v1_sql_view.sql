CREATE INDEX IF NOT EXISTS commerce_external_data_archive_search_source_time_idx
ON commerce_external_data_archive (
  tenant_id,
  workspace_id,
  (request_payload #>> '{params,source}'),
  completed_at DESC
)
WHERE endpoint_id = 'search.search_v1';

CREATE INDEX IF NOT EXISTS commerce_external_data_archive_search_keyword_idx
ON commerce_external_data_archive (
  tenant_id,
  workspace_id,
  (request_payload #>> '{params,keyword}')
)
WHERE endpoint_id = 'search.search_v1';

CREATE OR REPLACE VIEW commerce_external_data_search_v1_archive
WITH (security_invoker = true)
AS
SELECT
  archive.id,
  archive.tenant_id,
  archive.workspace_id,
  archive.user_id,
  archive.source AS invocation_source,
  archive.source_call_id,
  archive.external_call_id,
  archive.root_thread_id,
  archive.thread_id,
  archive.turn_id,
  archive.state,
  archive.request_payload #>> '{params,keyword}' AS keyword,
  COALESCE(archive.request_payload #>> '{params,source}', 'ALL') AS source_filter,
  archive.request_payload #>> '{params,start}' AS requested_start,
  archive.request_payload #>> '{params,end}' AS requested_end,
  archive.request_payload #>> '{params,next_cursor}' AS requested_next_cursor,
  archive.response_payload -> 'data' AS response_data,
  archive.response_payload ->> 'message' AS response_message,
  archive.response_payload ->> 'recordTime' AS response_record_time,
  archive.response_payload ->> 'requestId' AS provider_request_id,
  archive.upstream_code,
  archive.request_sha256,
  archive.response_sha256,
  archive.request_bytes,
  archive.response_bytes,
  archive.dispatched_at,
  archive.completed_at,
  archive.retention_until,
  archive.legal_hold
FROM commerce_external_data_archive archive
WHERE archive.provider = 'justoneapi'
  AND archive.endpoint_id = 'search.search_v1';

REVOKE ALL ON commerce_external_data_search_v1_archive FROM PUBLIC;

COMMENT ON VIEW commerce_external_data_search_v1_archive IS
  'SQL-only query view over independently retained /api/search/v1 raw archives. No browser or product API exposes this view.';
