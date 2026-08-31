export type ContentLengthCheck =
  | { ok: true; bytes: number }
  | { ok: false; code: "CONTENT_LENGTH_REQUIRED" | "CONTENT_LENGTH_INVALID" | "REQUEST_BODY_TOO_LARGE"; status: number };

export function requireBoundedContentLength(headers: Pick<Headers, "get">, maximumBytes: number): ContentLengthCheck {
  const raw = headers.get("content-length");
  if (raw === null) return { ok: false, code: "CONTENT_LENGTH_REQUIRED", status: 411 };
  if (!/^[1-9][0-9]*$/.test(raw)) return { ok: false, code: "CONTENT_LENGTH_INVALID", status: 400 };
  const bytes = Number(raw);
  if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) {
    return { ok: false, code: "REQUEST_BODY_TOO_LARGE", status: 413 };
  }
  return { ok: true, bytes };
}
