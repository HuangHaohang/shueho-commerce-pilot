import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadProxySubscription } from "./justoneapi-proxy-download.js";

afterEach(() => vi.unstubAllGlobals());
const defaults = { allowedRedirectOrigins: [], format: "unchanged" as const };

describe("protected subscription download", () => {
  it("never forwards a subscription credential to an unapproved redirect origin", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 301, headers: { Location: "https://unknown.invalid/sub?token=secret" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(downloadProxySubscription("https://provider.invalid/sub?token=secret", defaults)).rejects.toThrow("not explicitly allowed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("supports an explicitly approved alias and requested Clash format without enabling global proxy settings", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (url: URL) => {
      urls.push(url.href);
      return urls.length === 1
        ? new Response(null, { status: 301, headers: { Location: "https://alias.invalid/sub?token=secret" } })
        : new Response("proxies: []");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await downloadProxySubscription("https://provider.invalid/sub?token=secret", { allowedRedirectOrigins: ["https://alias.invalid"], format: "meta" });
    expect(result).toBe("proxies: []");
    expect(urls.map((url) => new URL(url).searchParams.get("flag"))).toEqual(["meta", "meta"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects insecure redirects, credential-bearing allowlists and oversized source bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "http://provider.invalid/sub" } })));
    await expect(downloadProxySubscription("https://provider.invalid/sub", defaults)).rejects.toThrow("HTTPS");
    await expect(downloadProxySubscription("https://provider.invalid/sub", { ...defaults, allowedRedirectOrigins: ["https://alias.invalid/?token=private"] })).rejects.toThrow("origins only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(2_097_153))));
    await expect(downloadProxySubscription("https://provider.invalid/sub", defaults)).rejects.toThrow("size limit");
  });
});
