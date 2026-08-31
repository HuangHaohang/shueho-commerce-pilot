import type { EnterpriseScope } from "@/lib/enterprise/types";

export const PRODUCT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMPORT_MAX_RECORDS = 10_000;
export const PRODUCT_IMPORT_MAX_FIELDS = 200;
export const PRODUCT_IMPORT_MAX_JSON_DEPTH = 20;
export const PRODUCT_CONTEXT_MAX_ITEMS = 20;

export type ProductCatalogScope = EnterpriseScope;

export type ProductCatalogPermissionState = {
  canRead: boolean;
  canImport: boolean;
  canReview: boolean;
  canManageSources: boolean;
};

export type ProductCatalogStatus = {
  status: "idle" | "importing" | "needs_review" | "error";
  latestImportId: string | null;
  updatedAt: string | null;
};

export type ProductSummary = {
  id: string;
  title: string;
  spu: string;
  status: "draft" | "active" | "archived";
  variantCount: number;
  sourceName: string;
  updatedAt: string;
  imageUrl: string | null;
};

export type ProductVariantDetail = {
  id: string;
  variantRevisionId: string;
  sku: string;
  title: string | null;
  status: "draft" | "active" | "archived";
  gtin: string | null;
  optionValues: Record<string, unknown>;
  revisionNumber: number;
};

export type ProductDetail = ProductSummary & {
  revisionId: string;
  description: string | null;
  brandName: string | null;
  categoryPath: string | null;
  attributes: Record<string, unknown>;
  revisionNumber: number;
  variants: ProductVariantDetail[];
  sources: Array<{
    id: string;
    name: string;
    sourceKind: string;
    externalProductKey: string;
    lastSeenAt: string;
  }>;
};

export type FirstPartyResearchSubject = {
  version: 1;
  subject_ref: string;
  snapshot_sha256: string;
  product_count: number;
  products: Array<{
    product_id: string;
    product_revision_id: string;
  }>;
};

export type ProductResearchSubjectResult = ProductContextResult & {
  first_party_subject: FirstPartyResearchSubject;
};

export type ProductListResult = {
  products: ProductSummary[];
  total: number;
  nextCursor: string | null;
  catalogStatus: ProductCatalogStatus;
};

export const PRODUCT_MAPPING_TARGET_FIELDS = [
  "product.key",
  "product.title",
  "product.description",
  "product.brand_name",
  "product.category_path",
  "product.image_url",
  "product.attributes",
  "variant.sku",
  "variant.title",
  "variant.gtin",
  "variant.option_values",
  "variant.attributes",
] as const;

export type ProductMappingTargetField = (typeof PRODUCT_MAPPING_TARGET_FIELDS)[number];

export const PRODUCT_MAPPING_TRANSFORMS = [
  "identity",
  "trim",
  "nfkc",
  "string",
  "string_array",
  "object",
  "url",
  "gtin",
] as const;

export type ProductMappingTransform = (typeof PRODUCT_MAPPING_TRANSFORMS)[number];

export type ProductMappingFieldProposal = {
  sourcePath: string;
  targetField: ProductMappingTargetField;
  transform: ProductMappingTransform;
  required: boolean;
  confidence: number | null;
  evidence: string | null;
  transformOptions: Record<string, unknown>;
};

export type ProductMappingProposal = {
  fields: ProductMappingFieldProposal[];
};

export type ProductImportIssue = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  rowNumber?: number;
  field?: string;
};

export type ParsedProductImport = {
  fileName: string;
  contentType: "text/csv" | "application/json";
  contentBytes: number;
  contentSha256: string;
  schemaHash: string;
  fields: string[];
  records: Array<Record<string, unknown>>;
  issues: ProductImportIssue[];
};

export type ProductImportResult = {
  id: string;
  sourceId: string;
  fileName: string;
  status: "ready_to_publish" | "completed" | "needs_review";
  totalRecords: number;
  importedProducts: number;
  importedVariants: number;
  issueCount: number;
  mappingRevisionId: string | null;
  rawPayloadAvailable: boolean;
  retentionUntil: string;
  estimatedStorageBytes: number;
  createdAt: string;
};

export type ProductImportCreateResult = {
  import: ProductImportResult;
  issues: ProductImportIssue[];
  duplicate: boolean;
};

export type ProductImportInspection = {
  import: ProductImportResult;
  schemaHash: string;
  fields: Array<{
    path: string;
    observedTypes: string[];
    presentCount: number;
    sampleValues: unknown[];
  }>;
  issues: ProductImportIssue[];
};

export type ProductMappingValidation = {
  valid: boolean;
  mappingRevisionId: string | null;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  issues: ProductImportIssue[];
};

export type ProposeProductMappingInput = {
  importId: string;
  idempotencyKey: string;
  proposal: ProductMappingProposal;
  proposalSource?: "deterministic" | "harness" | "manual";
  modelMetadata?: Record<string, unknown>;
  rootThreadId?: string | null;
  turnId?: string | null;
  toolCallId?: string | null;
};

export type ValidateProductMappingInput = {
  importId: string;
  mappingRevisionId: string;
  idempotencyKey: string;
  rootThreadId?: string | null;
  turnId?: string | null;
  toolCallId?: string | null;
};

export type ActivateProductImportInput = {
  importId: string;
  mappingRevisionId: string;
  idempotencyKey: string;
};

export type ProductContextResult = {
  products: ProductDetail[];
  resolvedAt: string;
  limitations: string[];
};

export type ProductProjectContextResult = {
  turnId: string | null;
  products: ProductSummary[];
  resolvedAt: string;
};

export class ProductCatalogError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly issues: ProductImportIssue[] = [],
  ) {
    super(message);
  }
}
