import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CreativeProjectContextRequestError,
  creativeProjectContextSchema,
  getCreativeProjectContext,
} from "./creative-project-context";

const responsePayload = {
  turnId: "turn-products-1",
  products: [{
    id: "33333333-3333-4333-8333-333333333333",
    title: "轻量通勤包",
    spu: "BAG-1",
    status: "active",
    variantCount: 2,
    sourceName: "ERP 产品库",
    updatedAt: "2026-08-30T00:00:00.000Z",
    imageUrl: "https://assets.example.com/bag.png",
  }],
  resolvedAt: "2026-08-30T01:00:00.000Z",
};

describe("creative project product context client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the bounded server projection and requests it without caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(getCreativeProjectContext("thread-creative-1", controller.signal)).resolves.toEqual(
      responsePayload,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/threads/thread-creative-1/product-context",
      { cache: "no-store", signal: controller.signal },
    );
  });

  it("accepts a project that has never submitted selected products", () => {
    expect(creativeProjectContextSchema.safeParse({
      turnId: null,
      products: [],
      resolvedAt: "2026-08-30T01:00:00.000Z",
    }).success).toBe(true);
  });

  it("rejects extra raw, mapping, or credential fields instead of silently accepting them", () => {
    expect(creativeProjectContextSchema.safeParse({
      ...responsePayload,
      products: [{ ...responsePayload.products[0], rawRecord: { title: "private" } }],
    }).success).toBe(false);
    expect(creativeProjectContextSchema.safeParse({
      ...responsePayload,
      credential: "broker:secret",
    }).success).toBe(false);
  });

  it("rejects more than twenty product summaries", () => {
    expect(creativeProjectContextSchema.safeParse({
      ...responsePayload,
      products: Array.from({ length: 21 }, (_, index) => ({
        ...responsePayload.products[0],
        id: `${String(index).padStart(8, "0")}-3333-4333-8333-333333333333`,
      })),
    }).success).toBe(false);
  });

  it("fails before fetch for an unsafe thread id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCreativeProjectContext("../other-tenant")).rejects.toMatchObject({
      status: 400,
      code: "PRODUCT_CONTEXT_THREAD_INVALID",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves server status and code on an authorization failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: "当前角色不能读取产品库。",
        code: "PRODUCT_CATALOG_FORBIDDEN",
      }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    const request = getCreativeProjectContext("thread-creative-1");
    await expect(request).rejects.toBeInstanceOf(CreativeProjectContextRequestError);
    await expect(request).rejects.toMatchObject({
      status: 403,
      code: "PRODUCT_CATALOG_FORBIDDEN",
    });
  });

  it("fails closed when a successful response does not match the schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...responsePayload, resolvedAt: "not-a-date" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    await expect(getCreativeProjectContext("thread-creative-1")).rejects.toMatchObject({
      status: 502,
      code: "PRODUCT_CONTEXT_INVALID_RESPONSE",
    });
  });
});
