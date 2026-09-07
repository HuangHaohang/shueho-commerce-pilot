import { randomUUID } from "node:crypto";
import { JustOneApiError, tokenFeedback } from "./justoneapi-errors.js";
import type { JustOneApiCredential } from "./justoneapi-credentials.js";
import type { JustOneApiTransport, PreparedJustOneApiRequest } from "./justoneapi-http-transport.js";
import type { JustOneApiCallIdentity, JustOneApiTokenStore, TokenReservation } from "./justoneapi-token-store.js";
import type { ProviderCallResult, ProviderEndpoint, ProviderTransportRequest } from "./types.js";

/** Sole application entry point: identity, token quota, proxy, dispatch, raw receipt and feedback. */
export class JustOneApiClient {
  private credentials: JustOneApiCredential[] = [];
  private initialization: Promise<void> | null = null;

  constructor(private readonly dependencies: {
    credentials: () => Promise<JustOneApiCredential[]>;
    store: JustOneApiTokenStore;
    transport: JustOneApiTransport;
    timeoutMs: () => number;
    configured: boolean;
  }) {}

  get configured(): boolean { return this.dependencies.configured; }

  async status() {
    await this.initialize();
    return this.dependencies.store.status(this.credentials.map((credential) => credential.id));
  }

  initialize(): Promise<void> {
    this.initialization ??= (async () => {
      this.credentials = await this.dependencies.credentials();
      await this.dependencies.store.register(this.credentials);
      await this.dependencies.store.status(this.credentials.map((credential) => credential.id));
    })();
    return this.initialization;
  }

  async call(endpoint: ProviderEndpoint, request: ProviderTransportRequest, identity: JustOneApiCallIdentity): Promise<ProviderCallResult> {
    if (!identity || identity.apiPath !== endpoint.apiPath || identity.requestSha256 !== request.requestSha256) {
      throw new JustOneApiError("Provider call requires the exact prepared warehouse identity.", "INVALID_PARAMETER", false);
    }
    try { await this.initialize(); }
    catch { throw new JustOneApiError("Provider token configuration or quota storage is unavailable.", "NOT_CONFIGURED", false); }
    const executionId = randomUUID();
    const store = this.dependencies.store;
    try { await store.begin(identity, executionId); }
    catch (error) {
      if (error instanceof JustOneApiError) throw error;
      throw new JustOneApiError("Provider call could not claim durable execution ownership.", "QUOTA_STORE_UNAVAILABLE", false);
    }
    const deadline = Date.now() + this.dependencies.timeoutMs();
    let reservation: TokenReservation | null = null;
    let transport: PreparedJustOneApiRequest | null = null;
    let mayHaveDispatched = false;
    try {
      for (let attempt = 0; attempt < this.credentials.length; attempt += 1) {
        reservation = await store.reserve(identity, executionId, this.credentials.map((item) => item.id));
        if (!reservation) break;
        const credential = this.credentials.find((item) => item.id === reservation!.tokenId);
        if (!credential) throw new Error("Reserved credential is not configured.");
        transport = await this.dependencies.transport.prepare(endpoint, request, deadline);
        // Commit the debit before handing any token or business bytes to the network adapter.
        mayHaveDispatched = true;
        const authorized = await store.dispatch(identity, executionId, reservation, transport.proxyNodeId);
        if (!authorized) {
          mayHaveDispatched = false;
          transport.close(); transport = null;
          await store.cancel(identity, reservation); reservation = null;
          continue;
        }
        const result = await transport.send(credential);
        transport.close(); transport = null;
        const uncertainResponse = result.httpStatus >= 500 || result.providerCode === 500;
        const feedback = uncertainResponse ? "none" : tokenFeedback(result.providerCode);
        // Archive before returning. Feedback changes eligibility for the next independently governed call.
        await store.complete(identity, reservation, result, feedback, uncertainResponse);
        reservation = null;
        if (uncertainResponse) throw new JustOneApiError("Provider returned an uncertain server response.", "RESULT_UNKNOWN", true);
        await store.finish(identity, executionId, result.state === "succeeded" ? "completed" : "failed");
        mayHaveDispatched = false;
        return result;
      }
      throw new JustOneApiError("No configured token has confirmed remaining quota for this endpoint.", "TOKEN_QUOTA_UNAVAILABLE", false);
    } catch (error) {
      transport?.close();
      const uncertain = mayHaveDispatched || (error instanceof JustOneApiError && error.uncertain);
      if (reservation) {
        if (uncertain) await store.unknown(identity, reservation).catch(() => undefined);
        else await store.cancel(identity, reservation).catch(() => undefined);
      }
      await store.finish(identity, executionId, uncertain ? "unknown" : "failed").catch(() => undefined);
      if (error instanceof JustOneApiError && error.uncertain === uncertain) throw error;
      throw new JustOneApiError(
        uncertain ? "Provider execution is uncertain; automatic replay is prohibited." : "Provider quota operation failed before network dispatch.",
        uncertain ? "RESULT_UNKNOWN" : "QUOTA_STORE_UNAVAILABLE", uncertain,
      );
    }
  }
}
