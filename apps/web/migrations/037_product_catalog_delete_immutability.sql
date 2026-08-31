CREATE OR REPLACE FUNCTION commerce_product_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Tenant/workspace teardown is an explicit parent-owned lifecycle and must be
  -- able to cascade. A direct row mutation, including by an owner connection,
  -- remains forbidden.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'commerce_product_source_record',
    'commerce_product_revision',
    'commerce_product_variant_revision',
    'commerce_product_field_lineage'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION commerce_product_reject_immutable_mutation()',
      table_name, table_name
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION commerce_product_reject_immutable_mutation() FROM PUBLIC;

COMMENT ON FUNCTION commerce_product_reject_immutable_mutation() IS
  'Rejects direct UPDATE/DELETE on append-only product rows while allowing explicit tenant/workspace parent cascades.';
