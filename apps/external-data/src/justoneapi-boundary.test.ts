import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { credentialForToken, loadJustOneApiCredentials } from "./justoneapi-credentials.js";
import { tokenFeedback } from "./justoneapi-errors.js";
import { parseQuotaSnapshot } from "./justoneapi-quota-import.js";

describe("JustOneAPI ownership boundary", () => {
  it("deduplicates configured tokens, preserves fingerprint identity, and never silently adds the old paid token", async () => {
    const root = await mkdtemp(join(tmpdir(),"justoneapi-credentials-"));
    try {
      const path = join(root,"tokens.json");
      const token = "fixture-new-token";
      await writeFile(path,JSON.stringify({schemaVersion:1,tokens:[{token},{token}]}));
      expect(await loadJustOneApiCredentials({tokensFile:path,token:"fixture-old-token"})).toEqual([credentialForToken(token)]);
      await writeFile(path,JSON.stringify({schemaVersion:1,tokens:[{token,id:"renamed-to-reset-quota"}]}));
      await expect(loadJustOneApiCredentials({tokensFile:path,token:"fixture-old-token"})).rejects.toThrow("invalid");
      await expect(loadJustOneApiCredentials({tokensFile:join(root,"missing"),token:"fixture-old-token"})).rejects.toThrow("missing");
    } finally { await rm(root,{recursive:true,force:true}); }
  });

  it("uses explicit provider codes without treating network or generic failures as exhausted quota", () => {
    expect(tokenFeedback(100)).toBe("invalid");
    for (const code of [303,601,602]) expect(tokenFeedback(code)).toBe("endpoint_exhausted");
    expect(tokenFeedback(600)).toBe("endpoint_denied");
    expect(tokenFeedback(302)).toBe("rate_limited");
    for (const code of [null,0,301,400,500,999]) expect(tokenFeedback(code)).toBe("none");
  });

  it("requires bounded, attributable quota input and distinguishes conservative caps", () => {
    const base = {schemaVersion:1,mode:"initial",basis:"operator_conservative_cap",sourceReference:"https://dashboard.justoneapi.com/zh/dashboard/free-trial",
      observedAt:new Date().toISOString(),evidenceSha256:["a".repeat(64)],quotas:{"/api/example/v1":9}};
    expect(parseQuotaSnapshot(base).basis).toBe("operator_conservative_cap");
    expect(() => parseQuotaSnapshot({...base,sourceReference:"https://example.com/?token=private"})).toThrow();
    expect(() => parseQuotaSnapshot({...base,quotas:{"/api/example/v1":-1}})).toThrow();
    expect(() => parseQuotaSnapshot({...base,observedAt:"2099-01-01T00:00:00Z"})).toThrow();
  });

  it("keeps the HTTP sender private to the unified client runtime and removes legacy bypasses", async () => {
    const root = fileURLToPath(new URL(".",import.meta.url));
    const files = (await readdir(root)).filter((name) => name.endsWith(".ts") && !name.includes(".test.") && !name.includes("test-support"));
    const transportOwners: string[] = [];
    const tokenWriters: string[] = [];
    for (const name of files) {
      const body = await readFile(join(root,name),"utf8");
      if (/new JustOneApiHttpTransport\(/.test(body)) transportOwners.push(name);
      if (/searchParams\.set\("token"/.test(body)) tokenWriters.push(name);
      expect(body).not.toContain("new JustOneApiRestClient(");
    }
    expect(transportOwners).toEqual(["justoneapi-runtime.ts"]);
    expect(tokenWriters).toEqual(["justoneapi-http-transport.ts"]);
    const pipeline = await readFile(join(root,"pipeline.ts"),"utf8");
    expect(pipeline).toContain("getJustOneApiClient()");
    expect(pipeline).toContain("rawCallId: prepared.rawCallId");
  });
});
