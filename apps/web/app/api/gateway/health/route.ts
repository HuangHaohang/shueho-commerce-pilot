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
      runtimePolicy: null,
      error: error instanceof Error ? error.message : "Gateway health check failed.",
    });
  }
}
