const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RuntimeTenantEnvironment = {
  NODE_ENV?: string;
  COMMERCE_RUNTIME_TENANT_ID?: string;
};

export class RuntimeTenantConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeTenantConfigurationError";
  }
}

export function readRuntimeTenantPin(
  environment: RuntimeTenantEnvironment = process.env,
): string | null {
  const value = environment.COMMERCE_RUNTIME_TENANT_ID?.trim() || null;
  if (value && !UUID_PATTERN.test(value)) {
    throw new RuntimeTenantConfigurationError("COMMERCE_RUNTIME_TENANT_ID must be a UUID.");
  }
  if (environment.NODE_ENV === "production" && !value) {
    throw new RuntimeTenantConfigurationError(
      "COMMERCE_RUNTIME_TENANT_ID is required for the production Web/BFF process.",
    );
  }
  return value;
}

export function runtimeTenantAllows(
  tenantId: string,
  environment: RuntimeTenantEnvironment = process.env,
): boolean {
  const pin = readRuntimeTenantPin(environment);
  return pin === null || pin === tenantId;
}
