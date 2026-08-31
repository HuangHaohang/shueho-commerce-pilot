export type ProductCatalogPrincipal = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  rootThreadId: string;
};

export type ProductContextMode = "auto" | "selected" | "none";

export type ProductCatalogResult = Record<string, unknown>;

export type FirstPartyResearchSubject = {
  version: 1;
  subject_ref: string;
  snapshot_sha256: string;
  product_count: number;
  products: Array<{ product_id: string; product_revision_id: string }>;
};

export type ProductCatalogApprovalEvidence = {
  approvalRequestId: string;
  approvalItemId: string;
  turnId: string;
  approvedAt: string;
};

export type ProductMappingProposal = {
  fields: Array<{
    sourcePath: string;
    targetField: string;
    transform: string;
    required: boolean;
    confidence: number | null;
    evidence: string | null;
    transformOptions: Record<string, unknown>;
  }>;
};

export class ProductCatalogControlError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProductCatalogControlError";
  }
}

export class ProductCatalogControlClient {
  constructor(
    private readonly config: {
      controlUrl?: string;
      internalToken?: string;
      timeoutMs?: number;
      maximumResultBytes?: number;
    },
  ) {}

  get configured(): boolean {
    return Boolean(this.config.controlUrl && this.config.internalToken);
  }

  listConnectors(principal: ProductCatalogPrincipal): Promise<ProductCatalogResult> {
    return this.action(principal, "list_connectors", {});
  }

  listSources(principal: ProductCatalogPrincipal): Promise<ProductCatalogResult> {
    return this.action(principal, "list_sources", {});
  }

  listImports(principal: ProductCatalogPrincipal, limit = 20): Promise<ProductCatalogResult> {
    return this.action(principal, "list_imports", { limit });
  }

  search(
    principal: ProductCatalogPrincipal,
    input: { query?: string; limit?: number; cursor?: string | null },
  ): Promise<ProductCatalogResult> {
    return this.action(principal, "search", input);
  }

  get(principal: ProductCatalogPrincipal, productId: string): Promise<ProductCatalogResult> {
    return this.action(principal, "get", { productId });
  }

  resolveContext(
    principal: ProductCatalogPrincipal,
    productIds: string[],
  ): Promise<ProductCatalogResult> {
    return this.action(principal, "resolve_context", { productIds });
  }

  resolveResearchSubject(
    principal: ProductCatalogPrincipal,
    contextSetId: string,
  ): Promise<ProductCatalogResult> {
    return this.action(principal, "resolve_research_subject", { contextSetId });
  }

  inspectImport(principal: ProductCatalogPrincipal, importId: string): Promise<ProductCatalogResult> {
    return this.action(principal, "inspect_import", { importId });
  }

  proposeMapping(
    principal: ProductCatalogPrincipal,
    input: {
      importId: string;
      proposal: ProductMappingProposal;
      idempotencyKey: string;
    } & ProductCatalogApprovalEvidence,
  ): Promise<ProductCatalogResult> {
    return this.action(principal, "propose_mapping", input);
  }

  validateMapping(
    principal: ProductCatalogPrincipal,
    input: {
      importId: string;
      mappingRevisionId: string;
      idempotencyKey: string;
    } & ProductCatalogApprovalEvidence,
  ): Promise<ProductCatalogResult> {
    return this.action(principal, "validate_mapping", input);
  }

  activateImport(
    principal: ProductCatalogPrincipal,
    input: {
      importId: string;
      mappingRevisionId: string;
      idempotencyKey: string;
      approvalRequestId: string;
      approvalItemId: string;
      turnId: string;
      approvedAt: string;
    },
  ): Promise<ProductCatalogResult> {
    return this.action(principal, "activate_import", input);
  }

  importStatus(principal: ProductCatalogPrincipal, importId: string): Promise<ProductCatalogResult> {
    return this.action(principal, "import_status", { importId });
  }

  createSourceDraft(
    principal: ProductCatalogPrincipal,
    input: {
      name: string;
      connectorKey: string;
      connectorVersion: string;
      publicConfig: Record<string, unknown>;
      secretReference: string | null;
      idempotencyKey: string;
    } & ProductCatalogApprovalEvidence,
  ): Promise<ProductCatalogResult> {
    return this.action(principal, "create_source_draft", input);
  }

  testSource(
    principal: ProductCatalogPrincipal,
    input: { sourceId: string; idempotencyKey: string } & ProductCatalogApprovalEvidence,
  ): Promise<ProductCatalogResult> {
    return this.action(principal, "test_source", input);
  }

  async createImportFromArtifact(
    principal: ProductCatalogPrincipal,
    input: {
      artifactId: string;
      artifactChecksumSha256: string;
      fileName: string;
      contentType: "text/csv" | "application/json";
      bytes: Buffer;
      sourceName: string | null;
      idempotencyKey: string;
    } & ProductCatalogApprovalEvidence,
  ): Promise<ProductCatalogResult> {
    const controlUrl = this.config.controlUrl;
    const internalToken = this.config.internalToken;
    if (!controlUrl || !internalToken) {
      throw new ProductCatalogControlError(
        "Product catalog control service is not configured.",
        "PRODUCT_CATALOG_NOT_CONFIGURED",
        503,
      );
    }
    if (!input.bytes.length || input.bytes.length > 5 * 1024 * 1024) {
      throw new ProductCatalogControlError(
        "Product import artifact is too large.",
        "PRODUCT_IMPORT_ARTIFACT_SIZE_INVALID",
        413,
      );
    }
    const form = new FormData();
    form.append("metadata", JSON.stringify({
      ...principal,
      action: "create_import_from_artifact",
      artifactId: input.artifactId,
      artifactChecksumSha256: input.artifactChecksumSha256,
      sourceName: input.sourceName,
      idempotencyKey: input.idempotencyKey,
      approvalRequestId: input.approvalRequestId,
      approvalItemId: input.approvalItemId,
      turnId: input.turnId,
      approvedAt: input.approvedAt,
    }));
    form.append("file", new Blob([new Uint8Array(input.bytes)], { type: input.contentType }), input.fileName);
    let response: Response;
    try {
      response = await fetch(`${controlUrl.replace(/\/+$/, "")}/import-artifact`, {
        method: "POST",
        headers: { "X-Commerce-Gateway-Token": internalToken },
        body: form,
        signal: AbortSignal.timeout(Math.max(this.config.timeoutMs ?? 15_000, 60_000)),
      });
    } catch {
      throw new ProductCatalogControlError(
        "Product catalog control service is unavailable.",
        "PRODUCT_CATALOG_CONTROL_UNAVAILABLE",
        503,
      );
    }
    return this.readResult(response);
  }

  private async action(
    principal: ProductCatalogPrincipal,
    action: string,
    input: Record<string, unknown>,
  ): Promise<ProductCatalogResult> {
    const controlUrl = this.config.controlUrl;
    const internalToken = this.config.internalToken;
    if (!controlUrl || !internalToken) {
      throw new ProductCatalogControlError(
        "Product catalog control service is not configured.",
        "PRODUCT_CATALOG_NOT_CONFIGURED",
        503,
      );
    }
    let response: Response;
    try {
      response = await fetch(controlUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Commerce-Gateway-Token": internalToken,
        },
        body: JSON.stringify({ ...principal, action, ...input }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
    } catch {
      throw new ProductCatalogControlError(
        "Product catalog control service is unavailable.",
        "PRODUCT_CATALOG_CONTROL_UNAVAILABLE",
        503,
      );
    }

    return this.readResult(response);
  }

  private async readResult(response: Response): Promise<ProductCatalogResult> {
    const maximumResultBytes = this.config.maximumResultBytes ?? 1_048_576;
    const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(declaredLength) && declaredLength > maximumResultBytes) {
      throw new ProductCatalogControlError(
        "Product catalog control response is too large.",
        "PRODUCT_CATALOG_RESULT_TOO_LARGE",
        502,
      );
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > maximumResultBytes) {
      throw new ProductCatalogControlError(
        "Product catalog control response is too large.",
        "PRODUCT_CATALOG_RESULT_TOO_LARGE",
        502,
      );
    }
    const payload = parseObject(raw);
    if (!response.ok) {
      throw new ProductCatalogControlError(
        typeof payload?.error === "string" ? payload.error.slice(0, 500) : "Product catalog request was rejected.",
        typeof payload?.code === "string" ? payload.code : "PRODUCT_CATALOG_CONTROL_REJECTED",
        response.status,
        isRecord(payload?.details) ? payload.details : {},
      );
    }
    if (!payload || !isRecord(payload.result)) {
      throw new ProductCatalogControlError(
        "Product catalog control returned invalid JSON.",
        "PRODUCT_CATALOG_INVALID_CONTROL_RESPONSE",
        502,
      );
    }
    return payload.result;
  }
}

export function parseFirstPartyResearchSubject(
  result: ProductCatalogResult,
  expectedSubjectRef: string,
  expectedProductIds: string[],
): FirstPartyResearchSubject {
  const value = isRecord(result.first_party_subject) ? result.first_party_subject : null;
  const products = value && Array.isArray(value.products) ? value.products : [];
  if (
    !value || value.version !== 1 || value.subject_ref !== expectedSubjectRef ||
    typeof value.snapshot_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.snapshot_sha256) ||
    value.product_count !== expectedProductIds.length || products.length !== expectedProductIds.length
  ) {
    throw new ProductCatalogControlError(
      "Product research subject response is invalid.",
      "PRODUCT_RESEARCH_SUBJECT_INVALID",
      502,
    );
  }
  const parsed = products.map((item, index) => {
    if (
      !isRecord(item) || typeof item.product_id !== "string" || !isUuid(item.product_id) ||
      typeof item.product_revision_id !== "string" || !isUuid(item.product_revision_id) ||
      item.product_id !== expectedProductIds[index]
    ) {
      throw new ProductCatalogControlError(
        "Product research subject references are invalid.",
        "PRODUCT_RESEARCH_SUBJECT_INVALID",
        502,
      );
    }
    return { product_id: item.product_id, product_revision_id: item.product_revision_id };
  });
  return {
    version: 1,
    subject_ref: value.subject_ref,
    snapshot_sha256: value.snapshot_sha256,
    product_count: value.product_count,
    products: parsed,
  };
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
