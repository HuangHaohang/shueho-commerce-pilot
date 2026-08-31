import { z } from "zod";

import { ProductCatalogRequestError } from "./catalog";

export const productConnectorKindSchema = z.enum(["file_upload", "rest_api", "database", "erp", "pim"]);
export const productAdapterAvailabilitySchema = z.enum([
  "ready",
  "requires_operator_configuration",
  "unavailable",
]);

const publicConfigFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/),
  label: z.string().min(1).max(80),
  type: z.enum(["text", "integer", "select"]),
  required: z.boolean(),
  options: z.array(z.object({
    value: z.string().min(1).max(120),
    label: z.string().min(1).max(120),
  })).optional(),
});

const productConnectorSchema = z.object({
  key: z.string().min(1).max(120),
  version: z.string().min(1).max(40),
  displayName: z.string().min(1).max(120),
  description: z.string().min(1).max(300),
  kind: productConnectorKindSchema,
  adapterAvailability: productAdapterAvailabilitySchema,
  availabilityReason: z.string().nullable(),
  capabilities: z.object({
    testConnection: z.boolean(),
    sync: z.boolean(),
  }),
  publicConfigFields: z.array(publicConfigFieldSchema).max(24),
  secretReference: z.object({
    required: z.boolean(),
    allowedSchemes: z.array(z.enum(["env", "broker"])).max(2),
  }),
});

const sourceTestSchema = z.object({
  id: z.string().optional(),
  status: z.enum(["never", "running", "succeeded", "failed", "unavailable", "unknown"]),
  testedAt: z.string().nullable(),
  code: z.string().nullable(),
  message: z.string().nullable(),
  proof: z.object({
    readOnly: z.boolean(),
    selectAllowed: z.boolean(),
    writePrivileges: z.boolean(),
  }).optional(),
});

const productSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(160),
  connectorKey: z.string().min(1),
  connectorVersion: z.string().min(1),
  kind: productConnectorKindSchema,
  status: z.enum(["draft", "active", "paused", "error", "archived"]),
  connectionState: z.enum(["unconfigured", "untested", "ready", "unavailable", "error"]),
  adapterAvailability: productAdapterAvailabilitySchema,
  publicConfig: z.record(z.string(), z.unknown()),
  secretReference: z.object({
    configured: z.boolean(),
    scheme: z.enum(["env", "broker"]).nullable(),
    displayHint: z.string().nullable(),
  }),
  lastTest: sourceTestSchema.nullable(),
  lastSync: z.object({
    status: z.string(),
  }).passthrough().nullable(),
  sync: z.object({
    available: z.boolean(),
    reason: z.string().nullable(),
  }),
  updatedAt: z.string().min(1),
});

const permissionSchema = z.object({ canManageSources: z.boolean() });

const connectorCatalogResponseSchema = z.object({
  connectors: z.array(productConnectorSchema),
  permission: permissionSchema,
});

const productSourcesResponseSchema = z.object({
  sources: z.array(productSourceSchema),
  permission: permissionSchema,
});

const createProductSourceResponseSchema = z.object({ source: productSourceSchema });
const testProductSourceResponseSchema = z.object({
  test: sourceTestSchema.extend({
    id: z.string().min(1),
    status: z.enum(["running", "succeeded", "failed", "unavailable", "unknown"]),
    testedAt: z.string().min(1),
    proof: z.object({
      readOnly: z.boolean(),
      selectAllowed: z.boolean(),
      writePrivileges: z.boolean(),
    }),
  }),
  source: productSourceSchema,
});

export type ProductConnectorKind = z.infer<typeof productConnectorKindSchema>;
export type ProductAdapterAvailability = z.infer<typeof productAdapterAvailabilitySchema>;
export type ProductPublicConfigField = z.infer<typeof publicConfigFieldSchema>;
export type ProductConnector = z.infer<typeof productConnectorSchema>;
export type ProductSourceTest = z.infer<typeof sourceTestSchema>;
export type ProductSource = z.infer<typeof productSourceSchema>;
export type ProductConnectorCatalogResponse = z.infer<typeof connectorCatalogResponseSchema>;
export type ProductSourcesResponse = z.infer<typeof productSourcesResponseSchema>;
export type ProductSourceTestResponse = z.infer<typeof testProductSourceResponseSchema>;

export type CreateProductSourceInput = {
  idempotencyKey: string;
  name: string;
  connectorKey: string;
  connectorVersion: string;
  publicConfig: Record<string, string | number>;
  secretReference?: string;
};

const createProductSourceInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  connectorKey: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,79}$/),
  connectorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  publicConfig: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length <= 20),
  secretReference: z.string().regex(/^broker:psh_[A-Za-z0-9_-]{32,64}$/).optional(),
}).strict();

export async function getProductConnectors(signal?: AbortSignal): Promise<ProductConnectorCatalogResponse> {
  return getAndParse("/api/products/connectors", connectorCatalogResponseSchema, signal, "无法读取产品连接器。");
}

export async function getProductSources(signal?: AbortSignal): Promise<ProductSourcesResponse> {
  return getAndParse("/api/products/sources", productSourcesResponseSchema, signal, "无法读取产品数据源。");
}

export async function createProductSource(input: CreateProductSourceInput): Promise<ProductSource> {
  const validated = createProductSourceInputSchema.safeParse(input);
  if (!validated.success) {
    throw new ProductCatalogRequestError("数据源配置不符合封闭客户端契约。", 400, "PRODUCT_SOURCE_REQUEST_INVALID");
  }
  const response = await fetch("/api/products/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validated.data),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw sourceRequestError(response, payload, "无法接入产品数据源。");
  const parsed = createProductSourceResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProductCatalogRequestError("数据源接口返回了无法识别的数据。", 502, "PRODUCT_SOURCE_INVALID_RESPONSE");
  }
  return parsed.data.source;
}

export async function testProductSource(sourceId: string, idempotencyKey: string): Promise<ProductSourceTestResponse> {
  const response = await fetch(`/api/products/sources/${encodeURIComponent(sourceId)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idempotencyKey }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw sourceRequestError(response, payload, "无法测试产品数据源连接。");
  const parsed = testProductSourceResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProductCatalogRequestError("连接测试返回了无法识别的数据。", 502, "PRODUCT_SOURCE_TEST_INVALID_RESPONSE");
  }
  return parsed.data;
}

async function getAndParse<T>(
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal | undefined,
  fallback: string,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw sourceRequestError(response, payload, fallback);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ProductCatalogRequestError("产品数据源返回了无法识别的数据。", 502, "PRODUCT_SOURCE_INVALID_RESPONSE");
  }
  return parsed.data;
}

function sourceRequestError(response: Response, payload: unknown, fallback: string): ProductCatalogRequestError {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  return new ProductCatalogRequestError(
    typeof record?.error === "string" ? record.error : fallback,
    response.status,
    typeof record?.code === "string" ? record.code : "PRODUCT_SOURCE_REQUEST_FAILED",
    typeof record?.requestId === "string" ? record.requestId : null,
  );
}
