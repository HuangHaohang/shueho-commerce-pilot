import { NextResponse } from "next/server";

import { gatewayHeaders } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

type GatewayHealth = {
  ok?: boolean;
  gateway?: string;
  instanceId?: string;
  codex?: {
    running?: boolean;
    initialized?: boolean;
    pendingServerRequests?: number;
  };
  provider?: {
    id?: string;
    configured?: boolean;
    imageModel?: string;
    webSearchModel?: string;
    titleModel?: string;
    wireApi?: string;
  };
  managedMcp?: {
    state?: "unknown" | "loading" | "ready" | "failed";
    available?: boolean;
    serverName?: string;
    tools?: string[];
    checkedAt?: string | null;
    error?: string | null;
  };
  externalData?: {
    provider?: string;
    configured?: boolean;
    connected?: boolean;
    controlConfigured?: boolean;
    businessTools?: string[];
    checkedAt?: string | null;
    error?: string | null;
  };
  productCatalog?: {
    configured?: boolean;
  };
  runtimePolicy?: {
    maxTurnDurationMs?: number;
  };
};

export async function GET() {
  const gatewayUrl = process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787";
  const startedAt = Date.now();

  try {
    const response = await fetch(new URL("/health", gatewayUrl), {
      headers: gatewayHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    const data = (await response.json().catch(() => null)) as GatewayHealth | null;

    return NextResponse.json({
      ok: response.ok && data?.ok === true,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      gateway: data?.gateway ?? null,
      instanceId: data?.instanceId ?? null,
      codex: data?.codex ?? null,
      provider: data?.provider ?? null,
      managedMcp: data?.managedMcp ?? null,
      externalData: data?.externalData ?? null,
      productCatalog: data?.productCatalog ?? null,
      runtimePolicy: data?.runtimePolicy ?? null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      gateway: null,
      instanceId: null,
      codex: null,
      provider: null,
      managedMcp: null,
      externalData: null,
      productCatalog: null,
      runtimePolicy: null,
      error: error instanceof Error ? error.message : "Gateway health check failed.",
    });
  }
}
