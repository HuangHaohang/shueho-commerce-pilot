CREATE TABLE IF NOT EXISTS commerce_creative_canvas_node (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('agent_message', 'image_generation', 'manual')),
  source_item_id text NOT NULL CHECK (char_length(source_item_id) BETWEEN 1 AND 512),
  source_block_key text NOT NULL DEFAULT 'primary'
    CHECK (source_block_key ~ '^[A-Za-z0-9_-]{1,80}$'),
  source_turn_id text CHECK (source_turn_id IS NULL OR char_length(source_turn_id) BETWEEN 8 AND 128),
  source_sequence integer NOT NULL DEFAULT 0 CHECK (source_sequence >= 0),
  message_item_id text CHECK (message_item_id IS NULL OR char_length(message_item_id) BETWEEN 1 AND 512),
  node_type text NOT NULL CHECK (node_type IN ('document', 'image', 'table')),
  deliverable_type text CHECK (
    deliverable_type IS NULL OR deliverable_type IN (
      'listing_copy', 'promotion_copy', 'main_image', 'gallery_images',
      'detail_page', 'shooting_script', 'video_storyboard'
    )
  ),
  channel text CHECK (channel IS NULL OR char_length(channel) <= 80),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (
    tenant_id, workspace_id, user_id, thread_id,
    source_kind, source_item_id, source_block_key
  ),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, thread_id)
    REFERENCES commerce_agent_thread(tenant_id, workspace_id, thread_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_creative_canvas_node_thread_sequence_idx
ON commerce_creative_canvas_node (
  tenant_id, workspace_id, user_id, thread_id, source_sequence, created_at
);

CREATE TABLE IF NOT EXISTS commerce_creative_canvas_node_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  node_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 1000000),
  origin text NOT NULL CHECK (origin IN ('harness', 'user')),
  content jsonb NOT NULL CHECK (
    jsonb_typeof(content) = 'object'
    AND octet_length(content::text) <= 262144
  ),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, node_id, revision),
  UNIQUE (tenant_id, workspace_id, node_id, content_sha256),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, thread_id)
    REFERENCES commerce_agent_thread(tenant_id, workspace_id, thread_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, node_id)
    REFERENCES commerce_creative_canvas_node(tenant_id, workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_creative_canvas_revision_node_idx
ON commerce_creative_canvas_node_revision (
  tenant_id, workspace_id, node_id, revision DESC
);

CREATE TABLE IF NOT EXISTS commerce_creative_canvas_layout (
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  node_id uuid NOT NULL,
  x double precision NOT NULL CHECK (x BETWEEN -1000000 AND 1000000),
  y double precision NOT NULL CHECK (y BETWEEN -1000000 AND 1000000),
  width double precision NOT NULL CHECK (width BETWEEN 240 AND 1600),
  height double precision NOT NULL CHECK (height BETWEEN 180 AND 1600),
  z_index integer NOT NULL DEFAULT 0 CHECK (z_index BETWEEN -100000 AND 100000),
  locked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (node_id),
  UNIQUE (tenant_id, workspace_id, node_id),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, thread_id)
    REFERENCES commerce_agent_thread(tenant_id, workspace_id, thread_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, node_id)
    REFERENCES commerce_creative_canvas_node(tenant_id, workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS commerce_creative_canvas_message_ref (
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  message_item_id text NOT NULL CHECK (char_length(message_item_id) BETWEEN 1 AND 512),
  node_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, workspace_id, thread_id, message_item_id, node_id),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, thread_id)
    REFERENCES commerce_agent_thread(tenant_id, workspace_id, thread_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, node_id)
    REFERENCES commerce_creative_canvas_node(tenant_id, workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_creative_canvas_message_ref_message_idx
ON commerce_creative_canvas_message_ref (
  tenant_id, workspace_id, user_id, thread_id, message_item_id
);

CREATE TABLE IF NOT EXISTS commerce_creative_canvas_viewport (
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  x double precision NOT NULL DEFAULT 0 CHECK (x BETWEEN -1000000 AND 1000000),
  y double precision NOT NULL DEFAULT 0 CHECK (y BETWEEN -1000000 AND 1000000),
  zoom double precision NOT NULL DEFAULT 1 CHECK (zoom BETWEEN 0.1 AND 4),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, workspace_id, user_id, thread_id),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, thread_id)
    REFERENCES commerce_agent_thread(tenant_id, workspace_id, thread_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION commerce_creative_canvas_node_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.user_id <> OLD.user_id OR NEW.thread_id <> OLD.thread_id
     OR NEW.source_kind <> OLD.source_kind OR NEW.source_item_id <> OLD.source_item_id
     OR NEW.source_block_key <> OLD.source_block_key OR NEW.node_type <> OLD.node_type THEN
    RAISE EXCEPTION 'creative canvas node identity is immutable';
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commerce_creative_canvas_node_identity_guard
ON commerce_creative_canvas_node;
CREATE TRIGGER commerce_creative_canvas_node_identity_guard
BEFORE UPDATE ON commerce_creative_canvas_node
FOR EACH ROW EXECUTE FUNCTION commerce_creative_canvas_node_identity_guard();

DROP TRIGGER IF EXISTS commerce_creative_canvas_layout_updated_at
ON commerce_creative_canvas_layout;
CREATE TRIGGER commerce_creative_canvas_layout_updated_at
BEFORE UPDATE ON commerce_creative_canvas_layout
FOR EACH ROW EXECUTE FUNCTION commerce_set_updated_at();

DROP TRIGGER IF EXISTS commerce_creative_canvas_viewport_updated_at
ON commerce_creative_canvas_viewport;
CREATE TRIGGER commerce_creative_canvas_viewport_updated_at
BEFORE UPDATE ON commerce_creative_canvas_viewport
FOR EACH ROW EXECUTE FUNCTION commerce_set_updated_at();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'commerce_creative_canvas_node',
    'commerce_creative_canvas_node_revision',
    'commerce_creative_canvas_layout',
    'commerce_creative_canvas_message_ref',
    'commerce_creative_canvas_viewport'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_isolation ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_isolation ON %I USING (
        tenant_id = NULLIF(current_setting(''commerce.tenant_id'', true), '''')::uuid
        AND workspace_id = NULLIF(current_setting(''commerce.workspace_id'', true), '''')::uuid
        AND user_id = NULLIF(current_setting(''commerce.user_id'', true), '''')
      ) WITH CHECK (
        tenant_id = NULLIF(current_setting(''commerce.tenant_id'', true), '''')::uuid
        AND workspace_id = NULLIF(current_setting(''commerce.workspace_id'', true), '''')::uuid
        AND user_id = NULLIF(current_setting(''commerce.user_id'', true), '''')
      )',
      table_name, table_name
    );
  END LOOP;
END;
$$;

REVOKE ALL ON
  commerce_creative_canvas_node,
  commerce_creative_canvas_node_revision,
  commerce_creative_canvas_layout,
  commerce_creative_canvas_message_ref,
  commerce_creative_canvas_viewport
FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_creative_canvas_node_identity_guard() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON commerce_creative_canvas_node TO commerce_pilot_app;
    GRANT SELECT, INSERT ON commerce_creative_canvas_node_revision TO commerce_pilot_app;
    GRANT SELECT, INSERT, UPDATE ON commerce_creative_canvas_layout TO commerce_pilot_app;
    GRANT SELECT, INSERT ON commerce_creative_canvas_message_ref TO commerce_pilot_app;
    GRANT SELECT, INSERT, UPDATE ON commerce_creative_canvas_viewport TO commerce_pilot_app;
  END IF;
END;
$$;

COMMENT ON TABLE commerce_creative_canvas_node IS
  'Application-owned commerce canvas nodes bound to immutable Codex Harness source items.';
COMMENT ON TABLE commerce_creative_canvas_node_revision IS
  'Append-only Harness snapshots and user edits for canvas assets; conversation history remains App Server-owned.';
COMMENT ON TABLE commerce_creative_canvas_message_ref IS
  'Authoritative mapping from persisted Harness agentMessage items to application-owned canvas nodes.';
