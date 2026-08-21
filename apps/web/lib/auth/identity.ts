import { createHmac } from "node:crypto";

const CHINA_MOBILE_PATTERN = /^1[3-9]\d{9}$/;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const PHONE_ALIAS_DOMAIN = "phone.commerce-pilot.invalid";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhoneNumber(value: string): string | null {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (CHINA_MOBILE_PATTERN.test(compact)) {
    return `+86${compact}`;
  }

  if (/^86\d{11}$/.test(compact)) {
    return `+${compact}`;
  }

  if (/^0086\d{11}$/.test(compact)) {
    return `+${compact.slice(2)}`;
  }

  return E164_PATTERN.test(compact) ? compact : null;
}

export function isValidPhoneNumber(value: string): boolean {
  return normalizePhoneNumber(value) !== null;
}

export function createPhoneEmailAlias(phoneNumber: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required to derive phone login aliases.");
  }

  const digest = createHmac("sha256", secret).update(`phone-login:${phoneNumber}`).digest("hex");
  return `${digest}@${PHONE_ALIAS_DOMAIN}`;
}

export function isPhoneEmailAlias(email: string): boolean {
  return email.endsWith(`@${PHONE_ALIAS_DOMAIN}`);
}

export function maskPhoneNumber(phoneNumber: string): string {
  if (phoneNumber.startsWith("+86") && phoneNumber.length === 14) {
    return `${phoneNumber.slice(0, 6)}****${phoneNumber.slice(-4)}`;
  }
  return `${phoneNumber.slice(0, 4)}****${phoneNumber.slice(-3)}`;
}
