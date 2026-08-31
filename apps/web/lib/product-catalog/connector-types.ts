import type { EnterpriseScope } from "@/lib/enterprise/types";

export const PRODUCT_CONNECTOR_KINDS = ["file_upload", "rest_api", "database", "erp", "pim"] as const;
export type ProductConnectorKind = (typeof PRODUCT_CONNECTOR_KINDS)[number];

export type ProductConnectorAvailability = "ready" | "requires_operator_configuration" | "unavailable";
export type ProductSourceConnectionState = "unconfigured" | "untested" | "ready" | "unavailable" | "error";
export type ProductSourceOperationStatus = "running" | "succeeded" | "failed" | "unavailable" | "unknown";

export type ProductConnectorPublicField = {
  key: string;
  label: string;
  type: "text" | "integer" | "select";
  required: boolean;
  options?: Array<{ value: string; label: string }>;
};

export type ProductConnectorSummary = {
  key: string;
  version: string;
  displayName: string;
  description: string;
  kind: ProductConnectorKind;
  adapterAvailability: ProductConnectorAvailability;
  availabilityReason: string | null;
  capabilities: {
    testConnection: boolean;
    sync: boolean;
  };
  publicConfigFields: ProductConnectorPublicField[];
  secretReference: {
    required: boolean;
    allowedSchemes: Array<"broker">;
    handles: Array<{ handle: string; label: string }>;
  };
};

export type ProductSourceOperationResult = {
  id: string;
  status: ProductSourceOperationStatus;
  testedAt: string;
  code: string;
  message: string;
  proof: {
    readOnly: boolean;
    selectAllowed: boolean;
    writePrivileges: boolean;
  };
};

export type ProductSourceSummary = {
  id: string;
  name: string;
  connectorKey: string;
  connectorVersion: string;
  kind: ProductConnectorKind;
  status: "draft" | "active" | "paused" | "error" | "archived";
  connectionState: ProductSourceConnectionState;
  adapterAvailability: ProductConnectorAvailability;
  publicConfig: Record<string, unknown>;
  secretReference: {
    configured: boolean;
    scheme: "env" | "broker" | null;
    displayHint: string | null;
  };
  lastTest: ProductSourceOperationResult | null;
  lastSync: ProductSourceOperationResult | null;
  sync: {
    available: false;
    reason: string;
  };
  updatedAt: string;
};

export type CreateProductSourceInput = {
  idempotencyKey: string;
  name: string;
  connectorKey: string;
  connectorVersion: string;
  publicConfig: Record<string, unknown>;
  secretReference: string | null;
};

export type TestProductSourceInput = {
  sourceId: string;
  idempotencyKey: string;
};

export type ProductConnectorScope = EnterpriseScope;

export type ConnectorTestAdapterResult = Omit<ProductSourceOperationResult, "id" | "testedAt">;
