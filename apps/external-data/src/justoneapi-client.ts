import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { JustOneApiAdmission } from "./justoneapi-admission.js";
import { defaultJustOneApiResilience, isRetryableProviderRejection, providerResultUncertain, retryDelayMs, type JustOneApiResilienceOptions } from "./justoneapi-retry-policy.js";
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
    admission: JustOneApiAdmission;
    resilience?: JustOneApiResilienceOptions;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  }) {}

  get configured(): boolean { return this.dependencies.configured; }

  async configuredCredentialIds(): Promise<string[]> {
    await this.initialize();
    return this.credentials.map((credential) => credential.id);
  }

  async status() {
    await this.initialize();
    return this.dependencies.store.status(this.credentials.map((credential) => credential.id));
  }

  initialize(): Promise<void> {
    this.initialization ??= (async () => {
      this.credentials = await this.dependencies.credentials();
      await this.dependencies.store.register(this.credentials);
      await this.dependencies.store.status(this.credentials.map((credential) => credential.id));
    })().catch((error) => { this.initialization = null; throw error; });
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
    const admission = this.dependencies.admission;
    const options = this.dependencies.resilience ?? defaultJustOneApiResilience;
    const now = this.dependencies.now ?? Date.now;
    const wait = this.dependencies.wait ?? sleep;
    const deadline = now() + options.totalTimeoutMs;
    try { await store.begin(identity, executionId, deadline); }
    catch (error) {
      if (error instanceof JustOneApiError) throw error;
      throw new JustOneApiError("Provider call could not claim durable execution ownership.", "QUOTA_STORE_UNAVAILABLE", false);
    }
    let reservation: TokenReservation | null = null;
    let transport: PreparedJustOneApiRequest | null = null;
    let leaseId: string | null = null;
    let mayHaveDispatched = false;
    let attempts = 0;
    let admissionExpired = false;
    let lastResult: ProviderCallResult | null = null;
    const tokenIds = this.credentials.map((item) => item.id);
    const delay = async (ms: number, reason: string): Promise<boolean> => {
      await store.progress(identity, executionId, attempts, reason, now() + ms);
      if (now() + ms + options.minimumAttemptWindowMs > deadline) { admissionExpired = true; return false; }
      await wait(ms);
      return true;
    };
    const release = async () => {
      transport?.close(); transport = null;
      if (leaseId) await admission.release(leaseId).catch(() => undefined);
      leaseId = null;
    };
    try {
      while (attempts < options.maxAttempts && now() + options.minimumAttemptWindowMs <= deadline) {
        const candidateLease = randomUUID();
        const permit = await admission.acquire(identity.apiPath, candidateLease, deadline + 5_000);
        if (!permit.acquired) {
          if (!await delay(Math.max(1, permit.waitMs), permit.reason ?? "capacity")) break;
          continue;
        }
        leaseId = candidateLease;
        reservation = await store.reserve(identity, executionId, tokenIds);
        if (!reservation) {
          await release();
          const availableIn = await store.availabilityDelay(identity, tokenIds);
          if (availableIn === null || !await delay(Math.max(100, availableIn), "token_cooldown")) break;
          continue;
        }
        const credential = this.credentials.find((item) => item.id === reservation!.tokenId);
        if (!credential) throw new Error("Reserved credential is not configured.");
        attempts += 1;
        await store.progress(identity, executionId, attempts, null, null);
        try {
          transport = await this.dependencies.transport.prepare(endpoint, request, Math.min(deadline, now() + this.dependencies.timeoutMs()));
        } catch (error) {
          await store.cancel(identity, reservation); reservation = null;
          await release();
          if (error instanceof JustOneApiError && error.code === "PROXY_UNAVAILABLE" && !error.uncertain &&
              attempts < options.maxAttempts && await delay(retryDelayMs(attempts, options), "proxy_unavailable")) continue;
          throw error;
        }
        // Commit the debit before handing any token or business bytes to the network adapter.
        mayHaveDispatched = true;
        const authorized = await store.dispatch(identity, executionId, reservation, transport.proxyNodeId);
        if (!authorized) {
          mayHaveDispatched = false;
          await release();
          await store.cancel(identity, reservation); reservation = null;
          continue;
        }
        const result = await transport.send(credential);
        transport.close(); transport = null;
        const uncertainResponse = providerResultUncertain(result);
        const feedback = uncertainResponse ? "none" : tokenFeedback(result.providerCode);
        // Archive each rejection before any retry can reserve another token.
        await store.complete(identity, reservation, result, feedback, uncertainResponse);
        reservation = null;
        mayHaveDispatched = !isRetryableProviderRejection(result);
        // Even an unparseable 429 closes admission, but that request remains unknown.
        const throttled = feedback === "rate_limited" || result.httpStatus === 429 && result.providerCode === null;
        const cooldown = throttled || result.state === "succeeded"
          ? await admission.feedback(identity.apiPath, throttled, result.retryAfterMs ?? null) : 0;
        if (uncertainResponse) throw new JustOneApiError("Provider returned an uncertain server response.", "RESULT_UNKNOWN", true);
        lastResult = result;
        await release();
        if (!isRetryableProviderRejection(result) || attempts >= options.maxAttempts) break;
        const backoff = Math.max(cooldown, result.retryAfterMs ?? 0, retryDelayMs(attempts, options));
        if (!await delay(backoff, throttled ? "rate_limited" : "retry_backoff")) break;
      }
      if (lastResult) {
        await store.finish(identity, executionId, lastResult.state === "succeeded" ? "completed" : "failed");
        mayHaveDispatched = false;
        return lastResult;
      }
      throw new JustOneApiError(
        admissionExpired || now() + options.minimumAttemptWindowMs >= deadline ? "Provider admission deadline exhausted before dispatch." : "No configured token has confirmed remaining quota for this endpoint.",
        admissionExpired || now() + options.minimumAttemptWindowMs >= deadline ? "ADMISSION_TIMEOUT" : "TOKEN_QUOTA_UNAVAILABLE", false);
    } catch (error) {
      const uncertain = mayHaveDispatched || (error instanceof JustOneApiError && error.uncertain);
      if (reservation) {
        if (uncertain) await store.unknown(identity, reservation).catch(() => undefined);
        else await store.cancel(identity, reservation).catch(() => undefined);
      }
      await store.finish(identity, executionId, uncertain ? "unknown" : "failed",
        error instanceof JustOneApiError ? error.code : "QUOTA_STORE_UNAVAILABLE").catch(() => undefined);
      if (error instanceof JustOneApiError && error.uncertain === uncertain) throw error;
      throw new JustOneApiError(
        uncertain ? "Provider execution is uncertain; automatic replay is prohibited." : "Provider quota operation failed before network dispatch.",
        uncertain ? "RESULT_UNKNOWN" : "QUOTA_STORE_UNAVAILABLE", uncertain,
      );
    } finally { await release(); }
  }
}
