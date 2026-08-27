import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import {
  ExternalDataGovernanceError,
  upsertExternalDataRateCard,
} from "@/lib/enterprise/external-data";

const rateCardSchema = z.object({
  endpointId: z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/).max(180),
  vendorUnitCostMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  customerUnitPriceMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export async function POST(request: Request) {
  const access = await requireAgentContext(request, "external_data.policy.manage");
  if (!access.ok) return access.response;
  const parsed = rateCardSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "费率参数无效。" }, { status: 400 });
  try {
    const rateCard = await upsertExternalDataRateCard(access.context, parsed.data);
    return NextResponse.json({ rateCard }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ExternalDataGovernanceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法保存外部数据费率。" }, { status: 503 });
  }
}
