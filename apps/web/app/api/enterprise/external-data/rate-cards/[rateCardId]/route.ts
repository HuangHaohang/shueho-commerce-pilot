import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import {
  ExternalDataGovernanceError,
  retireExternalDataRateCard,
} from "@/lib/enterprise/external-data";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ rateCardId: string }> },
) {
  const access = await requireAgentContext(request, "external_data.policy.manage");
  if (!access.ok) return access.response;
  const { rateCardId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(rateCardId)) {
    return NextResponse.json({ error: "费率标识无效。" }, { status: 400 });
  }
  try {
    await retireExternalDataRateCard(access.context, rateCardId);
    return NextResponse.json({ retired: true });
  } catch (error) {
    if (error instanceof ExternalDataGovernanceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法停用外部数据费率。" }, { status: 503 });
  }
}
