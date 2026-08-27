import { createHash } from "node:crypto";

export type ExternalDataApprovalMode = "always_ask" | "task" | "policy";

export type ExternalDataPrincipal = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  rootThreadId?: string | null;
  mcpAccessTokenId?: string | null;
};

export type ExternalDataReservation = {
  reservationId: string;
  requiresApproval: boolean;
  approvalState: "pending" | "approved" | "not_required";
  pricingStatus: "priced" | "unpriced";
  currency: string;
  vendorCostMicros: number | null;
  billableAmountMicros: number | null;
  monthlyCallLimit: number;
  callsUsed: number;
  monthlySpendLimitMicros: number | null;
  spendUsedMicros: number;
};

export type AuthenticatedMcpPrincipal = ExternalDataPrincipal & {
  tokenId: string;
  scopes: Array<"external_data.catalog.read" | "external_data.call">;
};

export type ExternalDataCatalogAuthorization = {
  allowedPlatforms: string[];
  allowedEndpointIds: string[];
};

export class ExternalDataControlError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExternalDataControlError";
  }
}

export class ExternalDataControlClient {
  constructor(
    private readonly config: {
      controlUrl?: string;
      mcpAuthUrl?: string;
      internalToken?: string;
      timeoutMs?: number;
    },
  ) {}

  get configured(): boolean {
    return Boolean(this.config.controlUrl && this.config.internalToken);
  }

  async reserve(
    principal: ExternalDataPrincipal,
    input: {
      source: "codex_harness" | "external_mcp";
      threadId?: string | null;
      turnId?: string | null;
      callId: string;
      endpointId: string;
      platform: string;
      parameterHash: string;
      parameterKeys: string[];
      requestedApprovalMode: ExternalDataApprovalMode;
    },
  ): Promise<ExternalDataReservation> {
    const payload = await this.post(this.requireControlUrl(), {
      ...principal,
      ...input,
      action: "reserve",
    });
    if (!isRecord(payload.reservation)) {
      throw new ExternalDataControlError("External-data admission returned no reservation.", "INVALID_CONTROL_RESPONSE", 502);
    }
    return readReservation(payload.reservation);
  }

  async authorizeCatalog(principal: ExternalDataPrincipal): Promise<ExternalDataCatalogAuthorization> {
    const payload = await this.post(this.requireControlUrl(), { ...principal, action: "catalog" });
    if (!isRecord(payload.authorization)) {
      throw new ExternalDataControlError("External-data catalog authorization is missing.", "INVALID_CONTROL_RESPONSE", 502);
    }
    return {
      allowedPlatforms: readStringArray(payload.authorization.allowedPlatforms),
      allowedEndpointIds: readStringArray(payload.authorization.allowedEndpointIds),
    };
  }

  async approve(principal: ExternalDataPrincipal, reservationId: string): Promise<void> {
    await this.controlAction(principal, "approve", reservationId);
  }

  async dispatch(
    principal: ExternalDataPrincipal,
    reservationId: string,
    requestPayload: Record<string, unknown>,
  ): Promise<void> {
    await this.post(this.requireControlUrl(), {
      ...principal,
      action: "dispatch",
      reservationId,
      requestPayload,
    });
  }

  async cancel(
    principal: ExternalDataPrincipal,
    reservationId: string,
    reason: "user_denied" | "approval_required" | "upstream_unavailable",
  ): Promise<void> {
    await this.post(this.requireControlUrl(), {
      ...principal,
      action: "cancel",
      reservationId,
      reason,
    });
  }

  async settle(
    principal: ExternalDataPrincipal,
    reservationId: string,
    input: {
      state: "succeeded" | "business_failed" | "unknown";
      upstreamCode: number | null;
      upstreamMessage: string | null;
      resultBytes: number | null;
      responsePayload: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await this.postWithRetry(this.requireControlUrl(), {
      ...principal,
      action: "settle",
      reservationId,
      ...input,
    }, 3);
  }

  async authenticateMcpToken(token: string): Promise<AuthenticatedMcpPrincipal | null> {
    const match = /^(cp_[A-Za-z0-9]{8})_[A-Za-z0-9_-]{32,}$/.exec(token);
    if (!match) return null;
    const prefix = match[1];
    const hashHex = createHash("sha256").update(token).digest("hex");
    try {
      const payload = await this.post(this.requireMcpAuthUrl(), { prefix, hashHex });
      if (payload.authenticated !== true || !isRecord(payload.principal)) return null;
      const principal = payload.principal;
      if (
        typeof principal.tokenId !== "string" ||
        typeof principal.tenantId !== "string" ||
        typeof principal.workspaceId !== "string" ||
        typeof principal.userId !== "string" ||
        !Array.isArray(principal.scopes)
      ) {
        return null;
      }
      const scopes = principal.scopes.filter(
        (scope): scope is AuthenticatedMcpPrincipal["scopes"][number] =>
          scope === "external_data.catalog.read" || scope === "external_data.call",
      );
      if (!scopes.length) return null;
      return {
        tokenId: principal.tokenId,
        tenantId: principal.tenantId,
        workspaceId: principal.workspaceId,
        userId: principal.userId,
        rootThreadId: null,
        mcpAccessTokenId: principal.tokenId,
        scopes,
      };
    } catch (error) {
      if (error instanceof ExternalDataControlError && error.status === 401) return null;
      throw error;
    }
  }

  private async controlAction(
    principal: ExternalDataPrincipal,
    action: "approve" | "dispatch",
    reservationId: string,
  ): Promise<void> {
    await this.post(this.requireControlUrl(), { ...principal, action, reservationId });
  }

  private async post(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const token = this.config.internalToken;
    if (!token) {
      throw new ExternalDataControlError("External-data control token is not configured.", "CONTROL_NOT_CONFIGURED", 503);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Commerce-Gateway-Token": token,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
    } catch {
      throw new ExternalDataControlError("External-data control service is unavailable.", "CONTROL_UNAVAILABLE", 503);
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const record = isRecord(payload) ? payload : {};
      throw new ExternalDataControlError(
        typeof record.error === "string" ? record.error.slice(0, 500) : "External-data control request was rejected.",
        typeof record.code === "string" ? record.code : "CONTROL_REJECTED",
        response.status,
      );
    }
    if (!isRecord(payload)) {
      throw new ExternalDataControlError("External-data control returned invalid JSON.", "INVALID_CONTROL_RESPONSE", 502);
    }
    return payload;
  }

  private async postWithRetry(
    url: string,
    body: Record<string, unknown>,
    attempts: number,
  ): Promise<Record<string, unknown>> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.post(url, body);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof ExternalDataControlError &&
          (error.code === "CONTROL_UNAVAILABLE" || error.status >= 500);
        if (!retryable || attempt === attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
    throw lastError;
  }

  private requireControlUrl(): string {
    if (!this.config.controlUrl) {
      throw new ExternalDataControlError("External-data control URL is not configured.", "CONTROL_NOT_CONFIGURED", 503);
    }
    return this.config.controlUrl;
  }

  private requireMcpAuthUrl(): string {
    if (!this.config.mcpAuthUrl) {
      throw new ExternalDataControlError("MCP authentication URL is not configured.", "MCP_AUTH_NOT_CONFIGURED", 503);
    }
    return this.config.mcpAuthUrl;
  }
}

export function hashExternalDataParameters(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function externalDataParameterKeys(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.keys(value).filter((key) => /^[A-Za-z0-9_.-]{1,80}$/.test(key)).sort().slice(0, 64);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function readReservation(value: Record<string, unknown>): ExternalDataReservation {
  const reservationId = typeof value.reservationId === "string" ? value.reservationId : "";
  if (!reservationId) {
    throw new ExternalDataControlError("External-data reservation id is missing.", "INVALID_CONTROL_RESPONSE", 502);
  }
  return {
    reservationId,
    requiresApproval: value.requiresApproval === true,
    approvalState:
      value.approvalState === "approved" || value.approvalState === "not_required"
        ? value.approvalState
        : "pending",
    pricingStatus: value.pricingStatus === "priced" ? "priced" : "unpriced",
    currency: typeof value.currency === "string" ? value.currency : "CNY",
    vendorCostMicros: readNullableNumber(value.vendorCostMicros),
    billableAmountMicros: readNullableNumber(value.billableAmountMicros),
    monthlyCallLimit: readNumber(value.monthlyCallLimit),
    callsUsed: readNumber(value.callsUsed),
    monthlySpendLimitMicros: readNullableNumber(value.monthlySpendLimitMicros),
    spendUsedMicros: readNumber(value.spendUsedMicros),
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readNullableNumber(value: unknown): number | null {
  return value === null ? null : readNumber(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 500)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
