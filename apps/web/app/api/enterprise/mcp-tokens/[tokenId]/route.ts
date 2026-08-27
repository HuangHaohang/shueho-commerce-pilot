import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import {
  McpAccessTokenError,
  revokeMcpAccessToken,
} from "@/lib/enterprise/mcp-access-tokens";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  const access = await requireAgentContext(request, "mcp.access_token.manage");
  if (!access.ok) return access.response;
  const { tokenId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(tokenId)) {
    return NextResponse.json({ error: "MCP 访问令牌标识无效。" }, { status: 400 });
  }
  try {
    await revokeMcpAccessToken(
      access.context,
      tokenId,
      access.context.tenantPermissions.has("mcp.access_token.manage"),
    );
    return NextResponse.json({ revoked: true });
  } catch (error) {
    if (error instanceof McpAccessTokenError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法撤销 MCP 访问令牌。" }, { status: 503 });
  }
}
