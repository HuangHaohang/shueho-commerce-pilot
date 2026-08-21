import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function resolveCodexBin(appRoot: string, override?: string): string {
  if (override && override.trim().length > 0) {
    return override.trim();
  }

  const dependencyCandidates = [
    join(appRoot, "node_modules", ".bin", process.platform === "win32" ? "codex.cmd" : "codex"),
    join(appRoot, "node_modules", "@openai", "codex", "bin", "codex.js"),
    resolveCodexVendorBin(appRoot),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const checked: string[] = [];
  for (const candidate of dependencyCandidates) {
    const result = checkCandidate(candidate);
    checked.push(result);
    if (result.startsWith("ok:")) {
      return candidate;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const globalCodex = checkCandidate("codex");
    checked.push(globalCodex);
    if (globalCodex.startsWith("ok:")) {
      return "codex";
    }
  }

  throw new Error(
    [
      "Unable to resolve a runnable Codex runtime for the web application.",
      "Install app dependencies so @openai/codex is present, or set CODEX_BIN to an explicit Codex App Server binary.",
      "Production must not rely on a developer-global codex executable.",
      "Checked candidates:",
      ...checked.map((line) => `- ${line}`),
    ].join("\n"),
  );
}

function resolveCodexVendorBin(appRoot: string): string | undefined {
  const target = getCodexPlatformTarget();
  if (!target) {
    return undefined;
  }

  return join(
    appRoot,
    "node_modules",
    "@openai",
    target.packageDirectory,
    "vendor",
    target.triple,
    "bin",
    process.platform === "win32" ? "codex.exe" : "codex",
  );
}

function getCodexPlatformTarget(): { packageDirectory: string; triple: string } | undefined {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return { packageDirectory: "codex-darwin-arm64", triple: "aarch64-apple-darwin" };
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return { packageDirectory: "codex-darwin-x64", triple: "x86_64-apple-darwin" };
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return { packageDirectory: "codex-linux-arm64", triple: "aarch64-unknown-linux-musl" };
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return { packageDirectory: "codex-linux-x64", triple: "x86_64-unknown-linux-musl" };
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    return { packageDirectory: "codex-win32-arm64", triple: "aarch64-pc-windows-msvc" };
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return { packageDirectory: "codex-win32-x64", triple: "x86_64-pc-windows-msvc" };
  }

  return undefined;
}

function checkCandidate(candidate: string): string {
  if (candidate !== "codex" && !existsSync(candidate)) {
    return `missing: ${candidate}`;
  }

  const result = spawnSync(candidate, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });

  if (result.status === 0) {
    return `ok: ${candidate}`;
  }

  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  const reason = stderr || stdout || result.error?.message || `exit status ${result.status ?? "unknown"}`;
  return `failed: ${candidate}: ${reason}`;
}
