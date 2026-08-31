import { z } from "zod";

import { ProductCatalogError } from "@/lib/product-catalog/types";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const PROFILE_PATTERN = /^[a-z0-9][a-z0-9_.-]{1,79}$/;
const OPAQUE_SECRET_HANDLE_PATTERN = /^broker:psh_[A-Za-z0-9_-]{32,64}$/;
const FORBIDDEN_CONFIG_KEYS = /password|passwd|token|secret|credential|connection.?string|dsn|base.?url|url|host|hostname|port|authorization|cookie/i;

const emptyConfigSchema = z.object({}).strict();
const databaseConfigSchema = z.object({
  schema: z.string().regex(IDENTIFIER_PATTERN),
  table: z.string().regex(IDENTIFIER_PATTERN),
}).strict();
const managedApiConfigSchema = z.object({
  connectionProfile: z.string().regex(PROFILE_PATTERN),
  resource: z.string().regex(PROFILE_PATTERN),
}).strict();
const managedSystemConfigSchema = z.object({
  systemProfile: z.string().regex(PROFILE_PATTERN),
  entity: z.string().regex(PROFILE_PATTERN),
}).strict();

export function validateConnectorPublicConfig(adapterKey: string, value: unknown): Record<string, unknown> {
  assertNoCredentialMaterial(value);
  const schema = adapterKey === "file_upload_v1"
    ? emptyConfigSchema
    : adapterKey === "postgres_readonly_v1"
      ? databaseConfigSchema
      : adapterKey === "managed_rest_v1"
        ? managedApiConfigSchema
        : adapterKey === "managed_erp_v1" || adapterKey === "managed_pim_v1"
          ? managedSystemConfigSchema
          : null;
  if (!schema) {
    throw new ProductCatalogError("连接器适配器未注册。", "PRODUCT_CONNECTOR_ADAPTER_UNKNOWN", 409);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ProductCatalogError(
      "连接器公开配置不符合封闭 schema。",
      "PRODUCT_SOURCE_CONFIG_INVALID",
      422,
      parsed.error.issues.slice(0, 20).map((issue) => ({
        code: "SOURCE_CONFIG_FIELD_INVALID",
        message: issue.message,
        severity: "error",
        field: issue.path.join("."),
      })),
    );
  }
  return parsed.data;
}

export function validateSecretReference(value: unknown, required: boolean): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new ProductCatalogError(
        "该连接器必须引用运维预置的 secret。",
        "PRODUCT_SOURCE_SECRET_REFERENCE_REQUIRED",
        422,
      );
    }
    return null;
  }
  if (typeof value !== "string" || !OPAQUE_SECRET_HANDLE_PATTERN.test(value)) {
    throw new ProductCatalogError(
      "连接密钥必须使用当前工作区由服务器签发的 opaque handle。",
      "PRODUCT_SOURCE_SECRET_REFERENCE_INVALID",
      422,
    );
  }
  return value;
}

export function redactSecretReference(value: string | null): {
  configured: boolean;
  scheme: "broker" | null;
  displayHint: string | null;
} {
  if (!value) return { configured: false, scheme: null, displayHint: null };
  return { configured: true, scheme: "broker", displayHint: "安全连接已绑定" };
}

export function isOpaqueSecretHandle(value: string): boolean {
  return OPAQUE_SECRET_HANDLE_PATTERN.test(value);
}

function assertNoCredentialMaterial(value: unknown, depth = 0): void {
  if (depth > 10) {
    throw new ProductCatalogError("连接器配置嵌套过深。", "PRODUCT_SOURCE_CONFIG_INVALID", 422);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_CONFIG_KEYS.test(key)) {
      throw new ProductCatalogError(
        `公开配置禁止包含凭据或网络位置字段 ${key}。`,
        "PRODUCT_SOURCE_CONFIG_SECRET_FIELD",
        422,
      );
    }
    assertNoCredentialMaterial(child, depth + 1);
  }
}
