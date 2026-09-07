export type SubscriptionDownloadOptions = {
  allowedRedirectOrigins: string[];
  format: "unchanged" | "meta" | "clash";
};

/** A subscription GET is free. Redirect permissions here never apply to paid provider requests. */
export async function downloadProxySubscription(value: string, options: SubscriptionDownloadOptions): Promise<string> {
  let url = checkedUrl(value);
  const allowed = new Set([url.origin]);
  for (const value of options.allowedRedirectOrigins) {
    const origin = checkedUrl(value);
    if (origin.pathname !== "/" || origin.search) throw new Error("Redirect allowlist must contain HTTPS origins only.");
    allowed.add(origin.origin);
  }
  const signal = AbortSignal.timeout(30_000);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (options.format !== "unchanged") url.searchParams.set("flag", options.format);
    const response = await fetch(url, {
      headers: { "User-Agent": "clash.meta", Accept: "application/yaml,text/yaml,text/plain" },
      redirect: "manual", signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Subscription redirect is missing a location.");
      const next = checkedUrl(new URL(location, url).href);
      if (!allowed.has(next.origin)) throw new Error("Subscription redirect origin is not explicitly allowed.");
      url = next;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("Subscription download did not succeed.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 2_097_152) throw new Error("Subscription exceeds the import size limit.");
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally { await reader.cancel().catch(() => undefined); }
  }
  throw new Error("Subscription redirect limit exceeded.");
}

function checkedUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Subscription URL must use HTTPS without user-info or a fragment.");
  }
  return url;
}
