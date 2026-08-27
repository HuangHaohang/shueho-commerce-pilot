import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import {
  createMcpAccessToken,
  listMcpAccessTokens,
  McpAccessTokenError,
} from "@/lib/enterprise/mcp-access-tokens";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(["external_data.catalog.read", "external_data.call"]))
    .min(1)
    .max(2)
    .transform((items) => [...new Set(items)]),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
});

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "mcp.access_token.manage");
  if (!access.ok) return access.response;
  try {
    return NextResponse.json({
      tokens: await listMcpAccessTokens(
        access.context,
        access.context.tenantPermissions.has("mcp.access_token.manage"),
      ),
      mcpUrl: process.env.COMMERCE_PUBLIC_MCP_URL || "http://127.0.0.1:8790/mcp",
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "无法读取 MCP 访问令牌。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const access = await requireAgentContext(request, "mcp.access_token.manage");
  if (!access.ok) return access.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "MCP 访问令牌参数无效。" }, { status: 400 });
  if (
    parsed.data.scopes.includes("external_data.call") &&
    !access.context.permissions.has("external_data.call")
  ) {
    return NextResponse.json({ error: "当前角色不能签发付费数据调用权限。" }, { status: 403 });
  }
  try {
    const token = await createMcpAccessToken(access.context, parsed.data);
    return NextResponse.json({ token }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof McpAccessTokenError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法创建 MCP 访问令牌。" }, { status: 503 });
  }
}
