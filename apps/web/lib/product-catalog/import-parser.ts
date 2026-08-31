import { createHash } from "node:crypto";

import {
  PRODUCT_IMPORT_MAX_BYTES,
  PRODUCT_IMPORT_MAX_FIELDS,
  PRODUCT_IMPORT_MAX_JSON_DEPTH,
  PRODUCT_IMPORT_MAX_RECORDS,
  ProductCatalogError,
  type ParsedProductImport,
  type ProductImportIssue,
} from "@/lib/product-catalog/types";

const MAX_CELL_CHARACTERS = 50_000;
const MAX_PHYSICAL_CSV_ROWS = PRODUCT_IMPORT_MAX_RECORDS * 2 + 1;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function parseProductImportBuffer(input: {
  bytes: Uint8Array;
  fileName: string;
  declaredContentType?: string | null;
}): ParsedProductImport {
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > PRODUCT_IMPORT_MAX_BYTES) {
    throw new ProductCatalogError(
      "产品文件必须在 1 字节到 5 MiB 之间。",
      "PRODUCT_IMPORT_SIZE_INVALID",
      413,
    );
  }
  const fileName = normalizeFileName(input.fileName);
  const extension = fileName.toLocaleLowerCase("en-US").endsWith(".csv")
    ? ".csv"
    : fileName.toLocaleLowerCase("en-US").endsWith(".json")
      ? ".json"
      : null;
  if (!extension) {
    throw new ProductCatalogError("首版产品导入仅支持 CSV 和 JSON。", "PRODUCT_IMPORT_FORMAT_UNSUPPORTED", 415);
  }
  const contentType = extension === ".csv" ? "text/csv" as const : "application/json" as const;
  const declared = input.declaredContentType?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") ?? "";
  if (
    declared && declared !== "application/octet-stream" &&
    !(contentType === "text/csv" && ["text/csv", "text/plain", "application/vnd.ms-excel"].includes(declared)) &&
    !(contentType === "application/json" && ["application/json", "text/json", "text/plain"].includes(declared))
  ) {
    throw new ProductCatalogError("文件扩展名与内容类型不一致。", "PRODUCT_IMPORT_MIME_MISMATCH", 415);
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new ProductCatalogError("产品文件必须使用 UTF-8 编码。", "PRODUCT_IMPORT_ENCODING_INVALID", 422);
  }
  if (!text.trim()) {
    throw new ProductCatalogError("产品文件没有可导入记录。", "PRODUCT_IMPORT_EMPTY", 422);
  }

  const records = contentType === "text/csv" ? parseCsvRecords(text) : parseJsonRecords(text);
  if (!records.length) {
    throw new ProductCatalogError("产品文件没有可导入记录。", "PRODUCT_IMPORT_EMPTY", 422);
  }
  if (records.length > PRODUCT_IMPORT_MAX_RECORDS) {
    throw new ProductCatalogError(
      `单次最多导入 ${PRODUCT_IMPORT_MAX_RECORDS} 条产品记录。`,
      "PRODUCT_IMPORT_RECORD_LIMIT",
      413,
    );
  }

  const fields = collectSchemaPaths(records);
  const issues = collectUntrustedCellIssues(records);
  return {
    fileName,
    contentType,
    contentBytes: input.bytes.byteLength,
    contentSha256: sha256Bytes(input.bytes),
    schemaHash: sha256Json({ fields: fields.map((path) => ({ path, types: observedTypes(records, path) })) }),
    fields,
    records,
    issues,
  };
}

function parseJsonRecords(text: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProductCatalogError("JSON 文件格式无效。", "PRODUCT_IMPORT_JSON_INVALID", 422);
  }
  assertJsonSafety(parsed, 0);
  const candidates = Array.isArray(parsed)
    ? parsed
    : isPlainRecord(parsed) && Array.isArray(parsed.products)
      ? parsed.products
      : isPlainRecord(parsed)
        ? [parsed]
        : [];
  if (candidates.length > PRODUCT_IMPORT_MAX_RECORDS) {
    throw new ProductCatalogError(
      `单次最多导入 ${PRODUCT_IMPORT_MAX_RECORDS} 条产品记录。`,
      "PRODUCT_IMPORT_RECORD_LIMIT",
      413,
    );
  }
  return candidates.map((record, index) => {
    if (!isPlainRecord(record)) {
      throw new ProductCatalogError(
        `JSON 第 ${index + 1} 条记录必须是对象。`,
        "PRODUCT_IMPORT_RECORD_INVALID",
        422,
      );
    }
    return record;
  });
}

function parseCsvRecords(text: string): Array<Record<string, unknown>> {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.normalize("NFKC").trim());
  if (!headers.length || headers.length > PRODUCT_IMPORT_MAX_FIELDS || headers.some((header) => !header)) {
    throw new ProductCatalogError("CSV 表头必须包含 1 到 200 个非空字段。", "PRODUCT_IMPORT_HEADER_INVALID", 422);
  }
  if (
    new Set(headers).size !== headers.length ||
    headers.some((header) => FORBIDDEN_KEYS.has(header) || /[\u0000-\u001f\u007f]/u.test(header))
  ) {
    throw new ProductCatalogError("CSV 表头包含重复或禁止字段。", "PRODUCT_IMPORT_HEADER_INVALID", 422);
  }
  const records: Array<Record<string, unknown>> = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex];
    if (cells.every((cell) => !cell.trim())) continue;
    if (cells.length > headers.length || records.length >= PRODUCT_IMPORT_MAX_RECORDS) {
      throw new ProductCatalogError(
        cells.length > headers.length ? `CSV 第 ${rowIndex + 1} 行字段数超过表头。` : `单次最多导入 ${PRODUCT_IMPORT_MAX_RECORDS} 条产品记录。`,
        cells.length > headers.length ? "PRODUCT_IMPORT_CSV_WIDTH_INVALID" : "PRODUCT_IMPORT_RECORD_LIMIT",
        cells.length > headers.length ? 422 : 413,
      );
    }
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    headers.forEach((header, columnIndex) => {
      record[header] = cells[columnIndex] ?? "";
    });
    records.push(record);
  }
  return records;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      if (cell) throw new ProductCatalogError("CSV 引号位置无效。", "PRODUCT_IMPORT_CSV_INVALID", 422);
      quoted = true;
    } else if (character === ",") {
      row.push(assertCellLength(cell));
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(assertCellLength(cell));
      rows.push(row);
      if (rows.length > MAX_PHYSICAL_CSV_ROWS) {
        throw new ProductCatalogError("CSV 物理行数超过安全上限。", "PRODUCT_IMPORT_RECORD_LIMIT", 413);
      }
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new ProductCatalogError("CSV 存在未闭合引号。", "PRODUCT_IMPORT_CSV_INVALID", 422);
  if (cell.length || row.length) {
    row.push(assertCellLength(cell));
    rows.push(row);
    if (rows.length > MAX_PHYSICAL_CSV_ROWS) {
      throw new ProductCatalogError("CSV 物理行数超过安全上限。", "PRODUCT_IMPORT_RECORD_LIMIT", 413);
    }
  }
  return rows;
}

function assertCellLength(value: string): string {
  if (value.length > MAX_CELL_CHARACTERS) {
    throw new ProductCatalogError("CSV 单元格超过 50000 字符。", "PRODUCT_IMPORT_CELL_LIMIT", 413);
  }
  return value;
}

function assertJsonSafety(value: unknown, depth: number): void {
  if (depth > PRODUCT_IMPORT_MAX_JSON_DEPTH) {
    throw new ProductCatalogError("JSON 嵌套深度超过 20 层。", "PRODUCT_IMPORT_JSON_DEPTH", 413);
  }
  if (typeof value === "string" && value.length > MAX_CELL_CHARACTERS) {
    throw new ProductCatalogError("JSON 字符串超过 50000 字符。", "PRODUCT_IMPORT_CELL_LIMIT", 413);
  }
  if (Array.isArray(value)) {
    if (value.length > PRODUCT_IMPORT_MAX_RECORDS) {
      throw new ProductCatalogError("JSON 数组项数超过 10000。", "PRODUCT_IMPORT_ARRAY_LIMIT", 413);
    }
    for (const item of value) assertJsonSafety(item, depth + 1);
    return;
  }
  if (!isPlainRecord(value)) return;
  const entries = Object.entries(value);
  if (entries.length > PRODUCT_IMPORT_MAX_FIELDS) {
    throw new ProductCatalogError("JSON 单个对象字段数超过 200。", "PRODUCT_IMPORT_FIELD_LIMIT", 413);
  }
  for (const [key, child] of entries) {
    if (!key || key.length > 200 || FORBIDDEN_KEYS.has(key) || /[\u0000-\u001f\u007f]/u.test(key)) {
      throw new ProductCatalogError("JSON 包含禁止或过长字段名。", "PRODUCT_IMPORT_FIELD_INVALID", 422);
    }
    assertJsonSafety(child, depth + 1);
  }
}

function collectSchemaPaths(records: Array<Record<string, unknown>>): string[] {
  const paths = new Set<string>();
  for (const record of records.slice(0, 1000)) collectPaths(record, "", paths, 0);
  const result = [...paths].sort();
  if (result.length > PRODUCT_IMPORT_MAX_FIELDS) {
    throw new ProductCatalogError("产品数据字段路径超过 200 个。", "PRODUCT_IMPORT_FIELD_LIMIT", 413);
  }
  return result;
}

function collectPaths(value: unknown, parent: string, paths: Set<string>, depth: number): void {
  if (depth > PRODUCT_IMPORT_MAX_JSON_DEPTH || !isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = `${parent}/${escapePointer(key)}`;
    if (isPlainRecord(child)) collectPaths(child, path, paths, depth + 1);
    else paths.add(path);
  }
}

function collectUntrustedCellIssues(records: Array<Record<string, unknown>>): ProductImportIssue[] {
  const issues: ProductImportIssue[] = [];
  records.forEach((record, recordIndex) => {
    collectFormulaIssues(record, "", recordIndex + 1, issues, 0);
  });
  return issues.slice(0, 1000);
}

function collectFormulaIssues(
  value: unknown,
  path: string,
  rowNumber: number,
  issues: ProductImportIssue[],
  depth: number,
): void {
  if (issues.length >= 1000 || depth > PRODUCT_IMPORT_MAX_JSON_DEPTH) return;
  if (typeof value === "string" && looksLikeSpreadsheetFormula(value)) {
    issues.push({
      code: "FORMULA_LIKE_CELL",
      message: "检测到可能被电子表格执行的公式样式文本；原值已保留，但不会自动映射到产品主数据。",
      severity: "error",
      rowNumber,
      field: path || "/",
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFormulaIssues(item, `${path}/${index}`, rowNumber, issues, depth + 1));
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectFormulaIssues(child, `${path}/${escapePointer(key)}`, rowNumber, issues, depth + 1);
  }
}

export function looksLikeSpreadsheetFormula(value: string): boolean {
  const normalized = value.replace(/^[\u0000-\u0020]+/u, "");
  return /^[=+@]/u.test(normalized) || /^-(?![0-9]+(?:\.[0-9]+)?$)/u.test(normalized);
}

export function readSourcePath(record: Record<string, unknown>, sourcePath: string): unknown {
  if (!sourcePath.startsWith("/")) return undefined;
  const parts = sourcePath.slice(1).split("/").map(unescapePointer);
  let value: unknown = record;
  for (const part of parts) {
    if (!isPlainRecord(value) || FORBIDDEN_KEYS.has(part)) return undefined;
    value = value[part];
  }
  return value;
}

export function observedTypes(records: Array<Record<string, unknown>>, path: string): string[] {
  const types = new Set<string>();
  for (const record of records.slice(0, 1000)) {
    const value = readSourcePath(record, path);
    if (value === undefined) continue;
    types.add(value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
  }
  return [...types].sort();
}

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function normalizeFileName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 240 || /[\\/\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ProductCatalogError("产品文件名无效。", "PRODUCT_IMPORT_FILE_NAME_INVALID", 422);
  }
  return normalized;
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapePointer(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
