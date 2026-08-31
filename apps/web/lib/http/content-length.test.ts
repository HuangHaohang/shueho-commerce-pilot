import { describe, expect, it } from "vitest";

import { requireBoundedContentLength } from "./content-length";

function headers(value?: string): Headers {
  return new Headers(value === undefined ? {} : { "content-length": value });
}

describe("bounded Content-Length", () => {
  it("rejects missing, invalid, and oversized lengths before body parsing", () => {
    expect(requireBoundedContentLength(headers(), 100)).toMatchObject({ ok: false, status: 411 });
    expect(requireBoundedContentLength(headers("0"), 100)).toMatchObject({ ok: false, status: 400 });
    expect(requireBoundedContentLength(headers("10x"), 100)).toMatchObject({ ok: false, status: 400 });
    expect(requireBoundedContentLength(headers("101"), 100)).toMatchObject({ ok: false, status: 413 });
  });

  it("accepts one bounded positive integer", () => {
    expect(requireBoundedContentLength(headers("100"), 100)).toEqual({ ok: true, bytes: 100 });
  });
});
