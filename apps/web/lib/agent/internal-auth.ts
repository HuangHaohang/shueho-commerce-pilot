import { timingSafeEqual } from "node:crypto";

export function isAuthorizedGatewayCallback(request: Request): boolean {
  const expected = process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN;
  const provided = request.headers.get("x-commerce-gateway-token");
  if (!expected || expected.length < 32 || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}
