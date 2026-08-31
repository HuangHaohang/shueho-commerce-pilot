import nextEnv from "@next/env";
import { config as loadDotenv } from "dotenv";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

import { getAuthDatabase } from "@/lib/auth/database";
import { parseProductImportBuffer } from "@/lib/product-catalog/import-parser";
import { createProductImport, getProduct, inspectProductImport, listProducts } from "@/lib/product-catalog/repository";
import {
  createProductSource,
  listProductConnectors,
  listProductSources,
  testProductSourceConnection,
} from "@/lib/product-catalog/connector-repository";

nextEnv.loadEnvConfig(process.cwd());
loadDotenv({ path: resolve(process.cwd(), ".env.migration"), override: false, quiet: true });

const applicationUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!applicationUrl || !migrationUrl || applicationUrl === migrationUrl) {
  throw new Error("Isolation verification requires distinct DATABASE_URL and MIGRATION_DATABASE_URL values.");
}

const suffix = randomUUID();
const userA = `rls-a-${suffix}`;
const userB = `rls-b-${suffix}`;
const organizationA = randomUUID();
const organizationB = randomUUID();
const tenantA = randomUUID();
const tenantB = randomUUID();
const workspaceA1 = randomUUID();
const workspaceA2 = randomUUID();
const workspaceB = randomUUID();
const roleA = randomUUID();
const owner = new Pool({ connectionString: migrationUrl, max: 1 });
const application = new Pool({ connectionString: applicationUrl, max: 1 });

try {
  await createFixtures();
  const role = await application.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  assert(role.rows[0]?.rolsuper === false && role.rows[0]?.rolbypassrls === false, "application role bypasses RLS");
  await verifyEnterpriseSchemaIsolation();

  const deletionClaimClient = await application.connect();
  try {
    await deletionClaimClient.query("BEGIN");
    await deletionClaimClient.query("SAVEPOINT null_tenant_claim");
    let nullTenantClaimRejected = false;
    try {
      await deletionClaimClient.query(`SELECT * FROM commerce_claim_thread_deletion_job(NULL)`);
    } catch {
      nullTenantClaimRejected = true;
      await deletionClaimClient.query("ROLLBACK TO SAVEPOINT null_tenant_claim");
    }
    assert(nullTenantClaimRejected, "thread deletion worker could claim without a tenant pin");
    await deletionClaimClient.query("SELECT set_config('commerce.tenant_id', $1, true)", [tenantA]);
    await deletionClaimClient.query("SAVEPOINT mismatched_tenant_claim");
    let mismatchedTenantClaimRejected = false;
    try {
      await deletionClaimClient.query(`SELECT * FROM commerce_claim_thread_deletion_job($1)`, [tenantB]);
    } catch {
      mismatchedTenantClaimRejected = true;
      await deletionClaimClient.query("ROLLBACK TO SAVEPOINT mismatched_tenant_claim");
    }
    assert(mismatchedTenantClaimRejected, "thread deletion worker could claim another tenant's job");
    const sameTenantClaim = await deletionClaimClient.query(
      `SELECT * FROM commerce_claim_thread_deletion_job($1)`,
      [tenantA],
    );
    assert(sameTenantClaim.rowCount === 0, "empty tenant-pinned deletion claim returned foreign work");
    await deletionClaimClient.query("ROLLBACK");
  } finally {
    deletionClaimClient.release();
  }

  const unscoped = await application.query<{ count: string }>(`SELECT count(*)::text AS count FROM commerce_tenant`);
  assert(unscoped.rows[0]?.count === "0", "unscoped tenant rows were visible");
  const providerPrivileges = await application.query<{
    can_select: boolean;
    can_insert: boolean;
    can_delete_archive: boolean;
    can_read_archive_view: boolean;
  }>(
    `SELECT has_table_privilege(current_user, 'commerce_external_provider_endpoint', 'SELECT') AS can_select,
            has_table_privilege(current_user, 'commerce_external_provider_endpoint', 'INSERT') AS can_insert,
            has_table_privilege(current_user, 'commerce_external_data_archive', 'DELETE') AS can_delete_archive,
            has_table_privilege(current_user, 'commerce_external_data_search_v1_archive', 'SELECT') AS can_read_archive_view`,
  );
  assert(providerPrivileges.rows[0]?.can_select === true, "application role cannot read provider master data");
  assert(providerPrivileges.rows[0]?.can_insert === false, "application role can mutate provider master data");
  assert(providerPrivileges.rows[0]?.can_delete_archive === false, "application role can directly delete SQL-only archives");
  assert(providerPrivileges.rows[0]?.can_read_archive_view === false, "application role can read the SQL-only archive view");
  const connectorPrivileges = await application.query<{
    definition_count: string;
    can_select: boolean;
    can_insert: boolean;
    can_update: boolean;
  }>(
    `SELECT (SELECT count(*)::text FROM commerce_product_connector_definition) AS definition_count,
            has_table_privilege(current_user,'commerce_product_connector_definition','SELECT') AS can_select,
            has_table_privilege(current_user,'commerce_product_connector_definition','INSERT') AS can_insert,
            has_table_privilege(current_user,'commerce_product_connector_definition','UPDATE') AS can_update`,
  );
  assert(connectorPrivileges.rows[0]?.definition_count === "5", "product connector master data is incomplete");
  assert(connectorPrivileges.rows[0]?.can_select === true, "application role cannot read connector master data");
  assert(
    connectorPrivileges.rows[0]?.can_insert === false && connectorPrivileges.rows[0]?.can_update === false,
    "application role can mutate connector master data",
  );
  const secretHandlePrivileges = await application.query<{
    can_read_handle: boolean;
    can_read_env_name: boolean;
    can_insert: boolean;
  }>(
    `SELECT has_column_privilege(current_user,'commerce_product_secret_handle','handle','SELECT') AS can_read_handle,
            has_column_privilege(current_user,'commerce_product_secret_handle','env_name','SELECT') AS can_read_env_name,
            has_table_privilege(current_user,'commerce_product_secret_handle','INSERT') AS can_insert`,
  );
  assert(secretHandlePrivileges.rows[0]?.can_read_handle === true, "application role cannot resolve safe product handles");
  assert(secretHandlePrivileges.rows[0]?.can_read_env_name === false, "application role can directly read secret env bindings");
  assert(secretHandlePrivileges.rows[0]?.can_insert === false, "application role can self-issue product secret handles");
  const operatorProductPermissions = await owner.query<{
    role_count: string;
    missing_import: string;
    overprivileged: string;
  }>(
    `SELECT count(*)::text AS role_count,
            count(*) FILTER (
              WHERE NOT ('product_catalog.import' = ANY(allowed_permissions))
            )::text AS missing_import,
            count(*) FILTER (
              WHERE 'product_catalog.review' = ANY(allowed_permissions)
                 OR 'product_catalog.sources.manage' = ANY(allowed_permissions)
            )::text AS overprivileged
     FROM commerce_enterprise_role
     WHERE is_system AND scope='workspace' AND role_key='workspace_operator'`,
  );
  assert(
    Number.parseInt(operatorProductPermissions.rows[0]?.role_count ?? "0", 10) > 0 &&
      operatorProductPermissions.rows[0]?.missing_import === "0" &&
      operatorProductPermissions.rows[0]?.overprivileged === "0",
    "workspace operator product-import role boundary is inconsistent",
  );

  const selfClient = await application.connect();
  try {
    await selfClient.query("BEGIN");
    await selfClient.query("SELECT set_config('commerce.user_id', $1, true)", [userA]);
    const ownMemberships = await selfClient.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM commerce_tenant_membership WHERE user_id = $1`,
      [userA],
    );
    assert(ownMemberships.rows[0]?.count === "1", "self membership discovery failed");
    const otherMemberships = await selfClient.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM commerce_tenant_membership WHERE user_id = $1`,
      [userB],
    );
    assert(otherMemberships.rows[0]?.count === "0", "another user's membership was visible");
    await selfClient.query("ROLLBACK");
  } finally {
    selfClient.release();
  }

  const scoped = await application.connect();
  try {
    await scoped.query("BEGIN");
    await setScope(scoped, tenantA, workspaceA1, userA, false);
    await scoped.query("SELECT set_config('commerce.organization_id', $1, true)", [organizationA]);
    assert(await count(scoped, `SELECT count(*)::text AS count FROM commerce_tenant`) === 1, "tenant scope leaked");
    assert(await count(scoped, `SELECT count(*)::text AS count FROM commerce_workspace`) === 1, "workspace scope leaked");
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_tenant WHERE id = $1`, [tenantB]) === 0,
      "cross-tenant row was visible",
    );
    assert(await count(scoped, `SELECT count(*)::text AS count FROM commerce_organization`) === 1, "organization scope failed");
    await scoped.query(
      `INSERT INTO commerce_agent_thread
        (thread_id, user_id, created_by_user_id, tenant_id, workspace_id, title, recipe_id, category)
       VALUES ($1, $2, $2, $3, $4, 'RLS verification', 'creative_project', 'creative')`,
      [`thread-${suffix}`, userA, tenantA, workspaceA1],
    );
    assert(
      await count(
        scoped,
        `SELECT count(*)::text AS count
         FROM commerce_agent_thread
         WHERE thread_id = $1 AND recipe_id = 'creative_project' AND category = 'creative'`,
        [`thread-${suffix}`],
      ) === 1,
      "creative-project Recipe identity was not persisted in the owned thread",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_policy`) === 1,
      "external data policy leaked outside the selected workspace",
    );
    const mcpTokenId = randomUUID();
    await scoped.query(
      `INSERT INTO commerce_mcp_access_token
        (id, tenant_id, workspace_id, created_by_user_id, name, token_prefix, token_hash, scopes)
       VALUES ($1, $2, $3, $4, 'RLS token', 'cp_12345678', decode($5, 'hex'),
               ARRAY['external_data.catalog.read']::text[])`,
      [mcpTokenId, tenantA, workspaceA1, userA, "ab".repeat(32)],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_mcp_access_token`) === 1,
      "workspace MCP token was not visible in scope",
    );
    assert(
      await count(
        scoped,
        `SELECT count(*)::text AS count FROM commerce_authenticate_mcp_access_token($1, $2)`,
        ["cp_12345678", "ab".repeat(32)],
      ) === 1,
      "valid MCP token digest did not authenticate",
    );
    assert(
      await count(
        scoped,
        `SELECT count(*)::text AS count FROM commerce_authenticate_mcp_access_token($1, $2)`,
        ["cp_12345678", "ef".repeat(32)],
      ) === 0,
      "invalid MCP token digest authenticated",
    );
    await scoped.query(
      `INSERT INTO commerce_external_data_call
        (tenant_id, workspace_id, user_id, provider, source, root_thread_id,
         thread_id, turn_id, call_id, endpoint_id, platform, parameter_hash,
         requested_approval_mode, approval_state, state)
       VALUES ($1, $2, $3, 'justoneapi', 'codex_harness', $4,
               $4, 'turn-12345678', 'call-12345678', 'taobao.test_v1', 'taobao', $5,
               'always_ask', 'pending', 'reserved')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`, "cd".repeat(32)],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_call`) === 1,
      "external data call ledger was not visible in scope",
    );
    const archiveThreadId = `archive-${suffix}`;
    await scoped.query(
      `INSERT INTO commerce_agent_thread
        (thread_id, user_id, created_by_user_id, tenant_id, workspace_id, title)
       VALUES ($1, $2, $2, $3, $4, 'Archive RLS verification')`,
      [archiveThreadId, userA, tenantA, workspaceA1],
    );
    await scoped.query(
      `INSERT INTO commerce_external_data_archive (
         tenant_id, workspace_id, user_id, source, source_call_id,
         endpoint_id, platform, root_thread_id, thread_id, turn_id,
         state, request_payload, response_payload,
         request_sha256, response_sha256, request_bytes, response_bytes,
         upstream_code, completed_at
       ) VALUES (
         $1, $2, $3, 'codex_harness', 'archive-call-12345678',
         'search.search_v1', 'search', $4, $4, 'turn-archive-1234',
         'succeeded', $5::jsonb, $6::jsonb, $7, $8,
         octet_length($5::text), octet_length($6::text), 0, CURRENT_TIMESTAMP
       )`,
      [
        tenantA,
        workspaceA1,
        userA,
        archiveThreadId,
        JSON.stringify({ endpoint_id: "search.search_v1", params: { keyword: "通勤包" } }),
        JSON.stringify({ code: 0, data: [{ title: "验证" }], message: null, recordTime: new Date().toISOString() }),
        "9a".repeat(32),
        "bc".repeat(32),
      ],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_archive`) === 1,
      "external data archive was not visible to its creator",
    );
    await scoped.query(`DELETE FROM commerce_agent_thread WHERE thread_id = $1`, [archiveThreadId]);
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_archive`) === 1,
      "thread deletion cascaded into the independent external data archive",
    );
    await scoped.query(
      `INSERT INTO commerce_external_data_call
        (tenant_id, workspace_id, user_id, provider, source, root_thread_id,
         thread_id, turn_id, call_id, endpoint_id, platform, parameter_hash,
         requested_approval_mode, approval_state, state, created_at, completed_at)
       VALUES
         ($1, $2, $3, 'justoneapi', 'codex_harness', $4, $4, 'turn-old-1234',
          'call-old-success', 'taobao.old_v1', 'taobao', $5,
          'task', 'not_required', 'succeeded', CURRENT_TIMESTAMP - interval '800 days', CURRENT_TIMESTAMP - interval '800 days'),
         ($1, $2, $3, 'justoneapi', 'codex_harness', $4, $4, 'turn-old-5678',
          'call-old-unknown', 'taobao.unknown_v1', 'taobao', $6,
          'task', 'not_required', 'unknown', CURRENT_TIMESTAMP - interval '800 days', CURRENT_TIMESTAMP - interval '800 days')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`, "12".repeat(32), "34".repeat(32)],
    );
    const purged = await scoped.query<{ deleted: number }>(
      `SELECT commerce_purge_external_data_calls(100) AS deleted`,
    );
    assert(purged.rows[0]?.deleted === 1, "retention worker did not purge exactly one eligible terminal call");
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_call WHERE state = 'unknown'`) === 1,
      "retention worker removed an unresolved external data call",
    );
    await scoped.query(
      `INSERT INTO commerce_agent_user_input_answer
        (tenant_id, workspace_id, user_id, thread_id, turn_id, request_id, item_id, answer_message)
       VALUES ($1, $2, $3, $4, 'turn-12345678', 'request-1', 'item-1', '我的选择：\n发布渠道：小红书')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_user_input_answer`) === 1,
      "thread owner could not read the user-input answer index",
    );
    await scoped.query(
      `INSERT INTO commerce_agent_message_feedback
        (tenant_id, workspace_id, user_id, thread_id, turn_id,
         message_item_id, rating, message_content_hash, model)
       VALUES ($1, $2, $3, $4, 'turn-12345678',
               'message-feedback-1', 'positive', $5, 'gpt-5.6-luna')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`, "56".repeat(32)],
    );
    await scoped.query(
      `INSERT INTO commerce_agent_message_feedback_event
        (tenant_id, workspace_id, user_id, thread_id, turn_id,
         message_item_id, action, rating, message_content_hash, model)
       VALUES ($1, $2, $3, $4, 'turn-12345678',
               'message-feedback-1', 'set', 'positive', $5, 'gpt-5.6-luna')`,
      [tenantA, workspaceA1, userA, `thread-${suffix}`, "56".repeat(32)],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback`) === 1,
      "thread owner could not read current message feedback",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback_event`) === 1,
      "thread owner could not read message feedback events",
    );
    const productSourceId = randomUUID();
    const productImportId = randomUUID();
    const productRecordId = randomUUID();
    const productMappingId = randomUUID();
    const productMappingFieldKeyId = randomUUID();
    const productMappingFieldTitleId = randomUUID();
    const productId = randomUUID();
    const productRevisionId = randomUUID();
    const variantId = randomUUID();
    const variantRevisionId = randomUUID();
    const productContextId = randomUUID();
    await scoped.query(
      `INSERT INTO commerce_product_source
        (id,tenant_id,workspace_id,source_kind,name,status,created_by_user_id)
       VALUES ($1,$2,$3,'file_upload','RLS 产品源','active',$4)`,
      [productSourceId, tenantA, workspaceA1, userA],
    );
    await scoped.query(
      `INSERT INTO commerce_product_import_run
        (id,tenant_id,workspace_id,source_id,idempotency_key,file_name,content_type,
         content_sha256,content_bytes,source_schema_hash,raw_storage_bytes,retention_until,
         content_dedupe_enforced,status,total_records,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,'products.json','application/json',$6,128,$7,512,
               CURRENT_TIMESTAMP + interval '180 days',true,'profiled',1,$8)`,
      [productImportId, tenantA, workspaceA1, productSourceId, randomUUID(), "11".repeat(32), "22".repeat(32), userA],
    );
    await scoped.query(
      `INSERT INTO commerce_product_source_record
        (id,tenant_id,workspace_id,import_run_id,ordinal,source_pointer,raw_payload,raw_sha256)
       VALUES ($1,$2,$3,$4,0,'/records/0',$5::jsonb,$6)`,
      [productRecordId, tenantA, workspaceA1, productImportId,
        JSON.stringify({ spu: "RLS-SPU-1", title: "RLS 商品", sku: "RLS-SKU-1" }), "33".repeat(32)],
    );
    await scoped.query("SAVEPOINT immutable_product_raw");
    let rawMutationRejected = false;
    try {
      await scoped.query(
        `UPDATE commerce_product_source_record SET raw_payload='{"tampered":true}'::jsonb WHERE id=$1`,
        [productRecordId],
      );
    } catch {
      rawMutationRejected = true;
      await scoped.query("ROLLBACK TO SAVEPOINT immutable_product_raw");
    }
    assert(rawMutationRejected, "append-only product source record was mutable");
    await scoped.query(
      `INSERT INTO commerce_product_mapping_revision
        (id,tenant_id,workspace_id,source_id,import_run_id,revision_number,source_schema_hash,
         proposal_source,mapping_document,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,1,$6,'deterministic',$7::jsonb,$8)`,
      [productMappingId, tenantA, workspaceA1, productSourceId, productImportId, "22".repeat(32),
        JSON.stringify({ fields: [
          { sourcePath: "/spu", targetField: "product.key", transform: "nfkc", required: true, confidence: 1, evidence: "test", transformOptions: {} },
          { sourcePath: "/title", targetField: "product.title", transform: "nfkc", required: true, confidence: 1, evidence: "test", transformOptions: {} },
        ] }), userA],
    );
    await scoped.query(
      `INSERT INTO commerce_product_mapping_field
        (id,tenant_id,workspace_id,mapping_revision_id,source_path,target_field,transform,required,confidence,review_state)
       VALUES ($1,$2,$3,$4,'/spu','product.key','nfkc',true,1,'accepted'),
              ($5,$2,$3,$4,'/title','product.title','nfkc',true,1,'accepted')`,
      [productMappingFieldKeyId, tenantA, workspaceA1, productMappingId, productMappingFieldTitleId],
    );
    await scoped.query(
      `UPDATE commerce_product_mapping_revision
       SET status='validated',validated_by_user_id=$2,validated_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [productMappingId, userA],
    );
    await scoped.query(
      `INSERT INTO commerce_product (id,tenant_id,workspace_id,internal_product_key,status)
       VALUES ($1,$2,$3,'RLS-SPU-1','active')`,
      [productId, tenantA, workspaceA1],
    );
    await scoped.query(
      `INSERT INTO commerce_product_revision
        (id,tenant_id,workspace_id,product_id,revision_number,title,attributes,content_sha256,
         source_import_id,source_record_id,mapping_revision_id,created_by_user_id)
       VALUES ($1,$2,$3,$4,1,'RLS 商品','{}'::jsonb,$5,$6,$7,$8,$9)`,
      [productRevisionId, tenantA, workspaceA1, productId, "44".repeat(32), productImportId,
        productRecordId, productMappingId, userA],
    );
    await scoped.query(`UPDATE commerce_product SET current_revision_id=$2 WHERE id=$1`, [productId, productRevisionId]);
    await scoped.query(
      `INSERT INTO commerce_product_variant
        (id,tenant_id,workspace_id,product_id,internal_sku,status)
       VALUES ($1,$2,$3,$4,'RLS-SKU-1','active')`,
      [variantId, tenantA, workspaceA1, productId],
    );
    await scoped.query(
      `INSERT INTO commerce_product_variant_revision
        (id,tenant_id,workspace_id,variant_id,revision_number,title,option_values,attributes,
         content_sha256,source_import_id,source_record_id,mapping_revision_id,created_by_user_id)
       VALUES ($1,$2,$3,$4,1,'RLS SKU','{}'::jsonb,'{}'::jsonb,$5,$6,$7,$8,$9)`,
      [variantRevisionId, tenantA, workspaceA1, variantId, "55".repeat(32), productImportId,
        productRecordId, productMappingId, userA],
    );
    await scoped.query(
      `UPDATE commerce_product_variant SET current_revision_id=$2 WHERE id=$1`,
      [variantId, variantRevisionId],
    );
    await scoped.query(
      `INSERT INTO commerce_product_source_link
        (tenant_id,workspace_id,source_id,external_product_key,external_variant_key,
         product_id,variant_id,latest_source_record_id,mapping_revision_id,match_method,confidence,review_state)
       VALUES ($1,$2,$3,'RLS-SPU-1','RLS-SKU-1',$4,$5,$6,$7,'source_key',1,'accepted')`,
      [tenantA, workspaceA1, productSourceId, productId, variantId, productRecordId, productMappingId],
    );
    await scoped.query(
      `UPDATE commerce_product_mapping_revision
       SET status='active',activated_by_user_id=$2,activated_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [productMappingId, userA],
    );
    await scoped.query("SAVEPOINT immutable_product_mapping");
    let activeMappingMutationRejected = false;
    try {
      await scoped.query(
        `UPDATE commerce_product_mapping_revision SET confidence=0.2 WHERE id=$1`,
        [productMappingId],
      );
    } catch {
      activeMappingMutationRejected = true;
      await scoped.query("ROLLBACK TO SAVEPOINT immutable_product_mapping");
    }
    assert(activeMappingMutationRejected, "active product mapping revision was mutable");
    await scoped.query(
      `INSERT INTO commerce_agent_product_context_set
        (id,tenant_id,workspace_id,user_id,thread_id,client_request_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [productContextId, tenantA, workspaceA1, userA, `thread-${suffix}`, randomUUID()],
    );
    await scoped.query(
      `INSERT INTO commerce_agent_product_context_item
        (tenant_id,workspace_id,context_set_id,ordinal,product_id,product_revision_id,variant_id,variant_revision_id)
       VALUES ($1,$2,$3,0,$4,$5,$6,$7)`,
      [tenantA, workspaceA1, productContextId, productId, productRevisionId, variantId, variantRevisionId],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_product`) === 1 &&
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_product_variant`) === 1,
      "workspace product/SKU master was not visible in scope",
    );
    await scoped.query("SELECT set_config('commerce.workspace_id', $1, true)", [workspaceA2]);
    assert(await count(scoped, `SELECT count(*)::text AS count FROM commerce_product`) === 0, "product leaked across workspaces");
    await scoped.query("SELECT set_config('commerce.workspace_id', $1, true)", [workspaceA1]);
    const deletionJobId = randomUUID();
    await scoped.query(
      `INSERT INTO commerce_thread_deletion_job
        (id, tenant_id, workspace_id, user_id, total_items)
       VALUES ($1, $2, $3, $4, 1)`,
      [deletionJobId, tenantA, workspaceA1, userA],
    );
    await scoped.query(
      `INSERT INTO commerce_thread_deletion_item
        (job_id, tenant_id, workspace_id, user_id, thread_id, ordinal)
       VALUES ($1, $2, $3, $4, $5, 0)`,
      [deletionJobId, tenantA, workspaceA1, userA, `thread-${suffix}`],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_thread_deletion_job`) === 1,
      "thread owner could not read the deletion job",
    );
    await scoped.query("SELECT set_config('commerce.user_id', $1, true)", [userB]);
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_user_input_answer`) === 0,
      "another user's user-input answer was visible",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_thread_deletion_job`) === 0,
      "another user's deletion job was visible",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback`) === 0,
      "another user's current message feedback was visible",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback_event`) === 0,
      "another user's message feedback events were visible",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_archive`) === 0,
      "another user's external data archive was visible",
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_product_context_set`) === 0 &&
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_product_context_item`) === 0,
      "another user's Harness product context was visible",
    );
    await scoped.query("SELECT set_config('commerce.user_id', $1, true)", [userA]);
    await scoped.query(
      `DELETE FROM commerce_agent_message_feedback
       WHERE thread_id = $1 AND message_item_id = 'message-feedback-1'`,
      [`thread-${suffix}`],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback`) === 0 &&
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_message_feedback_event`) === 1,
      "clearing current feedback removed the append-only feedback event",
    );
    await scoped.query("SAVEPOINT cross_tenant_write");
    let crossTenantWriteRejected = false;
    try {
      await scoped.query(
        `INSERT INTO commerce_agent_thread
          (thread_id, user_id, created_by_user_id, tenant_id, workspace_id, title)
         VALUES ($1, $2, $2, $3, $4, 'must fail')`,
        [`forbidden-${suffix}`, userA, tenantB, workspaceB],
      );
    } catch {
      crossTenantWriteRejected = true;
      await scoped.query("ROLLBACK TO SAVEPOINT cross_tenant_write");
    }
    assert(crossTenantWriteRejected, "cross-tenant write was accepted");
    await scoped.query("SAVEPOINT cross_tenant_product_write");
    let crossTenantProductWriteRejected = false;
    try {
      await scoped.query(
        `INSERT INTO commerce_product_source
          (tenant_id,workspace_id,source_kind,name,status,created_by_user_id)
         VALUES ($1,$2,'file_upload','must fail','active',$3)`,
        [tenantB, workspaceB, userA],
      );
    } catch {
      crossTenantProductWriteRejected = true;
      await scoped.query("ROLLBACK TO SAVEPOINT cross_tenant_product_write");
    }
    assert(crossTenantProductWriteRejected, "cross-tenant product source write was accepted");
    await scoped.query("SELECT set_config('commerce.workspace_id', $1, true)", [workspaceA2]);
    await scoped.query("SAVEPOINT cross_workspace_thread_relationship");
    let crossWorkspaceThreadRelationshipRejected = false;
    try {
      await scoped.query(
        `INSERT INTO commerce_agent_message_feedback
          (tenant_id,workspace_id,user_id,thread_id,turn_id,message_item_id,rating,message_content_hash)
         VALUES ($1,$2,$3,$4,'turn-87654321','cross-workspace-message','positive',$5)`,
        [tenantA, workspaceA2, userA, `thread-${suffix}`, "78".repeat(32)],
      );
    } catch {
      crossWorkspaceThreadRelationshipRejected = true;
      await scoped.query("ROLLBACK TO SAVEPOINT cross_workspace_thread_relationship");
    }
    assert(
      crossWorkspaceThreadRelationshipRejected,
      "a thread-owned record could reference a thread from another workspace",
    );
    await scoped.query("SELECT set_config('commerce.workspace_id', $1, true)", [workspaceA1]);
    await scoped.query("SELECT set_config('commerce.tenant_wide', 'on', true)");
    assert(await count(scoped, `SELECT count(*)::text AS count FROM commerce_workspace`) === 2, "tenant-wide workspace scope failed");
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_external_data_policy`) === 2,
      "tenant-wide external data policy scope failed",
    );
    await scoped.query(
      `INSERT INTO commerce_agent_turn_lease
        (tenant_id, workspace_id, user_id, thread_id, request_id, state, expires_at)
       VALUES ($1, $2, $3, 'thread-a', $4, 'active', CURRENT_TIMESTAMP + interval '5 minutes'),
              ($1, $5, $3, 'thread-b', $6, 'active', CURRENT_TIMESTAMP + interval '5 minutes')`,
      [tenantA, workspaceA1, userA, randomUUID(), workspaceA2, randomUUID()],
    );
    assert(
      await count(scoped, `SELECT count(*)::text AS count FROM commerce_agent_turn_lease WHERE tenant_id = $1`, [tenantA]) === 2,
      "tenant-wide lease aggregate did not span workspaces",
    );
    await scoped.query("ROLLBACK");
  } finally {
    scoped.release();
  }

  const parsedProductFile = parseProductImportBuffer({
    bytes: new TextEncoder().encode(
      "spu,title,sku,brand,category,image_url\nVERIFY-SPU-1,验证商品,VERIFY-SKU-1,验证品牌,验证类目,https://example.test/product.png\n",
    ),
    fileName: "verify-products.csv",
    declaredContentType: "text/csv",
  });
  const imported = await createProductImport(
    { tenantId: tenantA, workspaceId: workspaceA2, userId: userA },
    {
      parsed: parsedProductFile,
      sourceName: "隔离验证产品源",
      idempotencyKey: randomUUID(),
      activateIfValid: true,
    },
  );
  assert(
    imported.import.status === "completed" &&
    imported.import.importedProducts === 1 &&
    imported.import.importedVariants === 1,
    "deterministic product import did not complete with Product/SKU readback",
  );
  const replayedImport = await createProductImport(
    { tenantId: tenantA, workspaceId: workspaceA2, userId: userA },
    {
      parsed: parsedProductFile,
      sourceName: "重复隔离验证产品源",
      idempotencyKey: randomUUID(),
      activateIfValid: false,
    },
  );
  assert(
    replayedImport.duplicate && replayedImport.import.id === imported.import.id,
    "same-workspace product content replay created a second immutable raw batch",
  );
  const listedProducts = await listProducts(
    { tenantId: tenantA, workspaceId: workspaceA2, userId: userA },
    { query: "VERIFY-SPU-1", limit: 10 },
  );
  const listedProduct = listedProducts.products[0];
  assert(
    listedProducts.total === 1 && listedProduct?.spu === "VERIFY-SPU-1" && listedProduct.variantCount === 1,
    "product repository list readback did not match the imported Product/SKU",
  );
  const productDetail = await getProduct(
    { tenantId: tenantA, workspaceId: workspaceA2, userId: userA },
    listedProduct.id,
  );
  assert(
    productDetail?.title === "验证商品" && productDetail.variants[0]?.sku === "VERIFY-SKU-1",
    "product repository detail readback did not match the imported revision",
  );
  const productScope = { tenantId: tenantA, workspaceId: workspaceA2, userId: userA };
  const connectorCatalog = await listProductConnectors(productScope);
  assert(
    connectorCatalog.find((connector) => connector.key === "file_upload")?.adapterAvailability === "ready" &&
    connectorCatalog.find((connector) => connector.key === "postgres_readonly")?.adapterAvailability === "requires_operator_configuration" &&
    connectorCatalog.find((connector) => connector.key === "managed_rest")?.adapterAvailability === "unavailable",
    "connector runtime availability did not fail closed",
  );
  const fileSources = await listProductSources(productScope);
  assert(
    fileSources.some((source) => source.kind === "file_upload" && source.connectionState === "ready"),
    "file import source was not backfilled to the ready connector definition",
  );

  process.env.COMMERCE_PRODUCT_SOURCE_VERIFY_DB = applicationUrl;
  const secretHandle = `broker:psh_${randomUUID().replaceAll("-", "")}`;
  await owner.query(
    `INSERT INTO commerce_product_secret_handle
      (tenant_id,workspace_id,handle,label,connector_key,connector_version,env_name)
     VALUES ($1,$2,$3,'隔离验证只读连接','postgres_readonly','1.0.0','COMMERCE_PRODUCT_SOURCE_VERIFY_DB')`,
    [tenantA, workspaceA2, secretHandle],
  );
  const sourceCreationIdempotencyKey = randomUUID();
  const databaseSource = await createProductSource(productScope, {
    idempotencyKey: sourceCreationIdempotencyKey,
    name: "隔离验证只读产品库",
    connectorKey: "postgres_readonly",
    connectorVersion: "1.0.0",
    publicConfig: { schema: "public", table: "commerce_product_connector_definition" },
    secretReference: secretHandle,
  });
  assert(
    databaseSource.source.connectionState === "untested" &&
    databaseSource.source.secretReference.scheme === "broker" &&
    !JSON.stringify(databaseSource.source).includes(applicationUrl) &&
    !JSON.stringify(databaseSource.source).includes(secretHandle) &&
    !JSON.stringify(databaseSource.source).includes("COMMERCE_PRODUCT_SOURCE_VERIFY_DB"),
    "database source exposed secret material or skipped the untested state",
  );
  const repeatedDatabaseSource = await createProductSource(productScope, {
    idempotencyKey: sourceCreationIdempotencyKey,
    name: "隔离验证只读产品库",
    connectorKey: "postgres_readonly",
    connectorVersion: "1.0.0",
    publicConfig: { schema: "public", table: "commerce_product_connector_definition" },
    secretReference: secretHandle,
  });
  assert(
    repeatedDatabaseSource.duplicate && repeatedDatabaseSource.source.id === databaseSource.source.id,
    "source creation idempotency created a duplicate connection",
  );
  const testIdempotencyKey = randomUUID();
  const databaseTest = await testProductSourceConnection(productScope, {
    sourceId: databaseSource.source.id,
    idempotencyKey: testIdempotencyKey,
  });
  assert(
    databaseTest.test.status === "succeeded" &&
    databaseTest.test.proof.readOnly &&
    databaseTest.test.proof.selectAllowed &&
    !databaseTest.test.proof.writePrivileges &&
    databaseTest.source.connectionState === "ready",
    "PostgreSQL connector did not prove a least-privilege read-only session",
  );
  const repeatedDatabaseTest = await testProductSourceConnection(productScope, {
    sourceId: databaseSource.source.id,
    idempotencyKey: testIdempotencyKey,
  });
  assert(
    repeatedDatabaseTest.duplicate && repeatedDatabaseTest.test.id === databaseTest.test.id,
    "connector test idempotency created or returned a different receipt",
  );
  const terminalReceiptClient = await application.connect();
  try {
    await terminalReceiptClient.query("BEGIN");
    await setScope(terminalReceiptClient, tenantA, workspaceA2, userA, false);
    await terminalReceiptClient.query("SAVEPOINT terminal_connector_receipt");
    let terminalReceiptMutationRejected = false;
    try {
      await terminalReceiptClient.query(
        `UPDATE commerce_product_source_operation_receipt SET result_message='tampered' WHERE id=$1`,
        [databaseTest.test.id],
      );
    } catch {
      terminalReceiptMutationRejected = true;
      await terminalReceiptClient.query("ROLLBACK TO SAVEPOINT terminal_connector_receipt");
    }
    assert(terminalReceiptMutationRejected, "terminal connector operation receipt was mutable");
    await terminalReceiptClient.query("ROLLBACK");
  } finally {
    terminalReceiptClient.release();
  }

  const retentionClient = await application.connect();
  try {
    await retentionClient.query("BEGIN");
    await setScope(retentionClient, tenantA, workspaceA2, userA, true);
    const budget = await retentionClient.query<{ allowed: boolean; reason_code: string }>(
      `SELECT allowed,reason_code
       FROM commerce_check_product_import_storage_budget($1,$2,$3::bigint)`,
      [tenantA, workspaceA2, 2_000_000_000],
    );
    assert(
      budget.rows[0]?.allowed === false && budget.rows[0]?.reason_code === "PRODUCT_IMPORT_TENANT_STORAGE_LIMIT",
      "tenant product-import storage budget did not fail closed",
    );
    await retentionClient.query(
      `UPDATE commerce_product_import_run
       SET created_at=CURRENT_TIMESTAMP - interval '2 days',
           retention_until=CURRENT_TIMESTAMP - interval '1 day'
       WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      [tenantA, workspaceA2, imported.import.id],
    );
    const purge = await retentionClient.query<{
      purged_imports: number;
      purged_records: number;
      released_bytes: string;
    }>(`SELECT * FROM commerce_purge_product_import_payloads(10)`);
    assert(
      purge.rows[0]?.purged_imports === 1 && purge.rows[0].purged_records === 1 &&
      Number(purge.rows[0].released_bytes) >= parsedProductFile.contentBytes,
      "expired product-import payload was not purged with storage readback",
    );
    await retentionClient.query("COMMIT");
  } catch (error) {
    await retentionClient.query("ROLLBACK");
    throw error;
  } finally {
    retentionClient.release();
  }
  await expectProductImportPayloadPurged(productScope, imported.import.id);
  const canonicalAfterPurge = await getProduct(productScope, listedProduct.id);
  assert(
    canonicalAfterPurge?.title === "验证商品" && canonicalAfterPurge.variants[0]?.sku === "VERIFY-SKU-1",
    "retention cleanup removed canonical Product/SKU revisions",
  );

  const persistedRaw = await owner.query<{ id: string }>(
    `SELECT id FROM commerce_product_source_record WHERE import_run_id=$1`,
    [imported.import.id],
  );
  assert(Boolean(persistedRaw.rows[0]), "product import did not retain its raw source record");
  const ownerClient = await owner.connect();
  try {
    await ownerClient.query("BEGIN");
    await ownerClient.query("SAVEPOINT direct_raw_delete");
    let directRawDeleteRejected = false;
    try {
      await ownerClient.query(`DELETE FROM commerce_product_source_record WHERE id=$1`, [persistedRaw.rows[0]?.id]);
    } catch {
      directRawDeleteRejected = true;
      await ownerClient.query("ROLLBACK TO SAVEPOINT direct_raw_delete");
    }
    assert(directRawDeleteRejected, "migration owner could directly delete an append-only product raw record");
    await ownerClient.query("ROLLBACK");
  } finally {
    ownerClient.release();
  }
  await owner.query(`DELETE FROM commerce_tenant WHERE id=$1`, [tenantA]);
  assert(
    await owner.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM commerce_product_source_record WHERE id=$1`,
      [persistedRaw.rows[0]?.id],
    ).then((result) => result.rows[0]?.count === "0"),
    "explicit tenant teardown could not cascade append-only product rows",
  );

  console.log(JSON.stringify({ ok: true, applicationRole: "non-superuser/non-BYPASSRLS", checks: 78 }));
} finally {
  delete process.env.COMMERCE_PRODUCT_SOURCE_VERIFY_DB;
  await owner.query(`DELETE FROM commerce_tenant WHERE id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => undefined);
  await owner.query(`DELETE FROM commerce_organization WHERE id = ANY($1::uuid[])`, [[organizationA, organizationB]]).catch(() => undefined);
  await owner.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [[userA, userB]]).catch(() => undefined);
  await Promise.all([owner.end(), application.end(), getAuthDatabase().end()]);
}

async function createFixtures(): Promise<void> {
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "user" (id, name, email, "emailVerified")
       VALUES ($1, 'RLS A', $2, true), ($3, 'RLS B', $4, true)`,
      [userA, `${userA}@example.test`, userB, `${userB}@example.test`],
    );
    await client.query(
      `INSERT INTO commerce_organization (id, slug, name, status, created_by_user_id)
       VALUES ($1, $2, 'RLS A', 'active', $3), ($4, $5, 'RLS B', 'active', $6)`,
      [organizationA, `rls-a-${suffix}`, userA, organizationB, `rls-b-${suffix}`, userB],
    );
    await client.query(
      `INSERT INTO commerce_tenant (id, organization_id, slug, name, status, created_by_user_id)
       VALUES ($1, $2, $3, 'RLS A', 'active', $4), ($5, $6, $7, 'RLS B', 'active', $8)`,
      [tenantA, organizationA, `rls-a-${suffix}`, userA, tenantB, organizationB, `rls-b-${suffix}`, userB],
    );
    await client.query(
      `INSERT INTO commerce_workspace (id, tenant_id, slug, name, status, is_default, created_by_user_id)
       VALUES ($1, $2, 'default', 'A1', 'active', true, $3),
              ($4, $2, 'secondary', 'A2', 'active', false, $3),
              ($5, $6, 'default', 'B1', 'active', true, $7)`,
      [workspaceA1, tenantA, userA, workspaceA2, workspaceB, tenantB, userB],
    );
    await client.query(
      `INSERT INTO commerce_tenant_membership (tenant_id, user_id, status, is_default, joined_at)
       VALUES ($1, $2, 'active', true, CURRENT_TIMESTAMP), ($3, $4, 'active', true, CURRENT_TIMESTAMP)`,
      [tenantA, userA, tenantB, userB],
    );
    await client.query(
      `INSERT INTO commerce_workspace_membership (tenant_id, workspace_id, user_id, status, is_default)
       VALUES ($1, $2, $3, 'active', true), ($1, $4, $3, 'active', false),
              ($5, $6, $7, 'active', true)`,
      [tenantA, workspaceA1, userA, workspaceA2, tenantB, workspaceB, userB],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_contract
        (tenant_id, status, seat_limit, workspace_limit, concurrent_turn_limit,
         concurrent_turn_limit_per_workspace, concurrent_turn_limit_per_user)
       VALUES ($1, 'active', 10, 5, 4, 3, 2), ($2, 'active', 10, 5, 4, 3, 2)`,
      [tenantA, tenantB],
    );
    await client.query(
      `INSERT INTO commerce_external_data_policy (tenant_id, workspace_id)
       VALUES ($1, $2), ($1, $3), ($4, $5)`,
      [tenantA, workspaceA1, workspaceA2, tenantB, workspaceB],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_role
        (id, tenant_id, scope, role_key, name, allowed_permissions, is_system)
       VALUES ($1, $2, 'workspace', 'workspace_operator', 'RLS operator',
                ARRAY[
                  'external_data.catalog.read', 'external_data.call',
                  'product_catalog.read', 'product_catalog.import'
                ]::text[], true)`,
      [roleA, tenantA],
    );
    await client.query(
      `INSERT INTO commerce_user_role_assignment
        (tenant_id, user_id, role_id, workspace_id, assigned_by_user_id)
       VALUES ($1, $2, $3, $4, $2)`,
      [tenantA, userA, roleA, workspaceA1],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function verifyEnterpriseSchemaIsolation(): Promise<void> {
  const tables = await owner.query<{
    table_name: string;
    has_tenant_id: boolean;
    has_workspace_id: boolean;
    rls_enabled: boolean;
    rls_forced: boolean;
    policy_count: string;
  }>(
    `
      SELECT relation.relname AS table_name,
             EXISTS (
               SELECT 1 FROM pg_attribute column_definition
               WHERE column_definition.attrelid = relation.oid
                 AND column_definition.attname = 'tenant_id'
                 AND column_definition.attnum > 0
                 AND NOT column_definition.attisdropped
             ) AS has_tenant_id,
             EXISTS (
               SELECT 1 FROM pg_attribute column_definition
               WHERE column_definition.attrelid = relation.oid
                 AND column_definition.attname = 'workspace_id'
                 AND column_definition.attnum > 0
                 AND NOT column_definition.attisdropped
             ) AS has_workspace_id,
             relation.relrowsecurity AS rls_enabled,
             relation.relforcerowsecurity AS rls_forced,
             count(policy.policyname)::text AS policy_count
      FROM pg_class relation
      INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_policies policy
        ON policy.schemaname = namespace.nspname AND policy.tablename = relation.relname
      WHERE namespace.nspname = 'public'
        AND relation.relkind = 'r'
        AND relation.relname LIKE 'commerce_%'
      GROUP BY relation.oid, relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
      ORDER BY relation.relname
    `,
  );
  const boundaryTables = new Set(["commerce_organization", "commerce_tenant"]);
  const globalMasterTables = new Set([
    "commerce_schema_migration",
    "commerce_external_provider_import",
    "commerce_external_provider_endpoint",
    "commerce_product_connector_definition",
  ]);
  for (const table of tables.rows) {
    const tenantOwned = table.has_tenant_id || boundaryTables.has(table.table_name);
    if (tenantOwned) {
      assert(table.rls_enabled, `${table.table_name} does not enable RLS`);
      assert(table.rls_forced, `${table.table_name} does not FORCE RLS`);
      assert(Number.parseInt(table.policy_count, 10) > 0, `${table.table_name} has no RLS policy`);
      continue;
    }
    assert(globalMasterTables.has(table.table_name), `${table.table_name} has no tenant boundary or approved master-data role`);
  }

  const policies = await owner.query<{
    table_name: string;
    policy_name: string;
    command: string;
    qualification: string | null;
    write_check: string | null;
  }>(
    `
      SELECT policy.tablename AS table_name,
             policy.policyname AS policy_name,
             policy.cmd AS command,
             policy.qual AS qualification,
             policy.with_check AS write_check
      FROM pg_policies policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename LIKE 'commerce_%'
      ORDER BY policy.tablename, policy.policyname
    `,
  );
  const tenantOwnedTableNames = new Set(
    tables.rows
      .filter((table) => table.has_tenant_id || table.table_name === "commerce_tenant")
      .map((table) => table.table_name),
  );
  for (const policy of policies.rows) {
    if (policy.table_name === "commerce_organization") {
      assert(
        `${policy.qualification ?? ""} ${policy.write_check ?? ""}`.includes("commerce.organization_id"),
        `${policy.table_name}.${policy.policy_name} is not organization-scoped`,
      );
      continue;
    }
    if (!tenantOwnedTableNames.has(policy.table_name)) continue;
    if (
      policy.table_name === "commerce_enterprise_invitation" &&
      policy.policy_name === "commerce_enterprise_invitation_token_select" &&
      policy.command === "SELECT"
    ) {
      assert(
        (policy.qualification ?? "").includes("commerce.invitation_token_hash"),
        "invitation discovery policy is not bound to the bearer-token digest",
      );
      continue;
    }
    assert(
      `${policy.qualification ?? ""} ${policy.write_check ?? ""}`.includes("commerce.tenant_id"),
      `${policy.table_name}.${policy.policy_name} is not tenant-scoped`,
    );
  }

  const workspaceScopeFks = await owner.query<{ table_name: string; has_scope_fk: boolean }>(
    `
      WITH workspace_tables AS (
        SELECT relation.oid, relation.relname
        FROM pg_class relation
        INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind = 'r'
          AND EXISTS (
            SELECT 1 FROM pg_attribute column_definition
            WHERE column_definition.attrelid = relation.oid
              AND column_definition.attname = 'tenant_id'
              AND column_definition.attnum > 0
              AND NOT column_definition.attisdropped
          )
          AND EXISTS (
            SELECT 1 FROM pg_attribute column_definition
            WHERE column_definition.attrelid = relation.oid
              AND column_definition.attname = 'workspace_id'
              AND column_definition.attnum > 0
              AND NOT column_definition.attisdropped
          )
      ), foreign_keys AS (
        SELECT constraint_definition.conrelid,
               constraint_definition.convalidated,
               array_agg(column_definition.attname::text ORDER BY key_column.ordinality) AS columns
        FROM pg_constraint constraint_definition
        CROSS JOIN LATERAL unnest(constraint_definition.conkey)
          WITH ORDINALITY AS key_column(attnum, ordinality)
        INNER JOIN pg_attribute column_definition
          ON column_definition.attrelid = constraint_definition.conrelid
         AND column_definition.attnum = key_column.attnum
        WHERE constraint_definition.contype = 'f'
        GROUP BY constraint_definition.oid,
                 constraint_definition.conrelid,
                 constraint_definition.convalidated
      )
      SELECT workspace_table.relname AS table_name,
             COALESCE(bool_or(
               foreign_key.convalidated
               AND foreign_key.columns @> ARRAY['tenant_id', 'workspace_id']::text[]
             ), false) AS has_scope_fk
      FROM workspace_tables workspace_table
      LEFT JOIN foreign_keys foreign_key ON foreign_key.conrelid = workspace_table.oid
      GROUP BY workspace_table.relname
      ORDER BY workspace_table.relname
    `,
  );
  for (const table of workspaceScopeFks.rows) {
    assert(table.has_scope_fk, `${table.table_name} has no validated tenant/workspace compound foreign key`);
  }

  const unsafeRelationships = await owner.query<{ constraint_name: string }>(
    `
      WITH foreign_keys AS (
        SELECT constraint_definition.oid,
               constraint_definition.conname,
               constraint_definition.conrelid,
               constraint_definition.confrelid,
               array_agg(column_definition.attname::text ORDER BY key_column.ordinality) AS columns
        FROM pg_constraint constraint_definition
        CROSS JOIN LATERAL unnest(constraint_definition.conkey)
          WITH ORDINALITY AS key_column(attnum, ordinality)
        INNER JOIN pg_attribute column_definition
          ON column_definition.attrelid = constraint_definition.conrelid
         AND column_definition.attnum = key_column.attnum
        WHERE constraint_definition.contype = 'f'
        GROUP BY constraint_definition.oid,
                 constraint_definition.conname,
                 constraint_definition.conrelid,
                 constraint_definition.confrelid
      )
      SELECT foreign_key.conname AS constraint_name
      FROM foreign_keys foreign_key
      WHERE EXISTS (
              SELECT 1 FROM pg_attribute source_column
              WHERE source_column.attrelid = foreign_key.conrelid
                AND source_column.attname = 'tenant_id'
                AND source_column.attnum > 0
                AND NOT source_column.attisdropped
            )
        AND EXISTS (
              SELECT 1 FROM pg_attribute target_column
              WHERE target_column.attrelid = foreign_key.confrelid
                AND target_column.attname = 'tenant_id'
                AND target_column.attnum > 0
                AND NOT target_column.attisdropped
            )
        AND NOT (foreign_key.columns @> ARRAY['tenant_id']::text[])
      ORDER BY foreign_key.conname
    `,
  );
  assert(
    unsafeRelationships.rowCount === 0,
    `tenant-scoped foreign keys omit tenant_id: ${unsafeRelationships.rows.map((row) => row.constraint_name).join(", ")}`,
  );

  const invalidConstraints = await owner.query<{ constraint_name: string }>(
    `
      SELECT constraint_definition.conname AS constraint_name
      FROM pg_constraint constraint_definition
      INNER JOIN pg_class relation ON relation.oid = constraint_definition.conrelid
      INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname LIKE 'commerce_%'
        AND NOT constraint_definition.convalidated
      ORDER BY constraint_definition.conname
    `,
  );
  assert(
    invalidConstraints.rowCount === 0,
    `Enterprise constraints remain NOT VALID: ${invalidConstraints.rows.map((row) => row.constraint_name).join(", ")}`,
  );

  const legacyThreadBoundary = await owner.query<{
    nullable_scope_columns: string;
    policy_has_legacy_branch: boolean;
  }>(
    `
      SELECT count(*) FILTER (WHERE NOT column_definition.attnotnull)::text AS nullable_scope_columns,
             EXISTS (
               SELECT 1 FROM pg_policies policy
               WHERE policy.schemaname = 'public'
                 AND policy.tablename = 'commerce_agent_thread'
                 AND COALESCE(policy.qual, '') ILIKE '%tenant_id IS NULL%'
             ) AS policy_has_legacy_branch
      FROM pg_attribute column_definition
      WHERE column_definition.attrelid = 'commerce_agent_thread'::regclass
        AND column_definition.attname IN ('tenant_id', 'workspace_id', 'created_by_user_id')
        AND column_definition.attnum > 0
        AND NOT column_definition.attisdropped
    `,
  );
  assert(
    legacyThreadBoundary.rows[0]?.nullable_scope_columns === "0" &&
      legacyThreadBoundary.rows[0]?.policy_has_legacy_branch === false,
    "legacy unassigned Agent-thread access remains enabled",
  );

  const applicationMasterPrivileges = await application.query<{
    table_name: string;
    can_insert: boolean;
    can_update: boolean;
    can_delete: boolean;
    can_truncate: boolean;
  }>(
    `
      SELECT master.table_name,
             has_table_privilege(current_user, master.table_name, 'INSERT') AS can_insert,
             has_table_privilege(current_user, master.table_name, 'UPDATE') AS can_update,
             has_table_privilege(current_user, master.table_name, 'DELETE') AS can_delete,
             has_table_privilege(current_user, master.table_name, 'TRUNCATE') AS can_truncate
      FROM unnest($1::text[]) AS master(table_name)
    `,
    [[...globalMasterTables]],
  );
  for (const table of applicationMasterPrivileges.rows) {
    assert(
      !table.can_insert && !table.can_update && !table.can_delete && !table.can_truncate,
      `application role can mutate global master table ${table.table_name}`,
    );
  }
}

async function expectProductImportPayloadPurged(
  scope: { tenantId: string; workspaceId: string; userId: string },
  importId: string,
): Promise<void> {
  let rejected = false;
  try {
    await inspectProductImport(scope, importId);
  } catch (error) {
    rejected = Boolean(
      error && typeof error === "object" && "code" in error &&
      error.code === "PRODUCT_IMPORT_RAW_PAYLOAD_PURGED",
    );
  }
  assert(rejected, "purged product raw payload remained inspectable");
}

async function setScope(
  client: PoolClient,
  tenantId: string,
  workspaceId: string,
  userId: string,
  tenantWide: boolean,
): Promise<void> {
  await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [tenantId]);
  await client.query("SELECT set_config('commerce.workspace_id', $1, true)", [workspaceId]);
  await client.query("SELECT set_config('commerce.user_id', $1, true)", [userId]);
  await client.query("SELECT set_config('commerce.tenant_wide', $1, true)", [tenantWide ? "on" : "off"]);
}

async function count(client: PoolClient, sql: string, values: unknown[] = []): Promise<number> {
  const result = await client.query<{ count: string }>(sql, values);
  return Number.parseInt(result.rows[0]?.count || "0", 10);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Enterprise isolation verification failed: ${message}`);
}
