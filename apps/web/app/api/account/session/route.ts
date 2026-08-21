import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { toPublicAuthUser } from "@/lib/auth/http";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return NextResponse.json(
      { user: session ? toPublicAuthUser(session.user) : null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "认证服务暂时不可用。" }, { status: 503 });
  }
}
