import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthorizedGatewayCallback } from "@/lib/agent/internal-auth";
import {
  authenticateMcpAccessTokenDigest,
  consumeMcpAccessTokenRateLimit,
} from "@/lib/enterprise/mcp-access-tokens";

const bodySchema = z.object({
  prefix: z.string().regex(/^cp_[A-Za-z0-9]{8}$/),
  hashHex: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request) {
  if (!isAuthorizedGatewayCallback(request)) {
    return NextResponse.json({ error: "Unauthorized MCP callback." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ authenticated: false }, { status: 400 });
  try {
    const principal = await authenticateMcpAccessTokenDigest(parsed.data.prefix, parsed.data.hashHex);
    if (principal && !(await consumeMcpAccessTokenRateLimit(principal))) {
      return NextResponse.json(
        { authenticated: false, code: "MCP_RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      principal ? { authenticated: true, principal } : { authenticated: false },
      { status: principal ? 200 : 401, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 503 });
  }
}
