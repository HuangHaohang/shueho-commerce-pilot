import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "src/codex/generated");
const codex = resolve(
  root,
  "node_modules/.bin",
  process.platform === "win32" ? "codex.cmd" : "codex",
);

if (!existsSync(codex)) {
  throw new Error(`Codex binary is unavailable at ${codex}. Run npm install first.`);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const generated = spawnSync(
  codex,
  ["app-server", "generate-ts", "--experimental", "--out", output],
  { cwd: root, stdio: "inherit" },
);
if (generated.status !== 0) {
  throw new Error(`Codex App Server protocol generation failed with status ${generated.status ?? "unknown"}.`);
}

if (!existsSync(resolve(output, "ClientRequest.ts"))) {
  throw new Error("Codex App Server protocol generation did not produce ClientRequest.ts.");
}

for (const path of listTypeScriptFiles(output)) {
  const source = readFileSync(path, "utf8");
  const normalized = source.replace(
    /(from\s+["'])(\.\.?\/[^"']+)(["'];?)/g,
    (_match, prefix: string, specifier: string, suffix: string) =>
      `${prefix}${/\.[a-z0-9]+$/i.test(specifier) ? specifier : `${specifier}.js`}${suffix}`,
  );
  if (normalized !== source) writeFileSync(path, normalized, "utf8");
}

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listTypeScriptFiles(path) : entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}
