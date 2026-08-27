UPDATE commerce_external_data_archive
SET upstream_request_id = COALESCE(
      upstream_request_id,
      response_payload ->> 'requestId',
      response_payload #>> '{raw,requestId}'
    ),
    provider_recorded_at = COALESCE(
      provider_recorded_at,
      CASE
        WHEN COALESCE(
          response_payload ->> 'recordTime',
          response_payload #>> '{raw,recordTime}'
        ) ~ '^\d{4}-\d{2}-\d{2}T'
        THEN COALESCE(
          response_payload ->> 'recordTime',
          response_payload #>> '{raw,recordTime}'
        )::timestamptz
        ELSE NULL
      END
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE response_payload IS NOT NULL
  AND (upstream_request_id IS NULL OR provider_recorded_at IS NULL);

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
  COALESCE(
    archive.response_payload ->> 'message',
    archive.response_payload #>> '{raw,message}'
  ) AS response_message,
  COALESCE(
    archive.response_payload ->> 'recordTime',
    archive.response_payload #>> '{raw,recordTime}'
  ) AS response_record_time,
  COALESCE(
    archive.response_payload ->> 'requestId',
    archive.response_payload #>> '{raw,requestId}'
  ) AS provider_request_id,
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
