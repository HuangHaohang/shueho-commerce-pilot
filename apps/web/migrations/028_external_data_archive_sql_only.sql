DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    REVOKE DELETE ON commerce_external_data_archive FROM commerce_pilot_app;
  END IF;
END;
$$;

UPDATE commerce_enterprise_role
SET allowed_permissions = ARRAY(
      SELECT permission
      FROM unnest(allowed_permissions) AS permission
      WHERE permission NOT IN (
        'external_data.archive.read',
        'external_data.archive.export',
        'external_data.archive.delete'
      )
      ORDER BY permission
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE allowed_permissions && ARRAY[
  'external_data.archive.read',
  'external_data.archive.export',
  'external_data.archive.delete'
]::text[];

COMMENT ON TABLE commerce_external_data_archive IS
  'SQL-only independent raw JustOneAPI request/response archive. No browser or product read API is exposed; thread deletion never cascades to this table.';
