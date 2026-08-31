CREATE OR REPLACE FUNCTION commerce_product_connector_capabilities_valid(value text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL
    AND cardinality(value) BETWEEN 1 AND 32
    AND cardinality(value) = cardinality(ARRAY(SELECT DISTINCT item FROM unnest(value) AS item))
    AND NOT EXISTS (
      SELECT 1 FROM unnest(value) AS item
      WHERE item !~ '^[a-z][a-z0-9_.-]{0,79}$'
    );
$$;

CREATE OR REPLACE FUNCTION commerce_product_connector_schema_is_closed(schema_document jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  declared_type text;
  property_key text;
  property_schema jsonb;
  required_key text;
BEGIN
  IF schema_document IS NULL OR jsonb_typeof(schema_document) <> 'object' THEN
    RETURN false;
  END IF;
  IF schema_document ?| ARRAY[
    '$ref', '$dynamicRef', 'oneOf', 'anyOf', 'allOf', 'not',
    'patternProperties', 'dependentSchemas', 'unevaluatedProperties'
  ] THEN
    RETURN false;
  END IF;
  declared_type := schema_document ->> 'type';
  IF declared_type = 'object' THEN
    IF schema_document -> 'additionalProperties' IS DISTINCT FROM 'false'::jsonb
       OR jsonb_typeof(COALESCE(schema_document -> 'properties', '{}'::jsonb)) <> 'object'
       OR jsonb_typeof(COALESCE(schema_document -> 'required', '[]'::jsonb)) <> 'array' THEN
      RETURN false;
    END IF;
    FOR property_key, property_schema IN
      SELECT key, value FROM jsonb_each(COALESCE(schema_document -> 'properties', '{}'::jsonb))
    LOOP
      IF property_key ~* '(password|passwd|token|secret|credential|api[_-]?key|connection[_-]?string|dsn|private[_-]?key)'
         OR NOT commerce_product_connector_schema_is_closed(property_schema) THEN
        RETURN false;
      END IF;
    END LOOP;
    FOR required_key IN
      SELECT jsonb_array_elements_text(COALESCE(schema_document -> 'required', '[]'::jsonb))
    LOOP
      IF NOT COALESCE(schema_document -> 'properties', '{}'::jsonb) ? required_key THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF declared_type = 'array' THEN
    RETURN schema_document ? 'items'
      AND commerce_product_connector_schema_is_closed(schema_document -> 'items');
  END IF;
  RETURN declared_type IN ('string', 'number', 'integer', 'boolean', 'null');
END;
$$;

CREATE OR REPLACE FUNCTION commerce_product_connector_public_value_safe(value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  member_key text;
  member_value jsonb;
  text_value text;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) = 'null' THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(value) = 'object' THEN
    FOR member_key, member_value IN SELECT key, jsonb_each.value FROM jsonb_each(value)
    LOOP
      IF member_key ~* '(password|passwd|token|secret|credential|api[_-]?key|connection[_-]?string|dsn|private[_-]?key)'
         OR NOT commerce_product_connector_public_value_safe(member_value) THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF jsonb_typeof(value) = 'array' THEN
    FOR member_value IN SELECT jsonb_array_elements(value)
    LOOP
      IF NOT commerce_product_connector_public_value_safe(member_value) THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF jsonb_typeof(value) <> 'string' THEN
    RETURN true;
  END IF;
  text_value := value #>> '{}';
  RETURN text_value !~* '^\s*bearer\s+'
    AND text_value !~* '^\s*(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|mssql|jdbc):'
    AND text_value !~* '^[[:space:]]*-----BEGIN[[:space:]].*PRIVATE KEY-----'
    AND text_value !~* '^[[:space:]]*(sk|pk)_[A-Za-z0-9_-]{20,}[[:space:]]*$'
    AND text_value !~* '^[[:space:]]*https?://[^/@[:space:]]+:[^/@[:space:]]+@'
    AND text_value !~* '(password|passwd|token|authorization)[[:space:]]*[:=]'
    AND text_value !~* '(^|;)[[:space:]]*(host|server|data[[:space:]_]*source|initial[[:space:]_]*catalog)[[:space:]]*=';
END;
$$;

CREATE OR REPLACE FUNCTION commerce_product_connector_config_matches(
  schema_document jsonb,
  config_value jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  declared_type text;
  member_key text;
  member_value jsonb;
  required_key text;
BEGIN
  IF NOT commerce_product_connector_schema_is_closed(schema_document)
     OR NOT commerce_product_connector_public_value_safe(config_value) THEN
    RETURN false;
  END IF;
  IF schema_document ? 'enum'
     AND (
       jsonb_typeof(schema_document -> 'enum') <> 'array'
       OR NOT (schema_document -> 'enum') @> jsonb_build_array(config_value)
     ) THEN
    RETURN false;
  END IF;
  declared_type := schema_document ->> 'type';
  IF declared_type = 'object' THEN
    IF jsonb_typeof(config_value) <> 'object' THEN
      RETURN false;
    END IF;
    FOR member_key, member_value IN SELECT key, jsonb_each.value FROM jsonb_each(config_value)
    LOOP
      IF NOT (schema_document -> 'properties') ? member_key
         OR NOT commerce_product_connector_config_matches(
           schema_document -> 'properties' -> member_key,
           member_value
         ) THEN
        RETURN false;
      END IF;
    END LOOP;
    FOR required_key IN SELECT jsonb_array_elements_text(schema_document -> 'required')
    LOOP
      IF NOT config_value ? required_key THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF declared_type = 'array' THEN
    IF jsonb_typeof(config_value) <> 'array' THEN
      RETURN false;
    END IF;
    FOR member_value IN SELECT jsonb_array_elements(config_value)
    LOOP
      IF NOT commerce_product_connector_config_matches(schema_document -> 'items', member_value) THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF declared_type = 'string' THEN RETURN jsonb_typeof(config_value) = 'string'; END IF;
  IF declared_type = 'number' THEN RETURN jsonb_typeof(config_value) = 'number'; END IF;
  IF declared_type = 'integer' THEN
    RETURN jsonb_typeof(config_value) = 'number' AND config_value::text ~ '^-?[0-9]+$';
  END IF;
  IF declared_type = 'boolean' THEN RETURN jsonb_typeof(config_value) = 'boolean'; END IF;
  RETURN declared_type = 'null' AND jsonb_typeof(config_value) = 'null';
END;
$$;

CREATE TABLE IF NOT EXISTS commerce_product_connector_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_key text NOT NULL CHECK (connector_key ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  version text NOT NULL CHECK (version ~ '^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$'),
  source_kind text NOT NULL CHECK (source_kind IN ('file_upload', 'rest_api', 'database', 'erp', 'pim')),
  adapter_key text NOT NULL CHECK (adapter_key ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  public_config_schema jsonb NOT NULL,
  config_schema_hash text NOT NULL CHECK (config_schema_hash ~ '^[a-f0-9]{64}$'),
  capabilities text[] NOT NULL,
  requires_secret boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('active', 'unavailable', 'deprecated')),
  source text NOT NULL DEFAULT 'application_migration' CHECK (source = 'application_migration'),
  receipt_sha256 text NOT NULL CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (connector_key, version),
  UNIQUE (id, source_kind),
  CHECK (commerce_product_connector_schema_is_closed(public_config_schema)),
  CHECK (commerce_product_connector_public_value_safe(public_config_schema)),
  CHECK (commerce_product_connector_capabilities_valid(capabilities)),
  CHECK (config_schema_hash = encode(digest(public_config_schema::text, 'sha256'), 'hex')),
  CHECK (receipt_sha256 = encode(digest(
    concat_ws('|', connector_key, version, source_kind, adapter_key,
      public_config_schema::text, array_to_string(capabilities, ','),
      requires_secret::text, status),
    'sha256'
  ), 'hex'))
);

CREATE INDEX IF NOT EXISTS commerce_product_connector_definition_lookup_idx
ON commerce_product_connector_definition (source_kind, status, connector_key, version);

DROP TRIGGER IF EXISTS commerce_product_connector_definition_immutable
ON commerce_product_connector_definition;
CREATE TRIGGER commerce_product_connector_definition_immutable
BEFORE UPDATE OR DELETE ON commerce_product_connector_definition
FOR EACH ROW EXECUTE FUNCTION commerce_product_reject_immutable_mutation();

WITH definitions(
  connector_key, version, source_kind, adapter_key, display_name, description,
  public_config_schema, capabilities, requires_secret, status
) AS (
  VALUES
    (
      'file_upload', '1.0.0', 'file_upload', 'file_upload_v1',
      '文件上传', '应用托管的 CSV/JSON 快照导入；文件内容进入不可变原始记录层。',
      '{"type":"object","additionalProperties":false,"properties":{},"required":[]}'::jsonb,
      ARRAY['import_snapshot','schema_profile']::text[], false, 'active'
    ),
    (
      'managed_rest', '1.0.0', 'rest_api', 'managed_rest_v1',
      'REST API', '预留的应用托管 JSON 拉取连接器；运行时适配器上线前不可执行。',
      '{"type":"object","additionalProperties":false,"properties":{"connectionProfile":{"type":"string"},"resource":{"type":"string"}},"required":["connectionProfile","resource"]}'::jsonb,
      ARRAY['connection_test','pull_sync','incremental_cursor']::text[], true, 'unavailable'
    ),
    (
      'postgres_readonly', '1.0.0', 'database', 'postgres_readonly_v1',
      'PostgreSQL 只读连接', '应用托管的 PostgreSQL 只读数据集连接器；浏览器不接受主机或连接字符串。',
      '{"type":"object","additionalProperties":false,"properties":{"schema":{"type":"string"},"table":{"type":"string"}},"required":["schema","table"]}'::jsonb,
      ARRAY['connection_test']::text[], true, 'active'
    ),
    (
      'managed_erp', '1.0.0', 'erp', 'managed_erp_v1',
      'ERP', '预留的应用托管 ERP 产品目录连接器；具体厂商适配器上线前不可执行。',
      '{"type":"object","additionalProperties":false,"properties":{"systemProfile":{"type":"string"},"entity":{"type":"string"}},"required":["systemProfile","entity"]}'::jsonb,
      ARRAY['connection_test','pull_sync','incremental_cursor']::text[], true, 'unavailable'
    ),
    (
      'managed_pim', '1.0.0', 'pim', 'managed_pim_v1',
      'PIM', '预留的应用托管 PIM 产品目录连接器；具体厂商适配器上线前不可执行。',
      '{"type":"object","additionalProperties":false,"properties":{"systemProfile":{"type":"string"},"entity":{"type":"string"}},"required":["systemProfile","entity"]}'::jsonb,
      ARRAY['connection_test','pull_sync','incremental_cursor']::text[], true, 'unavailable'
    )
)
INSERT INTO commerce_product_connector_definition (
  connector_key, version, source_kind, adapter_key, display_name, description,
  public_config_schema, config_schema_hash, capabilities, requires_secret,
  status, source, receipt_sha256
)
SELECT connector_key, version, source_kind, adapter_key, display_name, description,
       public_config_schema,
       encode(digest(public_config_schema::text, 'sha256'), 'hex'),
       capabilities, requires_secret, status, 'application_migration',
       encode(digest(
         concat_ws('|', connector_key, version, source_kind, adapter_key,
           public_config_schema::text, array_to_string(capabilities, ','),
           requires_secret::text, status),
         'sha256'
       ), 'hex')
FROM definitions
ON CONFLICT (connector_key, version) DO NOTHING;

ALTER TABLE commerce_product_source
  ADD COLUMN IF NOT EXISTS connector_definition_id uuid,
  ADD COLUMN IF NOT EXISTS config_schema_hash text,
  ADD COLUMN IF NOT EXISTS connection_state text NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN IF NOT EXISTS creation_idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS last_test_receipt_id uuid,
  ADD COLUMN IF NOT EXISTS last_sync_receipt_id uuid;

ALTER TABLE commerce_product_source
  DROP CONSTRAINT IF EXISTS commerce_product_source_credential_ref_check,
  DROP CONSTRAINT IF EXISTS commerce_product_source_config_schema_hash_check,
  DROP CONSTRAINT IF EXISTS commerce_product_source_connection_state_check,
  DROP CONSTRAINT IF EXISTS commerce_product_source_connector_definition_fk,
  DROP CONSTRAINT IF EXISTS commerce_product_source_public_config_safe_check;

ALTER TABLE commerce_product_source
  ADD CONSTRAINT commerce_product_source_credential_ref_check CHECK (
    credential_ref IS NULL OR credential_ref ~
      '^(env:COMMERCE_PRODUCT_SOURCE_[A-Z0-9_]{1,64}|broker:[a-z0-9][a-z0-9_.-]{1,127})$'
  ),
  ADD CONSTRAINT commerce_product_source_config_schema_hash_check CHECK (
    config_schema_hash IS NULL OR config_schema_hash ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT commerce_product_source_connection_state_check CHECK (
    connection_state IN (
      'unconfigured', 'untested', 'testing', 'ready',
      'syncing', 'paused', 'unavailable', 'error', 'disabled'
    )
  ),
  ADD CONSTRAINT commerce_product_source_connector_definition_fk
    FOREIGN KEY (connector_definition_id)
    REFERENCES commerce_product_connector_definition(id) ON DELETE RESTRICT,
  ADD CONSTRAINT commerce_product_source_public_config_safe_check CHECK (
    commerce_product_connector_public_value_safe(public_config)
  );

CREATE UNIQUE INDEX IF NOT EXISTS commerce_product_source_creation_idempotency_idx
ON commerce_product_source (tenant_id, workspace_id, creation_idempotency_key)
WHERE creation_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS commerce_product_source_connector_state_idx
ON commerce_product_source
  (tenant_id, workspace_id, connector_definition_id, connection_state, updated_at DESC);

UPDATE commerce_product_source source
SET connector_definition_id = definition.id,
    connector_key = definition.connector_key,
    connector_version = definition.version,
    config_schema_hash = definition.config_schema_hash,
    connection_state = 'ready',
    public_config = '{}'::jsonb
FROM commerce_product_connector_definition definition
WHERE source.source_kind = 'file_upload'
  AND source.connector_definition_id IS NULL
  AND definition.connector_key = 'file_upload'
  AND definition.version = '1.0.0';

CREATE TABLE IF NOT EXISTS commerce_product_source_operation_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  connector_definition_id uuid NOT NULL REFERENCES commerce_product_connector_definition(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('test', 'sync')),
  idempotency_key uuid NOT NULL,
  state text NOT NULL DEFAULT 'running'
    CHECK (state IN ('running', 'succeeded', 'failed', 'unavailable', 'unknown')),
  result_code text CHECK (result_code IS NULL OR result_code ~ '^[A-Z][A-Z0-9_.-]{1,79}$'),
  result_message text CHECK (
    result_message IS NULL OR (
      char_length(result_message) BETWEEN 1 AND 1000
      AND commerce_product_connector_public_value_safe(to_jsonb(result_message))
    )
  ),
  proof jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(proof) = 'object' AND commerce_product_connector_public_value_safe(proof)),
  records_seen integer NOT NULL DEFAULT 0 CHECK (records_seen BETWEEN 0 AND 10000000),
  records_imported integer NOT NULL DEFAULT 0 CHECK (records_imported BETWEEN 0 AND 10000000),
  records_rejected integer NOT NULL DEFAULT 0 CHECK (records_rejected BETWEEN 0 AND 10000000),
  import_run_id uuid,
  audit_event_id bigint REFERENCES commerce_enterprise_audit_event(id) ON DELETE RESTRICT,
  root_thread_id text CHECK (
    root_thread_id IS NULL OR (char_length(root_thread_id) BETWEEN 8 AND 128 AND root_thread_id ~ '^[A-Za-z0-9_-]+$')
  ),
  turn_id text CHECK (
    turn_id IS NULL OR (char_length(turn_id) BETWEEN 8 AND 128 AND turn_id ~ '^[A-Za-z0-9_-]+$')
  ),
  tool_call_id text CHECK (
    tool_call_id IS NULL OR (char_length(tool_call_id) BETWEEN 1 AND 128 AND tool_call_id ~ '^[A-Za-z0-9_-]+$')
  ),
  created_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  reserved_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, id, source_id),
  UNIQUE (tenant_id, workspace_id, source_id, operation, idempotency_key),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, source_id)
    REFERENCES commerce_product_source(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, import_run_id)
    REFERENCES commerce_product_import_run(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (records_imported + records_rejected <= records_seen),
  CHECK (operation = 'sync' OR (import_run_id IS NULL AND records_seen = 0 AND records_imported = 0 AND records_rejected = 0)),
  CHECK (
    (state = 'running' AND completed_at IS NULL AND result_code IS NULL
      AND result_message IS NULL AND proof = '{}'::jsonb
      AND records_seen = 0 AND records_imported = 0 AND records_rejected = 0
      AND import_run_id IS NULL AND audit_event_id IS NULL)
    OR
    (state <> 'running' AND completed_at IS NOT NULL AND audit_event_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS commerce_product_source_operation_receipt_scope_idx
ON commerce_product_source_operation_receipt
  (tenant_id, workspace_id, source_id, operation, reserved_at DESC);

CREATE INDEX IF NOT EXISTS commerce_product_source_operation_receipt_running_idx
ON commerce_product_source_operation_receipt
  (tenant_id, workspace_id, operation, reserved_at, id)
WHERE state = 'running';

ALTER TABLE commerce_product_source
  ADD CONSTRAINT commerce_product_source_last_test_receipt_fk
    FOREIGN KEY (tenant_id, workspace_id, last_test_receipt_id, id)
    REFERENCES commerce_product_source_operation_receipt(tenant_id, workspace_id, id, source_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT commerce_product_source_last_sync_receipt_fk
    FOREIGN KEY (tenant_id, workspace_id, last_sync_receipt_id, id)
    REFERENCES commerce_product_source_operation_receipt(tenant_id, workspace_id, id, source_id)
    ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION commerce_product_source_connector_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  definition commerce_product_connector_definition%ROWTYPE;
  receipt_operation text;
  receipt_time timestamptz;
  prior_receipt_time timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id <> OLD.tenant_id OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.id <> OLD.id OR NEW.source_kind <> OLD.source_kind
       OR NEW.created_by_user_id <> OLD.created_by_user_id
       OR NEW.creation_idempotency_key IS DISTINCT FROM OLD.creation_idempotency_key THEN
      RAISE EXCEPTION 'product source connection identity is immutable';
    END IF;
    IF NOT (
      NEW.connection_state = OLD.connection_state
      OR (OLD.connection_state = 'unconfigured' AND NEW.connection_state IN ('untested', 'unavailable', 'disabled'))
      OR (OLD.connection_state = 'untested' AND NEW.connection_state IN ('testing', 'unavailable', 'paused', 'disabled'))
      OR (OLD.connection_state = 'testing' AND NEW.connection_state IN ('untested', 'ready', 'unavailable', 'error', 'disabled'))
      OR (OLD.connection_state = 'ready' AND NEW.connection_state IN ('testing', 'syncing', 'paused', 'error', 'disabled'))
      OR (OLD.connection_state = 'syncing' AND NEW.connection_state IN ('ready', 'paused', 'error', 'disabled'))
      OR (OLD.connection_state = 'paused' AND NEW.connection_state IN ('untested', 'testing', 'ready', 'disabled'))
      OR (OLD.connection_state = 'unavailable' AND NEW.connection_state IN ('testing', 'untested', 'disabled'))
      OR (OLD.connection_state = 'error' AND NEW.connection_state IN ('untested', 'testing', 'paused', 'disabled'))
    ) THEN
      RAISE EXCEPTION 'invalid product source connection transition % -> %', OLD.connection_state, NEW.connection_state;
    END IF;
    IF (
      NEW.connector_definition_id IS DISTINCT FROM OLD.connector_definition_id
      OR NEW.public_config IS DISTINCT FROM OLD.public_config
      OR NEW.credential_ref IS DISTINCT FROM OLD.credential_ref
      OR NEW.config_schema_hash IS DISTINCT FROM OLD.config_schema_hash
    ) AND NEW.connection_state NOT IN ('unconfigured', 'untested', 'testing', 'unavailable', 'disabled') THEN
      RAISE EXCEPTION 'connector configuration changes must return the source to a non-ready state';
    END IF;
  END IF;

  IF NEW.connector_definition_id IS NULL THEN
    IF NEW.connection_state NOT IN ('unconfigured', 'disabled') THEN
      RAISE EXCEPTION 'a configured product source requires an application connector definition';
    END IF;
  ELSE
    SELECT * INTO definition
    FROM commerce_product_connector_definition
    WHERE id = NEW.connector_definition_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'product connector definition does not exist'; END IF;
    IF definition.source_kind <> NEW.source_kind
       OR NEW.connector_key IS DISTINCT FROM definition.connector_key
       OR NEW.connector_version IS DISTINCT FROM definition.version
       OR NEW.config_schema_hash IS DISTINCT FROM definition.config_schema_hash THEN
      RAISE EXCEPTION 'product source connector identity does not match its immutable definition';
    END IF;
    IF definition.status <> 'active' AND NEW.connection_state NOT IN ('unconfigured', 'unavailable', 'disabled') THEN
      RAISE EXCEPTION 'product connector definition is not executable';
    END IF;
    IF definition.requires_secret AND NEW.credential_ref IS NULL THEN
      RAISE EXCEPTION 'product connector requires an application secret reference';
    END IF;
    IF NOT commerce_product_connector_config_matches(definition.public_config_schema, NEW.public_config) THEN
      RAISE EXCEPTION 'product connector public configuration violates its closed schema';
    END IF;
  END IF;

  IF NEW.last_test_receipt_id IS NOT NULL THEN
    SELECT operation, reserved_at INTO receipt_operation, receipt_time
    FROM commerce_product_source_operation_receipt
    WHERE tenant_id = NEW.tenant_id AND workspace_id = NEW.workspace_id
      AND id = NEW.last_test_receipt_id AND source_id = NEW.id;
    IF receipt_operation IS DISTINCT FROM 'test' THEN
      RAISE EXCEPTION 'last test receipt does not belong to this source and operation';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.last_test_receipt_id IS NOT NULL
       AND NEW.last_test_receipt_id IS DISTINCT FROM OLD.last_test_receipt_id THEN
      SELECT reserved_at INTO prior_receipt_time
      FROM commerce_product_source_operation_receipt WHERE id = OLD.last_test_receipt_id;
      IF receipt_time < prior_receipt_time THEN RAISE EXCEPTION 'last test receipt cannot move backwards'; END IF;
    END IF;
  END IF;
  IF NEW.last_sync_receipt_id IS NOT NULL THEN
    SELECT operation, reserved_at INTO receipt_operation, receipt_time
    FROM commerce_product_source_operation_receipt
    WHERE tenant_id = NEW.tenant_id AND workspace_id = NEW.workspace_id
      AND id = NEW.last_sync_receipt_id AND source_id = NEW.id;
    IF receipt_operation IS DISTINCT FROM 'sync' THEN
      RAISE EXCEPTION 'last sync receipt does not belong to this source and operation';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.last_sync_receipt_id IS NOT NULL
       AND NEW.last_sync_receipt_id IS DISTINCT FROM OLD.last_sync_receipt_id THEN
      SELECT reserved_at INTO prior_receipt_time
      FROM commerce_product_source_operation_receipt WHERE id = OLD.last_sync_receipt_id;
      IF receipt_time < prior_receipt_time THEN RAISE EXCEPTION 'last sync receipt cannot move backwards'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION commerce_product_source_operation_receipt_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_definition_id uuid;
  source_state text;
  source_status text;
  definition_capabilities text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'product source operation receipts are append-only';
  END IF;
  SELECT source.connector_definition_id, source.connection_state, source.status, definition.capabilities
    INTO source_definition_id, source_state, source_status, definition_capabilities
  FROM commerce_product_source source
  JOIN commerce_product_connector_definition definition
    ON definition.id = source.connector_definition_id
  WHERE source.tenant_id = NEW.tenant_id
    AND source.workspace_id = NEW.workspace_id
    AND source.id = NEW.source_id;
  IF NOT FOUND OR source_definition_id IS DISTINCT FROM NEW.connector_definition_id THEN
    RAISE EXCEPTION 'operation receipt connector does not match its product source';
  END IF;
  IF source_status <> 'active' THEN
    RAISE EXCEPTION 'only active product sources can reserve connector operations';
  END IF;
  IF source_state = 'disabled' THEN
    RAISE EXCEPTION 'disabled product sources cannot reserve connector operations';
  END IF;
  IF NEW.operation = 'sync' AND source_state <> 'ready' THEN
    RAISE EXCEPTION 'product source synchronization requires a ready connection';
  END IF;
  IF (NEW.operation = 'test' AND NOT ('connection_test' = ANY(definition_capabilities)))
     OR (NEW.operation = 'sync' AND NOT ('pull_sync' = ANY(definition_capabilities))) THEN
    RAISE EXCEPTION 'connector definition does not declare the requested operation capability';
  END IF;
  IF NEW.state <> 'running' AND NOT EXISTS (
      SELECT 1 FROM commerce_enterprise_audit_event audit
      WHERE audit.id = NEW.audit_event_id
        AND audit.tenant_id = NEW.tenant_id
        AND audit.workspace_id = NEW.workspace_id
    ) THEN
    RAISE EXCEPTION 'terminal operation receipt requires same-scope audit lineage';
  END IF;
  IF NEW.import_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM commerce_product_import_run import_run
    WHERE import_run.tenant_id = NEW.tenant_id
      AND import_run.workspace_id = NEW.workspace_id
      AND import_run.id = NEW.import_run_id
      AND import_run.source_id = NEW.source_id
  ) THEN
    RAISE EXCEPTION 'sync receipt import run does not belong to its product source';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state <> 'running' THEN
      RAISE EXCEPTION 'terminal product source operation receipts are immutable';
    END IF;
    IF NEW.tenant_id <> OLD.tenant_id OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.source_id <> OLD.source_id
       OR NEW.connector_definition_id <> OLD.connector_definition_id
       OR NEW.operation <> OLD.operation OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.root_thread_id IS DISTINCT FROM OLD.root_thread_id
       OR NEW.turn_id IS DISTINCT FROM OLD.turn_id
       OR NEW.tool_call_id IS DISTINCT FROM OLD.tool_call_id
       OR NEW.created_by_user_id <> OLD.created_by_user_id
       OR NEW.reserved_at <> OLD.reserved_at THEN
      RAISE EXCEPTION 'product source operation receipt identity is immutable';
    END IF;
    IF NEW.state NOT IN ('succeeded', 'failed', 'unavailable', 'unknown') THEN
      RAISE EXCEPTION 'invalid product source operation transition running -> %', NEW.state;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION commerce_product_source_project_receipt_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE commerce_product_source
  SET last_test_receipt_id = CASE WHEN NEW.operation = 'test' THEN NEW.id ELSE last_test_receipt_id END,
      last_sync_receipt_id = CASE WHEN NEW.operation = 'sync' THEN NEW.id ELSE last_sync_receipt_id END,
      connection_state = CASE
        WHEN NEW.state = 'running' AND NEW.operation = 'test' THEN 'testing'
        WHEN NEW.state = 'running' AND NEW.operation = 'sync' THEN 'syncing'
        WHEN NEW.state = 'succeeded' THEN 'ready'
        WHEN NEW.state = 'unavailable' THEN 'unavailable'
        ELSE 'error'
      END
  WHERE tenant_id = NEW.tenant_id AND workspace_id = NEW.workspace_id AND id = NEW.source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product source disappeared during operation receipt projection'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commerce_product_source_connector_guard
ON commerce_product_source;
CREATE TRIGGER commerce_product_source_connector_guard
BEFORE INSERT OR UPDATE ON commerce_product_source
FOR EACH ROW EXECUTE FUNCTION commerce_product_source_connector_guard();

DROP TRIGGER IF EXISTS commerce_product_source_operation_receipt_guard
ON commerce_product_source_operation_receipt;
CREATE TRIGGER commerce_product_source_operation_receipt_guard
BEFORE INSERT OR UPDATE OR DELETE ON commerce_product_source_operation_receipt
FOR EACH ROW EXECUTE FUNCTION commerce_product_source_operation_receipt_guard();

DROP TRIGGER IF EXISTS commerce_product_source_operation_receipt_project_state
ON commerce_product_source_operation_receipt;
CREATE TRIGGER commerce_product_source_operation_receipt_project_state
AFTER INSERT OR UPDATE OF state ON commerce_product_source_operation_receipt
FOR EACH ROW EXECUTE FUNCTION commerce_product_source_project_receipt_state();

ALTER TABLE commerce_product_source_operation_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_product_source_operation_receipt FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_product_source_operation_receipt_isolation
ON commerce_product_source_operation_receipt;
CREATE POLICY commerce_product_source_operation_receipt_isolation
ON commerce_product_source_operation_receipt
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
);

REVOKE ALL ON commerce_product_connector_definition,
  commerce_product_source_operation_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_connector_capabilities_valid(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_connector_schema_is_closed(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_connector_public_value_safe(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_connector_config_matches(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_source_connector_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_source_operation_receipt_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_source_project_receipt_state() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT ON commerce_product_connector_definition TO commerce_pilot_app;
    GRANT SELECT, INSERT, UPDATE ON commerce_product_source_operation_receipt TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_product_connector_capabilities_valid(text[]) TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_product_connector_schema_is_closed(jsonb) TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_product_connector_public_value_safe(jsonb) TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_product_connector_config_matches(jsonb, jsonb) TO commerce_pilot_app;
  END IF;
END;
$$;

COMMENT ON TABLE commerce_product_connector_definition IS
  'Application-managed immutable connector master-data revisions. Runtime roles may read but never create, update, or delete definitions.';
COMMENT ON COLUMN commerce_product_connector_definition.public_config_schema IS
  'Closed, local, non-referential JSON schema for non-secret connection configuration; secret-shaped property names are forbidden.';
COMMENT ON COLUMN commerce_product_source.credential_ref IS
  'Opaque secret-manager reference only: env:COMMERCE_PRODUCT_SOURCE_* or broker:<safe-id>. Passwords, tokens, and connection strings are forbidden.';
COMMENT ON COLUMN commerce_product_source.public_config IS
  'Non-secret configuration validated against the immutable connector definition. Unknown keys and secret-shaped values fail closed.';
COMMENT ON TABLE commerce_product_source_operation_receipt IS
  'Tenant/workspace-scoped idempotent connection-test and synchronization lifecycle. Running reservations transition once to a terminal immutable receipt with audit lineage; raw credentials and connection strings are never stored.';
