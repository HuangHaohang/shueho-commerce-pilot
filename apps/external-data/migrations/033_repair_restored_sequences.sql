-- Restored rows may carry explicit IDs while sequence state still starts low.
-- Block writers, move only forwards, and preserve every existing source/audit row.
DO $$
DECLARE
  table_name text;
  sequence_name regclass;
  maximum_id bigint;
  sequence_value bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['index_outbox', 'service_audit_event'] LOOP
    EXECUTE format('LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE', table_name);
    sequence_name := pg_get_serial_sequence(table_name, 'id')::regclass;
    IF sequence_name IS NULL THEN
      RAISE EXCEPTION 'Missing identity sequence for %', table_name;
    END IF;
    EXECUTE format('SELECT max(id) FROM %I', table_name) INTO maximum_id;
    EXECUTE format('SELECT last_value FROM %s', sequence_name) INTO sequence_value;
    IF maximum_id IS NOT NULL AND maximum_id >= sequence_value THEN
      PERFORM setval(sequence_name, maximum_id, true);
    END IF;
  END LOOP;
END;
$$;
