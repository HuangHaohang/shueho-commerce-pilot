import { NextResponse, type NextRequest } from "next/server";

const MAX_API_BODY_BYTES = 64 * 1024;

export function middleware(request: NextRequest) {
  if (!["POST", "PUT", "PATCH"].includes(request.method)) return NextResponse.next();
  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_API_BODY_BYTES) {
    return NextResponse.json(
      { error: "请求体过大。", code: "REQUEST_BODY_TOO_LARGE" },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
