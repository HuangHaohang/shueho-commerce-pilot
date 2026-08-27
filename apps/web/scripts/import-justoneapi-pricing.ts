import nextEnv from "@next/env";
import { config as loadDotenv } from "dotenv";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { basename, extname, resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { Pool } from "pg";

import { justOneApiEndpointIdentity } from "../../../src/integrations/justoneapi-catalog";

type PricingRow = {
  endpoint_id: string;
  platform_id: string;
  platform_name: string;
  api_path: string;
  currency: string;
  vendor_unit_cost_micros: number | null;
  permission_status: "allowed" | "unavailable";
};

nextEnv.loadEnvConfig(process.cwd());
loadDotenv({ path: resolve(process.cwd(), ".env.migration"), override: false, quiet: true });

const fileArgument = readArgument("file");
const actorEmail = readArgument("actor-email").trim().toLowerCase();
const sourcePath = resolve(fileArgument);
if (extname(sourcePath).toLowerCase() !== ".xlsx") {
  throw new Error("JustOneAPI pricing import requires an .xlsx file.");
}
const sourceStat = await stat(sourcePath);
if (!sourceStat.isFile() || sourceStat.size < 1 || sourceStat.size > 10 * 1024 * 1024) {
  throw new Error("JustOneAPI pricing workbook must be a file between 1 byte and 10 MB.");
}

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required for provider pricing imports.");

const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(sourceBytes as unknown as ExcelJS.Buffer);
const metadataSheet = workbook.getWorksheet("Just One API");
const pricingSheet = workbook.getWorksheet("定价");
if (!metadataSheet || !pricingSheet) {
  throw new Error('Workbook must contain sheets named "Just One API" and "定价".');
}

assertHeaders(pricingSheet);
const sourceFilter = metadataSheet.getCell("B13").text.trim();
const sourceSearch = metadataSheet.getCell("B14").text.trim();
if (!/所有接口/.test(sourceFilter) || (sourceSearch && sourceSearch !== "-")) {
  throw new Error("Pricing import requires a complete all-endpoints export without a search filter.");
}
const sourceExportedAt = parseExportTime(metadataSheet.getCell("B15").text);
const declaredRows = parsePositiveInteger(metadataSheet.getCell("B16").text, "declared export row count");
const currency = parseCurrency(pricingSheet.getCell("A2").text);
const rows = readPricingRows(pricingSheet, currency);
if (rows.length !== declaredRows) {
  throw new Error(`Workbook declares ${declaredRows} rows but contains ${rows.length} pricing rows.`);
}
assertUniqueRows(rows);

const pool = new Pool({ connectionString: migrationUrl, max: 1 });
try {
  const actor = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 1`,
    [actorEmail],
  );
  const actorUserId = actor.rows[0]?.id;
  if (!actorUserId) throw new Error("Pricing import actor email does not identify an existing user.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('justoneapi-pricing-import'))");
    const existing = await client.query<{ id: string; row_count: number }>(
      `SELECT id, row_count FROM commerce_external_provider_import
       WHERE provider = 'justoneapi' AND source_sha256 = $1`,
      [sourceSha256],
    );
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({
        ok: true,
        idempotent: true,
        sourceFilename: basename(sourcePath),
        rowCount: existing.rows[0].row_count,
      }));
    } else {
      const imported = await client.query<{ id: string }>(
        `
          INSERT INTO commerce_external_provider_import (
            provider, source_filename, source_sha256, source_exported_at,
            source_filter, source_search, currency, row_count,
            allowed_row_count, imported_by_user_id
          )
          VALUES ('justoneapi', $1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `,
        [
          basename(sourcePath),
          sourceSha256,
          sourceExportedAt,
          sourceFilter,
          sourceSearch || "-",
          currency,
          rows.length,
          rows.filter((row) => row.permission_status === "allowed").length,
          actorUserId,
        ],
      );
      const importId = imported.rows[0]?.id;
      if (!importId) throw new Error("Pricing import did not return an import id.");

      await client.query(
        `
          INSERT INTO commerce_external_provider_endpoint (
            provider, endpoint_id, platform_id, platform_name, api_path,
            currency, vendor_unit_cost_micros, permission_status,
            is_active, source_import_id, source_exported_at
          )
          SELECT 'justoneapi', item.endpoint_id, item.platform_id, item.platform_name,
                 item.api_path, item.currency, item.vendor_unit_cost_micros,
                 item.permission_status, true, $2, $3
          FROM jsonb_to_recordset($1::jsonb) AS item(
            endpoint_id text,
            platform_id text,
            platform_name text,
            api_path text,
            currency text,
            vendor_unit_cost_micros bigint,
            permission_status text
          )
          ON CONFLICT (provider, endpoint_id) DO UPDATE
          SET platform_id = EXCLUDED.platform_id,
              platform_name = EXCLUDED.platform_name,
              api_path = EXCLUDED.api_path,
              currency = EXCLUDED.currency,
              vendor_unit_cost_micros = EXCLUDED.vendor_unit_cost_micros,
              permission_status = EXCLUDED.permission_status,
              is_active = true,
              source_import_id = EXCLUDED.source_import_id,
              source_exported_at = EXCLUDED.source_exported_at,
              updated_at = CURRENT_TIMESTAMP
        `,
        [JSON.stringify(rows), importId, sourceExportedAt],
      );
      await client.query(
        `UPDATE commerce_external_provider_endpoint
         SET is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE provider = 'justoneapi' AND source_import_id <> $1 AND is_active = true`,
        [importId],
      );
      const readback = await client.query<{
        active_rows: string;
        allowed_rows: string;
        search_price_micros: string | null;
      }>(
        `
          SELECT count(*) FILTER (WHERE is_active)::text AS active_rows,
                 count(*) FILTER (WHERE is_active AND permission_status = 'allowed')::text AS allowed_rows,
                 max(vendor_unit_cost_micros) FILTER (
                   WHERE is_active AND endpoint_id = 'search.search_v1'
                 )::text AS search_price_micros
          FROM commerce_external_provider_endpoint
          WHERE provider = 'justoneapi'
        `,
      );
      const summary = readback.rows[0];
      if (Number.parseInt(summary?.active_rows || "0", 10) !== rows.length) {
        throw new Error("Provider endpoint readback count does not match the imported workbook.");
      }
      await client.query("COMMIT");
      console.log(JSON.stringify({
        ok: true,
        idempotent: false,
        sourceFilename: basename(sourcePath),
        sourceExportedAt: sourceExportedAt.toISOString(),
        rowCount: rows.length,
        allowedRowCount: Number.parseInt(summary?.allowed_rows || "0", 10),
        searchEndpointId: "search.search_v1",
        searchUnitPriceMicros: Number.parseInt(summary?.search_price_micros || "0", 10),
        currency,
      }));
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

function readPricingRows(sheet: ExcelJS.Worksheet, currency: string): PricingRow[] {
  const rows: PricingRow[] = [];
  for (let rowNumber = 6; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const platformName = row.getCell(1).text.trim();
    const apiPath = row.getCell(2).text.trim();
    const unitPrice = row.getCell(3).text.trim();
    const permission = row.getCell(4).text.trim();
    if (![platformName, apiPath, unitPrice, permission].some(Boolean)) continue;
    if (!platformName || !apiPath || !unitPrice || !permission) {
      throw new Error(`Pricing row ${rowNumber} is incomplete.`);
    }
    const identity = justOneApiEndpointIdentity(apiPath);
    const permissionStatus = parsePermission(permission, rowNumber);
    rows.push({
      endpoint_id: identity.endpointId,
      platform_id: identity.platformId,
      platform_name: platformName,
      api_path: identity.apiPath,
      currency,
      vendor_unit_cost_micros: parseMoneyMicros(unitPrice, permissionStatus, rowNumber),
      permission_status: permissionStatus,
    });
  }
  return rows;
}

function assertHeaders(sheet: ExcelJS.Worksheet): void {
  const headers = [1, 2, 3, 4].map((column) => sheet.getRow(5).getCell(column).text.trim());
  const expected = ["平台", "API", "单价 / 请求", "权限"];
  if (headers.some((header, index) => header !== expected[index])) {
    throw new Error(`Unexpected pricing headers: ${headers.join(" | ")}`);
  }
}

function assertUniqueRows(rows: PricingRow[]): void {
  const endpointIds = new Set<string>();
  const apiPaths = new Set<string>();
  for (const row of rows) {
    if (endpointIds.has(row.endpoint_id)) throw new Error(`Duplicate endpoint id ${row.endpoint_id}.`);
    if (apiPaths.has(row.api_path)) throw new Error(`Duplicate API path ${row.api_path}.`);
    endpointIds.add(row.endpoint_id);
    apiPaths.add(row.api_path);
  }
}

function parseMoneyMicros(
  value: string,
  permission: PricingRow["permission_status"],
  rowNumber: number,
): number | null {
  const normalized = value.replace(/[¥￥,\s]/g, "");
  if (normalized === "N/A" && permission === "unavailable") return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) throw new Error(`Pricing row ${rowNumber} has an invalid unit price.`);
  const whole = Number.parseInt(match[1] ?? "0", 10);
  const fraction = Number.parseInt((match[2] ?? "").padEnd(6, "0"), 10);
  const micros = whole * 1_000_000 + fraction;
  if (!Number.isSafeInteger(micros) || micros <= 0) {
    throw new Error(`Pricing row ${rowNumber} has an unsupported unit price.`);
  }
  return micros;
}

function parsePermission(value: string, rowNumber: number): PricingRow["permission_status"] {
  if (value === "允许") return "allowed";
  if (value === "未开通") return "unavailable";
  throw new Error(`Pricing row ${rowNumber} has an unknown permission value.`);
}

function parseCurrency(value: string): string {
  const match = /\(([A-Z]{3})\)/.exec(value);
  if (!match?.[1]) throw new Error("Pricing workbook currency is missing.");
  return match[1];
}

function parseExportTime(value: string): Date {
  const match = /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC\+8/.exec(value);
  if (!match) throw new Error("Pricing workbook export time is invalid.");
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Pricing workbook export time is invalid.");
  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} is invalid.`);
  return parsed;
}

function readArgument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim();
  if (!value) throw new Error(`Missing required argument ${prefix}...`);
  return value;
}
