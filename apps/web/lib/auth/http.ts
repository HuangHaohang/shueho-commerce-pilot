import { APIError } from "better-auth/api";
import { NextResponse } from "next/server";

import { isPhoneEmailAlias, maskPhoneNumber } from "@/lib/auth/identity";

export type PublicAuthUser = {
  id: string;
  name: string;
  email: string | null;
  phoneNumber: string | null;
  displayIdentifier: string;
};

type AuthUserLike = {
  id: string;
  name: string;
  email: string;
  phoneNumber?: string | null;
};

export function toPublicAuthUser(user: AuthUserLike): PublicAuthUser {
  const phoneNumber = user.phoneNumber || null;
  const email = isPhoneEmailAlias(user.email) ? null : user.email;
  return {
    id: user.id,
    name: user.name,
    email,
    phoneNumber,
    displayIdentifier: phoneNumber ? maskPhoneNumber(phoneNumber) : email || "已登录",
  };
}

export function jsonWithAuthHeaders(body: unknown, authHeaders: Headers, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  const getSetCookie = (authHeaders as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie ? getSetCookie.call(authHeaders) : [];

  for (const [name, value] of authHeaders.entries()) {
    if (name.toLowerCase() !== "set-cookie") {
      response.headers.set(name, value);
    }
  }

  if (cookies.length > 0) {
    for (const cookie of cookies) {
      response.headers.append("set-cookie", cookie);
    }
  } else {
    const cookie = authHeaders.get("set-cookie");
    if (cookie) {
      response.headers.append("set-cookie", cookie);
    }
  }

  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function authErrorResponse(error: unknown, operation: "login" | "register"): NextResponse {
  if (error instanceof APIError) {
    if (error.statusCode === 429) {
      return NextResponse.json({ error: "请求过于频繁，请稍后再试。" }, { status: 429 });
    }

    const code = typeof error.body?.code === "string" ? error.body.code : "";
    if (operation === "register" && (code.includes("EXIST") || error.statusCode === 409 || error.statusCode === 422)) {
      return NextResponse.json({ error: "该邮箱或手机号已被注册。" }, { status: 409 });
    }

    if (operation === "login" && (error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 422)) {
      return NextResponse.json({ error: "账号或密码不正确。" }, { status: 401 });
    }
  }

  const safeError = error as {
    name?: unknown;
    message?: unknown;
    statusCode?: unknown;
    code?: unknown;
    body?: { code?: unknown };
  };
  if (operation === "register" && safeError.code === "23505") {
    return NextResponse.json({ error: "该邮箱或手机号已被注册。" }, { status: 409 });
  }

  console.error("Authentication operation failed.", {
    operation,
    name: typeof safeError.name === "string" ? safeError.name : "UnknownError",
    message: typeof safeError.message === "string" ? safeError.message : "Unknown authentication error",
    statusCode: typeof safeError.statusCode === "number" ? safeError.statusCode : undefined,
    code: typeof safeError.body?.code === "string" ? safeError.body.code : undefined,
  });

  return NextResponse.json({ error: "认证服务暂时不可用，请稍后重试。" }, { status: 503 });
}
