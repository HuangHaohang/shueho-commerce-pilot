import { betterAuth, type BetterAuthOptions } from "better-auth";
import { phoneNumber } from "better-auth/plugins";

import { getAuthDatabase } from "@/lib/auth/database";
import { isValidPhoneNumber } from "@/lib/auth/identity";
import { smsVerificationSender } from "@/lib/auth/delivery";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
}

export const authOptions = {
  appName: "Commerce Pilot",
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret,
  database: getAuthDatabase(),
  trustedOrigins: parseTrustedOrigins(process.env.AUTH_TRUSTED_ORIGINS),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 30,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-in/phone-number": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/phone-number/send-otp": { window: 60, max: 3 },
    },
  },
  advanced: {
    cookiePrefix: "commerce_pilot",
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [
    phoneNumber({
      requireVerification: false,
      phoneNumberValidator: isValidPhoneNumber,
      sendOTP: async ({ phoneNumber: destination, code }) => {
        await smsVerificationSender.send({
          to: destination,
          code,
          purpose: "verify-contact",
          expiresInSeconds: 300,
        });
      },
    }),
  ],
} satisfies BetterAuthOptions;

export const auth = betterAuth(authOptions);

function parseTrustedOrigins(value: string | undefined): string[] {
  if (!value) {
    return ["http://127.0.0.1:3000", "http://localhost:3000"];
  }
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
