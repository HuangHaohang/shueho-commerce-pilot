import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import {
  ExternalDataGovernanceError,
  getExternalDataGovernance,
  updateExternalDataPolicy,
} from "@/lib/enterprise/external-data";

const platformSchema = z.string().regex(/^[a-z0-9_]+$/).max(64);
const endpointSchema = z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/).max(180);

const policySchema = z.object({
  status: z.enum(["enabled", "disabled"]),
  approvalMode: z.enum(["always_ask", "task", "policy"]),
  allowedPlatforms: z.array(platformSchema).max(40).transform((items) => [...new Set(items)].sort()),
  allowedEndpointIds: z.array(endpointSchema).max(500).transform((items) => [...new Set(items)].sort()),
  monthlyCallLimit: z.number().int().min(1).max(1_000_000),
  monthlySpendLimitMicros: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
  perCallAutoApprovalMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  perTurnCallLimit: z.number().int().min(1).max(100).nullable(),
  retentionDays: z.number().int().min(30).max(730).nullable(),
});

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "external_data.usage.read");
  if (!access.ok) return access.response;
  try {
    return NextResponse.json(await getExternalDataGovernance(access.context), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "无法读取外部数据治理状态。" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const access = await requireAgentContext(request, "external_data.policy.manage");
  if (!access.ok) return access.response;
  const parsed = policySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "外部数据策略参数无效。" }, { status: 400 });
  }
  try {
    const policy = await updateExternalDataPolicy(access.context, parsed.data);
    return NextResponse.json({ policy }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ExternalDataGovernanceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法更新外部数据策略。" }, { status: 503 });
  }
}
