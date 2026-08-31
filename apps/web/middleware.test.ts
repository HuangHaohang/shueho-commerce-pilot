import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "./middleware";

describe("API request size boundaries", () => {
  it("allows a bounded private product-artifact multipart upload", async () => {
    const response = middleware(new NextRequest(
      "http://localhost/api/internal/product-catalog/import-artifact",
      {
        method: "POST",
        headers: { "content-length": String(5 * 1024 * 1024) },
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects an oversized private product-artifact upload before route parsing", async () => {
    const response = middleware(new NextRequest(
      "http://localhost/api/internal/product-catalog/import-artifact",
      {
        method: "POST",
        headers: { "content-length": String(6 * 1024 * 1024) },
      },
    ));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "REQUEST_BODY_TOO_LARGE" });
  });
});
