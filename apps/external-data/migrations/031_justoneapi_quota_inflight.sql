ALTER TABLE justoneapi_token_endpoint_quota
  ADD COLUMN inflight_calls bigint NOT NULL DEFAULT 0 CHECK (inflight_calls>=0),
  ADD COLUMN last_dispatched_at timestamptz;

CREATE FUNCTION justoneapi_guard_dispatch_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.raw_call_id<>OLD.raw_call_id OR NEW.tenant_id<>OLD.tenant_id
     OR NEW.workspace_id<>OLD.workspace_id OR NEW.execution_id<>OLD.execution_id
     OR NEW.created_at<>OLD.created_at OR OLD.state<>'active'
     OR NEW.state NOT IN ('completed','failed','unknown') THEN
    RAISE EXCEPTION 'Invalid JustOneAPI execution mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER justoneapi_dispatch_update_guard BEFORE UPDATE ON justoneapi_dispatch
  FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_dispatch_update();
REVOKE ALL ON FUNCTION justoneapi_guard_dispatch_update() FROM PUBLIC;
