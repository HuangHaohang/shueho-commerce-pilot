import { z } from "zod";

import { looksLikeSpreadsheetFormula, readSourcePath } from "@/lib/product-catalog/import-parser";
import {
  PRODUCT_MAPPING_TARGET_FIELDS,
  PRODUCT_MAPPING_TRANSFORMS,
  ProductCatalogError,
  type ProductImportIssue,
  type ProductMappingFieldProposal,
  type ProductMappingProposal,
} from "@/lib/product-catalog/types";

const sourcePathSchema = z.string()
  .min(2)
  .max(512)
  .regex(/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/)
  .refine((path) => !path.split("/").some((part) => ["__proto__", "prototype", "constructor"].includes(part)));

const mappingFieldSchema = z.object({
  sourcePath: sourcePathSchema,
  targetField: z.enum(PRODUCT_MAPPING_TARGET_FIELDS),
  transform: z.enum(PRODUCT_MAPPING_TRANSFORMS).default("identity"),
  required: z.boolean().default(false),
  confidence: z.number().min(0).max(1).nullable().default(null),
  evidence: z.string().trim().min(1).max(1000).nullable().default(null),
  transformOptions: z.object({}).strict().default({}),
}).strict();

const mappingProposalSchema = z.object({
  fields: z.array(mappingFieldSchema).min(2).max(PRODUCT_MAPPING_TARGET_FIELDS.length),
}).strict();

export type NormalizedProductRecord = {
  product: {
    key: string;
    title: string;
    description: string | null;
    brandName: string | null;
    categoryPath: string | null;
    imageUrl: string | null;
    attributes: Record<string, unknown>;
  };
  variant: {
    sku: string;
    title: string | null;
    gtin: string | null;
    optionValues: Record<string, unknown>;
    attributes: Record<string, unknown>;
  } | null;
  mappedValues: Map<string, { field: ProductMappingFieldProposal; rawValue: unknown }>;
};

export function parseProductMappingProposal(value: unknown): ProductMappingProposal {
  const parsed = mappingProposalSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProductCatalogError(
      "产品字段映射不符合封闭契约。",
      "PRODUCT_MAPPING_INVALID",
      422,
      parsed.error.issues.slice(0, 20).map((issue) => ({
        code: "MAPPING_SCHEMA_INVALID",
        message: issue.message,
        severity: "error",
        field: issue.path.join("."),
      })),
    );
  }
  const targets = parsed.data.fields.map((field) => field.targetField);
  if (new Set(targets).size !== targets.length) {
    throw new ProductCatalogError(
      "每个产品目标字段只能映射一次。",
      "PRODUCT_MAPPING_TARGET_DUPLICATE",
      422,
    );
  }
  for (const requiredTarget of ["product.key", "product.title"] as const) {
    const field = parsed.data.fields.find((candidate) => candidate.targetField === requiredTarget);
    if (!field || !field.required) {
      throw new ProductCatalogError(
        `映射必须包含必填字段 ${requiredTarget}。`,
        "PRODUCT_MAPPING_REQUIRED_TARGET_MISSING",
        422,
      );
    }
  }
  return parsed.data;
}

export function validateProductMappingAgainstSchema(
  proposal: ProductMappingProposal,
  availableFields: ReadonlySet<string>,
): ProductImportIssue[] {
  const issues: ProductImportIssue[] = [];
  for (const field of proposal.fields) {
    if (!availableFields.has(field.sourcePath)) {
      issues.push({
        code: "MAPPING_SOURCE_FIELD_UNKNOWN",
        message: `源字段 ${field.sourcePath} 不存在于当前导入 schema。`,
        severity: "error",
        field: field.sourcePath,
      });
    }
  }
  return issues;
}

export function buildDeterministicProductMapping(fields: string[]): ProductMappingProposal | null {
  const aliases: Array<{
    targetField: ProductMappingFieldProposal["targetField"];
    aliases: string[];
    transform: ProductMappingFieldProposal["transform"];
    required?: boolean;
  }> = [
    { targetField: "product.key", aliases: ["spu", "productid", "productcode", "internalproductkey", "货号", "商品编码", "产品编码"], transform: "nfkc", required: true },
    { targetField: "product.title", aliases: ["title", "name", "productname", "商品名称", "商品名", "产品名称"], transform: "nfkc", required: true },
    { targetField: "product.description", aliases: ["description", "desc", "productdescription", "商品描述", "产品描述"], transform: "string" },
    { targetField: "product.brand_name", aliases: ["brand", "brandname", "品牌", "品牌名称"], transform: "nfkc" },
    { targetField: "product.category_path", aliases: ["category", "categorypath", "类目", "分类", "类目路径"], transform: "nfkc" },
    { targetField: "product.image_url", aliases: ["image", "imageurl", "mainimage", "主图", "图片"], transform: "url" },
    { targetField: "product.attributes", aliases: ["attributes", "productattributes", "商品属性", "产品属性"], transform: "object" },
    { targetField: "variant.sku", aliases: ["sku", "skuid", "skucode", "internalsku", "sku编码", "规格编码"], transform: "nfkc" },
    { targetField: "variant.title", aliases: ["skutitle", "varianttitle", "规格名称", "sku名称"], transform: "nfkc" },
    { targetField: "variant.gtin", aliases: ["gtin", "ean", "upc", "barcode", "条形码", "条码"], transform: "gtin" },
    { targetField: "variant.option_values", aliases: ["optionvalues", "variantoptions", "规格属性"], transform: "object" },
    { targetField: "variant.attributes", aliases: ["variantattributes", "skuattributes", "sku属性"], transform: "object" },
  ];
  const normalizedFields = new Map(fields.map((path) => [normalizeAlias(path.split("/").at(-1) ?? ""), path]));
  const mapped: ProductMappingFieldProposal[] = [];
  for (const candidate of aliases) {
    const sourcePath = candidate.aliases.map(normalizeAlias).map((alias) => normalizedFields.get(alias)).find(Boolean);
    if (!sourcePath) continue;
    mapped.push({
      sourcePath,
      targetField: candidate.targetField,
      transform: candidate.transform,
      required: candidate.required ?? false,
      confidence: 1,
      evidence: "确定性字段别名匹配",
      transformOptions: {},
    });
  }
  return mapped.some((field) => field.targetField === "product.key") &&
    mapped.some((field) => field.targetField === "product.title")
    ? { fields: mapped }
    : null;
}

export function normalizeProductRecord(
  record: Record<string, unknown>,
  proposal: ProductMappingProposal,
  rowNumber: number,
): { value: NormalizedProductRecord | null; issues: ProductImportIssue[] } {
  const values = new Map<string, { field: ProductMappingFieldProposal; rawValue: unknown; value: unknown }>();
  const issues: ProductImportIssue[] = [];
  for (const field of proposal.fields) {
    const rawValue = readSourcePath(record, field.sourcePath);
    if (containsFormulaLikeText(rawValue)) {
      issues.push({
        code: "MAPPED_FORMULA_LIKE_CELL",
        message: "公式样式文本不能写入产品主数据。",
        severity: "error",
        rowNumber,
        field: field.sourcePath,
      });
      continue;
    }
    const normalized = normalizeValue(rawValue, field.transform);
    if (normalized === undefined || normalized === null || normalized === "") {
      if (field.required) {
        issues.push({
          code: "REQUIRED_PRODUCT_FIELD_MISSING",
          message: `必填目标字段 ${field.targetField} 没有有效值。`,
          severity: "error",
          rowNumber,
          field: field.sourcePath,
        });
      }
      continue;
    }
    values.set(field.targetField, { field, rawValue, value: normalized });
  }
  const productKey = boundedString(values.get("product.key")?.value, 255);
  const title = boundedString(values.get("product.title")?.value, 500);
  if (!productKey || !title || issues.some((issue) => issue.severity === "error")) {
    return { value: null, issues };
  }
  const sku = boundedString(values.get("variant.sku")?.value, 255);
  const mappedValues = new Map(
    [...values.entries()].map(([key, entry]) => [key, { field: entry.field, rawValue: entry.rawValue }]),
  );
  return {
    value: {
      product: {
        key: productKey,
        title,
        description: boundedString(values.get("product.description")?.value, 50_000),
        brandName: boundedString(values.get("product.brand_name")?.value, 500),
        categoryPath: boundedString(values.get("product.category_path")?.value, 1000),
        imageUrl: boundedString(values.get("product.image_url")?.value, 2048),
        attributes: plainObject(values.get("product.attributes")?.value),
      },
      variant: sku ? {
        sku,
        title: boundedString(values.get("variant.title")?.value, 500),
        gtin: boundedString(values.get("variant.gtin")?.value, 14),
        optionValues: plainObject(values.get("variant.option_values")?.value),
        attributes: plainObject(values.get("variant.attributes")?.value),
      } : null,
      mappedValues,
    },
    issues,
  };
}

function normalizeValue(value: unknown, transform: ProductMappingFieldProposal["transform"]): unknown {
  if (value === undefined || value === null) return null;
  if (transform === "identity") return value;
  if (transform === "object") return isPlainRecord(value) ? value : null;
  if (transform === "string_array") {
    if (!Array.isArray(value)) return null;
    return value.filter((item): item is string | number | boolean => ["string", "number", "boolean"].includes(typeof item))
      .map((item) => String(item).normalize("NFKC").trim())
      .filter(Boolean)
      .slice(0, 100);
  }
  const text = typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : null;
  if (text === null) return null;
  if (transform === "url") {
    try {
      const url = new URL(text.trim());
      return ["http:", "https:"].includes(url.protocol) && url.href.length <= 2048 ? url.href : null;
    } catch {
      return null;
    }
  }
  if (transform === "gtin") {
    const digits = text.normalize("NFKC").replace(/[\s-]+/g, "");
    return /^[0-9]{8,14}$/.test(digits) ? digits : null;
  }
  if (transform === "trim" || transform === "string") return text.trim();
  return text.normalize("NFKC").trim();
}

function containsFormulaLikeText(value: unknown, depth = 0): boolean {
  if (depth > 20) return true;
  if (typeof value === "string") return looksLikeSpreadsheetFormula(value);
  if (Array.isArray(value)) return value.some((item) => containsFormulaLikeText(item, depth + 1));
  if (isPlainRecord(value)) return Object.values(value).some((item) => containsFormulaLikeText(item, depth + 1));
  return false;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized && normalized.length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : null;
}

function plainObject(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function normalizeAlias(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[\s_.-]+/g, "");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
