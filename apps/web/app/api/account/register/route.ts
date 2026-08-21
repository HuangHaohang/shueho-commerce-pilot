import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { authErrorResponse, jsonWithAuthHeaders, toPublicAuthUser } from "@/lib/auth/http";
import { createPhoneEmailAlias, normalizeEmail, normalizePhoneNumber } from "@/lib/auth/identity";
import { firstValidationError, registerBodySchema } from "@/lib/auth/validation";

export async function POST(request: Request) {
  const parsed = registerBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: firstValidationError(parsed.error) }, { status: 400 });
  }

  const { identifierType, identifier, name, password, rememberMe } = parsed.data;
  let email: string;
  let phoneNumber: string | undefined;

  if (identifierType === "phone") {
    const normalizedPhone = normalizePhoneNumber(identifier);
    if (!normalizedPhone) {
      return NextResponse.json({ error: "请输入有效的手机号码。" }, { status: 400 });
    }
    phoneNumber = normalizedPhone;
    email = createPhoneEmailAlias(normalizedPhone);
  } else {
    email = normalizeEmail(identifier);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "请输入有效的电子邮箱地址。" }, { status: 400 });
    }
  }

  try {
    const result = await auth.api.signUpEmail({
      headers: request.headers,
      body: {
        name,
        email,
        password,
        rememberMe,
        ...(phoneNumber ? { phoneNumber } : {}),
      },
      returnHeaders: true,
    });

    return jsonWithAuthHeaders({ user: toPublicAuthUser(result.response.user) }, result.headers, 201);
  } catch (error) {
    return authErrorResponse(error, "register");
  }
}
