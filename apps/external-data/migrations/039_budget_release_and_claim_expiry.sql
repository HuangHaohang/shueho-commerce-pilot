ALTER TABLE research_task_operation ADD COLUMN operation_context jsonb NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION guard_research_task_operation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.state='completed' OR NEW.state<>'completed' OR
  (to_jsonb(NEW)-ARRAY['state','result','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result','completed_at'])
 THEN RAISE EXCEPTION 'Task operation history is immutable';END IF;RETURN NEW;END $$;
CREATE FUNCTION queue_research_budget_release(target_task uuid) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE task_row research_task%ROWTYPE; op record; payload jsonb; delivery_id uuid;
BEGIN
 SELECT * INTO task_row FROM research_task WHERE id=target_task;
 IF task_row.state NOT IN ('cancelled','failed','partial','reconciliation_required') THEN RETURN;END IF;
 FOR op IN SELECT * FROM research_task_operation WHERE task_id=target_task AND operation_name='control.reserve' LOOP
  IF op.operation_context ? 'callId' THEN
   payload=jsonb_build_object('kind','cancel_source','source',op.operation_context->>'source','callId',op.operation_context->>'callId');
  ELSIF op.result ? 'reservationId' THEN
   payload=jsonb_build_object('kind','cancel_reservation','reservationId',op.result->>'reservationId');
  ELSE CONTINUE;END IF;
  delivery_id=md5('release:'||target_task::text||':'||op.operation_key)::uuid;
  INSERT INTO research_settlement_outbox(reservation_id,task_id,tenant_id,workspace_id,user_id,payload,payload_hash)
   VALUES(delivery_id,target_task,task_row.tenant_id,task_row.workspace_id,task_row.user_id,payload,encode(digest(payload::text,'sha256'),'hex')) ON CONFLICT DO NOTHING;
 END LOOP;
END $$;
CREATE FUNCTION research_budget_release_trigger() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 IF TG_TABLE_NAME='research_task' THEN PERFORM queue_research_budget_release(NEW.id);ELSE PERFORM queue_research_budget_release(NEW.task_id);END IF;RETURN NEW;END $$;
CREATE TRIGGER research_task_release AFTER UPDATE OF state ON research_task FOR EACH ROW EXECUTE FUNCTION research_budget_release_trigger();
CREATE TRIGGER research_operation_release AFTER INSERT OR UPDATE ON research_task_operation FOR EACH ROW EXECUTE FUNCTION research_budget_release_trigger();
REVOKE ALL ON FUNCTION queue_research_budget_release(uuid),research_budget_release_trigger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION queue_research_budget_release(uuid),research_budget_release_trigger() TO external_data_app;
DO $$ DECLARE task_id uuid;BEGIN
 FOR task_id IN SELECT id FROM research_task WHERE state IN ('cancelled','failed','partial','reconciliation_required') LOOP
  PERFORM queue_research_budget_release(task_id);
 END LOOP;
END $$;

-- New claims carry their fixed issued_at; expired claims cannot become new claims after receipt retention.
ALTER TABLE research_task_claim_receipt ADD COLUMN issued_at timestamptz;
ALTER TABLE research_settlement_claim ADD COLUMN created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,ADD COLUMN issued_at timestamptz;
CREATE FUNCTION claim_research_task_v2(worker_lease uuid,issued_at timestamptz) RETURNS SETOF research_task LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF issued_at<clock_timestamp()-INTERVAL '10 minutes' OR issued_at>clock_timestamp()+INTERVAL '1 minute' THEN RAISE EXCEPTION 'CLAIM_EXPIRED';END IF;
 RETURN QUERY SELECT * FROM claim_research_task(worker_lease);
 UPDATE research_task_claim_receipt r SET issued_at=claim_research_task_v2.issued_at WHERE r.lease_id=worker_lease AND r.issued_at IS NULL;
END $$;
CREATE FUNCTION claim_research_settlement_v2(claim_id uuid,issued_at timestamptz) RETURNS TABLE(reservation_id uuid,task_id uuid,payload jsonb,principal jsonb,lease_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF issued_at<clock_timestamp()-INTERVAL '10 minutes' OR issued_at>clock_timestamp()+INTERVAL '1 minute' THEN RAISE EXCEPTION 'CLAIM_EXPIRED';END IF;
 RETURN QUERY SELECT * FROM claim_research_settlement(claim_id);
 UPDATE research_settlement_claim c SET issued_at=claim_research_settlement_v2.issued_at WHERE c.id=claim_id AND c.issued_at IS NULL;
END $$;
CREATE FUNCTION clean_research_claim_receipts() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a int;b int;
BEGIN
 DELETE FROM research_task_claim_receipt WHERE issued_at IS NOT NULL AND issued_at<clock_timestamp()-INTERVAL '1 day';GET DIAGNOSTICS a=ROW_COUNT;
 DELETE FROM research_settlement_claim WHERE issued_at IS NOT NULL AND issued_at<clock_timestamp()-INTERVAL '1 day';GET DIAGNOSTICS b=ROW_COUNT;
 RETURN jsonb_build_object('taskReceipts',a,'settlementReceipts',b);
END $$;
REVOKE ALL ON FUNCTION claim_research_task_v2(uuid,timestamptz),claim_research_settlement_v2(uuid,timestamptz),clean_research_claim_receipts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_research_task_v2(uuid,timestamptz),claim_research_settlement_v2(uuid,timestamptz),clean_research_claim_receipts() TO external_data_app;
