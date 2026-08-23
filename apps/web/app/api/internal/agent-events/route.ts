import { NextResponse } from "next/server";

import { isAuthorizedGatewayCallback } from "@/lib/agent/internal-auth";
import {
  EnterpriseAgentEventBindingError,
  internalAgentEventSchema,
  recordTurnCompletedEvent,
  recordUsageEvent,
} from "@/lib/enterprise/usage";

export async function POST(request: Request) {
  if (!isAuthorizedGatewayCallback(request)) {
    return NextResponse.json({ error: "Unauthorized Gateway callback." }, { status: 401 });
  }
  const parsed = internalAgentEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid internal Agent event." }, { status: 400 });
  }
  try {
    if (parsed.data.kind === "usage.response.completed") {
      const result = await recordUsageEvent(parsed.data);
      return NextResponse.json({ accepted: true, inserted: result.inserted });
    }
    await recordTurnCompletedEvent(parsed.data);
    return NextResponse.json({ accepted: true });
  } catch (error) {
    if (error instanceof EnterpriseAgentEventBindingError) {
      return NextResponse.json({ error: "Internal Agent event binding is invalid." }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal Agent event could not be recorded." }, { status: 503 });
  }
}
