import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { authErrorResponse, jsonWithAuthHeaders, toPublicAuthUser } from "@/lib/auth/http";
import { normalizeEmail, normalizePhoneNumber } from "@/lib/auth/identity";
import { firstValidationError, loginBodySchema } from "@/lib/auth/validation";

export async function POST(request: Request) {
  const parsed = loginBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: firstValidationError(parsed.error) }, { status: 400 });
  }

  const { identifierType, identifier, password, rememberMe } = parsed.data;
  const email = identifierType === "email" ? normalizeEmail(identifier) : null;
  const phoneNumber = identifierType === "phone" ? normalizePhoneNumber(identifier) : null;

  if (identifierType === "email" && (!email || !/^\S+@\S+\.\S+$/.test(email))) {
    return NextResponse.json({ error: "请输入有效的电子邮箱地址。" }, { status: 400 });
  }
  if (identifierType === "phone" && !phoneNumber) {
    return NextResponse.json({ error: "请输入有效的手机号码。" }, { status: 400 });
  }

  try {
    const result =
      identifierType === "phone"
        ? await auth.api.signInPhoneNumber({
            headers: request.headers,
            body: { phoneNumber: phoneNumber as string, password, rememberMe },
            returnHeaders: true,
          })
        : await auth.api.signInEmail({
            headers: request.headers,
            body: { email: email as string, password, rememberMe },
            returnHeaders: true,
          });

    return jsonWithAuthHeaders({ user: toPublicAuthUser(result.response.user) }, result.headers);
  } catch (error) {
    return authErrorResponse(error, "login");
  }
}
