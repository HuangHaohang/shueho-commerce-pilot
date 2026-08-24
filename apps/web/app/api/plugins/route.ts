import { NextResponse } from "next/server";

import { gatewayHeaders, gatewayUrl, requireAgentContext } from "@/lib/agent/http";
import {
  buildCommercePluginInventory,
  type PluginRuntimeSignals,
} from "@/lib/plugins/catalog";

export const dynamic = "force-dynamic";

type GatewayHealthPayload = {
  ok?: boolean;
  provider?: {
    configured?: boolean;
    imageModel?: string;
  };
  managedMcp?: {
    state?: "unknown" | "loading" | "ready" | "failed";
    available?: boolean;
    tools?: string[];
    error?: string | null;
  };
};

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "agent.run");
  if (!access.ok) return access.response;

  let payload: GatewayHealthPayload | null = null;
  try {
    const response = await fetch(gatewayUrl("/health"), {
      headers: gatewayHeaders(undefined, access.context),
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    payload = (await response.json().catch(() => null)) as GatewayHealthPayload | null;
  } catch {
    payload = null;
  }

  const signals: PluginRuntimeSignals = {
    gatewayReady: payload?.ok === true,
    providerConfigured: payload?.provider?.configured === true,
    imageModel: typeof payload?.provider?.imageModel === "string" ? payload.provider.imageModel : null,
    managedMcp: {
      state: payload?.managedMcp?.state ?? "unknown",
      available: payload?.managedMcp?.available === true,
      tools: Array.isArray(payload?.managedMcp?.tools)
        ? payload.managedMcp.tools.filter((tool): tool is string => typeof tool === "string")
        : [],
      error: typeof payload?.managedMcp?.error === "string" ? payload.managedMcp.error : null,
    },
  };

  return NextResponse.json(
    {
      plugins: buildCommercePluginInventory(signals),
      policy: {
        installMode: "application-managed",
        arbitraryPackages: false,
        hostExecution: false,
        runtimeFoundation: "codex-app-server",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
