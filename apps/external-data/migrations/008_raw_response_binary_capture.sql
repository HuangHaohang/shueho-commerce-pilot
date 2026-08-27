ALTER TABLE external_api_call_raw
ADD COLUMN IF NOT EXISTS response_body_bytes bytea;

ALTER TABLE external_api_call_raw DISABLE TRIGGER external_api_call_raw_immutability;
UPDATE external_api_call_raw
SET response_body_bytes = convert_to(response_body_text, 'UTF8')
WHERE response_body_text IS NOT NULL AND response_body_bytes IS NULL;
ALTER TABLE external_api_call_raw ENABLE TRIGGER external_api_call_raw_immutability;

ALTER TABLE external_api_call_raw
DROP CONSTRAINT IF EXISTS external_api_call_raw_check,
DROP CONSTRAINT IF EXISTS external_api_call_raw_check1,
DROP CONSTRAINT IF EXISTS external_api_call_raw_check2,
DROP CONSTRAINT IF EXISTS external_api_call_raw_response_bytes_check;

ALTER TABLE external_api_call_raw
ADD CONSTRAINT external_api_call_raw_response_capture_check CHECK (
  (response_body_bytes IS NULL) = (response_body_text IS NULL)
  AND (response_body_bytes IS NULL) = (response_sha256 IS NULL)
  AND (response_body_bytes IS NULL) = (response_bytes IS NULL)
  AND (response_payload IS NULL OR response_body_bytes IS NOT NULL)
),
ADD CONSTRAINT external_api_call_raw_response_payload_object_check CHECK (
  response_payload IS NULL OR jsonb_typeof(response_payload) = 'object'
),
ADD CONSTRAINT external_api_call_raw_response_size_check CHECK (
  response_bytes IS NULL OR response_bytes BETWEEN 0 AND 67108864
),
ADD CONSTRAINT external_api_call_raw_response_octets_check CHECK (
  response_body_bytes IS NULL OR octet_length(response_body_bytes) = response_bytes
);

COMMENT ON COLUMN external_api_call_raw.response_body_bytes IS
  'Authoritative byte-for-byte provider response. response_body_text is a decoded convenience copy and response_payload is populated only for valid JSON objects.';
