DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT DELETE ON commerce_creative_canvas_node TO commerce_pilot_app;
  END IF;
END;
$$;

COMMENT ON TABLE commerce_creative_canvas_node IS
  'Application-owned commerce canvas nodes bound to immutable Codex Harness source items. Reconciliation may delete obsolete unedited projections; user revisions are retained.';
