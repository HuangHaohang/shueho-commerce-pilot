import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

export type JustOneApiCredential = { id: string; fingerprint: string; token: string };
const tokenSchema = z.string().trim().min(8).max(256).regex(/^[A-Za-z0-9_-]+$/);
const fileSchema = z.object({
  schemaVersion: z.literal(1),
  tokens: z.array(z.object({ id: z.string().optional(), token: tokenSchema }).strict()).min(1).max(64),
}).strict();

export function credentialForToken(token: string): JustOneApiCredential {
  const checked = tokenSchema.safeParse(token);
  if (!checked.success) throw new Error("Invalid JustOneAPI credential configuration.");
  const fingerprint = createHash("sha256").update(checked.data).digest("hex");
  return { id: `token-${fingerprint.slice(0, 24)}`, fingerprint, token: checked.data };
}

export async function loadJustOneApiCredentials(input: { token: string; tokensFile?: string }): Promise<JustOneApiCredential[]> {
  const values: string[] = [];
  if (input.tokensFile) {
    try {
      const raw = await readFile(input.tokensFile);
      if (raw.length > 65_536) throw new Error();
      const parsed = fileSchema.parse(JSON.parse(raw.toString("utf8")));
      for (const entry of parsed.tokens) {
        const credential = credentialForToken(entry.token);
        if (entry.id && entry.id !== credential.id) throw new Error();
        values.push(credential.token);
      }
    } catch { throw new Error("JustOneAPI token file is missing or invalid."); }
  }
  if (!input.tokensFile && input.token.trim()) values.push(input.token.trim());
  const credentials = [...new Set(values)].map(credentialForToken);
  if (!credentials.length || credentials.length > 64) throw new Error("Configure between one and 64 JustOneAPI tokens.");
  return credentials;
}
