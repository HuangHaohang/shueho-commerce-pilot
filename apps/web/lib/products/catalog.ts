import { z } from "zod";

export const PRODUCT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export type ProductContextMode = "auto" | "selected" | "none";

const productSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  spu: z.string().min(1),
  status: z.string().min(1),
  variantCount: z.number().int().nonnegative(),
  sourceName: z.string().min(1),
  updatedAt: z.string().min(1),
  imageUrl: z.string().url().nullable(),
});

const catalogStatusSchema = z.object({
  status: z.enum(["idle", "importing", "needs_review", "error"]),
  latestImportId: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const productPermissionSchema = z.object({
  canRead: z.boolean(),
  canImport: z.boolean(),
  canReview: z.boolean(),
  canManageSources: z.boolean(),
});

const productCatalogResponseSchema = z.object({
  products: z.array(productSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable().optional(),
  catalogStatus: catalogStatusSchema,
  permission: productPermissionSchema,
});

const productImportIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]).optional(),
  rowNumber: z.number().int().positive().optional(),
  field: z.string().min(1).optional(),
});

const productImportSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  fileName: z.string().min(1),
  status: z.enum(["ready_to_publish", "completed", "needs_review"]),
  totalRecords: z.number().int().nonnegative(),
  importedProducts: z.number().int().nonnegative(),
  importedVariants: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  mappingRevisionId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
});

const productImportResponseSchema = z.object({
  import: productImportSchema,
  issues: z.array(productImportIssueSchema).default([]),
});

const latestProductImportResponseSchema = z.object({
  latest: z.object({
    import: productImportSchema,
    fields: z.array(z.object({
      path: z.string().min(1),
      observedTypes: z.array(z.string().min(1)),
      presentCount: z.number().int().nonnegative(),
    })).max(500),
    issues: z.array(productImportIssueSchema).default([]),
  }).nullable(),
});

export type ProductSummary = z.infer<typeof productSummarySchema>;
export type ProductCatalogStatus = z.infer<typeof catalogStatusSchema>;
export type ProductCatalogPermission = z.infer<typeof productPermissionSchema>;
export type ProductCatalogResponse = z.infer<typeof productCatalogResponseSchema>;
export type ProductImportIssue = z.infer<typeof productImportIssueSchema>;
export type ProductImportResult = z.infer<typeof productImportSchema>;
export type ProductImportResponse = z.infer<typeof productImportResponseSchema>;
export type LatestProductImport = NonNullable<z.infer<typeof latestProductImportResponseSchema>["latest"]>;
export type LatestProductImportResponse = z.infer<typeof latestProductImportResponseSchema>;

export type ProductVariant = {
  id: string;
  sku: string;
  title: string | null;
  status: string;
  gtin: string | null;
  optionValues: Record<string, unknown>;
  revisionNumber: number;
};

export type ProductSourceBinding = {
  id: string;
  name: string;
  sourceKind: string;
  externalProductKey: string;
  lastSeenAt: string;
};

export type ProductDetail = ProductSummary & {
  description: string | null;
  brandName: string | null;
  categoryPath: string | null;
  attributes: Record<string, unknown>;
  revisionNumber: number;
  variants: ProductVariant[];
  sources: ProductSourceBinding[];
};

export class ProductCatalogRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(message: string, status: number, code = "PRODUCT_CATALOG_REQUEST_FAILED", requestId: string | null = null) {
    super(message);
    this.name = "ProductCatalogRequestError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export type ProductCatalogQuery = {
  query?: string;
  limit?: number;
  cursor?: string | null;
};

export async function getProductCatalog(
  input: ProductCatalogQuery = {},
  signal?: AbortSignal,
): Promise<ProductCatalogResponse> {
  const search = new URLSearchParams();
  const query = input.query?.trim();
  if (query) search.set("query", query);
  search.set("limit", String(Math.min(100, Math.max(1, input.limit ?? 40))));
  if (input.cursor) search.set("cursor", input.cursor);

  const response = await fetch(`/api/products?${search.toString()}`, {
    cache: "no-store",
    signal,
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) throw requestError(response, payload, "无法读取产品库。");

  const parsed = productCatalogResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProductCatalogRequestError("产品库返回了无法识别的数据。", 502, "PRODUCT_CATALOG_INVALID_RESPONSE");
  }
  return parsed.data;
}

export type ImportProductsInput = {
  file: File;
  sourceName?: string;
  idempotencyKey: string;
  mapping?: Record<string, string>;
};

export type ActivateProductImportInput = {
  importId: string;
  mappingRevisionId: string;
  idempotencyKey: string;
  confirmation: "publish";
};

export async function importProducts(input: ImportProductsInput): Promise<ProductImportResponse> {
  if (input.file.size > PRODUCT_IMPORT_MAX_BYTES) {
    throw new ProductCatalogRequestError("文件不能超过 5 MiB。", 400, "PRODUCT_IMPORT_FILE_TOO_LARGE");
  }

  const form = new FormData();
  form.set("file", input.file);
  const sourceName = input.sourceName?.trim();
  if (sourceName) form.set("sourceName", sourceName);
  form.set("idempotencyKey", input.idempotencyKey);
  if (input.mapping) form.set("mapping", JSON.stringify(input.mapping));

  const response = await fetch("/api/products/imports", {
    method: "POST",
    body: form,
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) throw requestError(response, payload, "无法导入产品数据。");

  const parsed = productImportResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProductCatalogRequestError("导入接口返回了无法识别的数据。", 502, "PRODUCT_IMPORT_INVALID_RESPONSE");
  }
  return parsed.data;
}

export async function getLatestProductImport(signal?: AbortSignal): Promise<LatestProductImportResponse> {
  const response = await fetch("/api/products/imports/latest", {
    cache: "no-store",
    signal,
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) throw requestError(response, payload, "无法读取最新产品导入批次。");

  const parsed = latestProductImportResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProductCatalogRequestError("最新产品导入返回了无法识别的数据。", 502, "PRODUCT_IMPORT_LATEST_INVALID_RESPONSE");
  }
  return parsed.data;
}

export async function activateProductImport(
  input: ActivateProductImportInput,
): Promise<ProductImportResponse> {
  const response = await fetch(`/api/products/imports/${encodeURIComponent(input.importId)}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mappingRevisionId: input.mappingRevisionId,
      idempotencyKey: input.idempotencyKey,
      confirmation: input.confirmation,
    }),
  });
  const payload = await readJsonPayload(response);
  if (!response.ok) throw requestError(response, payload, "无法发布产品导入。");

  const parsed = productImportResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProductCatalogRequestError("产品发布接口返回了无法识别的数据。", 502, "PRODUCT_IMPORT_INVALID_RESPONSE");
  }
  return parsed.data;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function requestError(response: Response, payload: unknown, fallback: string): ProductCatalogRequestError {
  const record = isRecord(payload) ? payload : null;
  const message = typeof record?.error === "string" && record.error.trim() ? record.error : fallback;
  const code = typeof record?.code === "string" && record.code.trim() ? record.code : "PRODUCT_CATALOG_REQUEST_FAILED";
  const requestId = typeof record?.requestId === "string" && record.requestId.trim() ? record.requestId : null;
  return new ProductCatalogRequestError(message, response.status, code, requestId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
