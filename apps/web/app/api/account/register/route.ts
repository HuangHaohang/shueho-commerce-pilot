import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { authErrorResponse, jsonWithAuthHeaders, toPublicAuthUser } from "@/lib/auth/http";
import { createPhoneEmailAlias, normalizeEmail, normalizePhoneNumber } from "@/lib/auth/identity";
import { firstValidationError, registerBodySchema } from "@/lib/auth/validation";
import { validateEnterpriseInvitationRegistration } from "@/lib/enterprise/invitations";

export async function POST(request: Request) {
  const parsed = registerBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: firstValidationError(parsed.error) }, { status: 400 });
  }

  const { identifierType, identifier, name, password, rememberMe, invitationToken } = parsed.data;
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

  const publicRegistrationAllowed =
    process.env.NODE_ENV !== "production" && process.env.COMMERCE_ALLOW_PUBLIC_REGISTRATION === "true";
  if (!invitationToken && !publicRegistrationAllowed) {
    return NextResponse.json(
      { error: "Commerce Pilot 仅开放 Enterprise 受邀账号注册。", code: "ENTERPRISE_INVITATION_REQUIRED" },
      { status: 403 },
    );
  }
  if (invitationToken) {
    if (identifierType !== "email") {
      return NextResponse.json({ error: "企业邀请必须使用受邀工作邮箱注册。" }, { status: 400 });
    }
    const invitationMatches = await validateEnterpriseInvitationRegistration(email, invitationToken).catch(() => false);
    if (!invitationMatches) {
      return NextResponse.json(
        { error: "邀请无效、已过期，或与工作邮箱不匹配。", code: "INVITATION_REGISTRATION_MISMATCH" },
        { status: 403 },
      );
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
