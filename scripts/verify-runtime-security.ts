import "dotenv/config";

import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ensureAppOwnedCodexConfig } from "../src/codex/runtime-config.js";
import { readThreadContextUsage, shouldAutoCompact } from "../src/gateway/compaction-policy.js";
import { readGatewayConfig } from "../src/gateway/config.js";

const config = readGatewayConfig();
const configPath = await ensureAppOwnedCodexConfig(config);
const generatedConfig = await readFile(configPath, "utf8");
const runtimeRelativePath = relative(config.codexHome, config.runtimeRoot);

if (!runtimeRelativePath || runtimeRelativePath.startsWith("..") || isAbsolute(runtimeRelativePath)) {
  throw new Error("Commerce runtimeRoot must be a child of CODEX_HOME.");
}

const requiredLines = [
  'approval_policy = "never"',
  'sandbox_mode = "read-only"',
  "allow_login_shell = false",
  "shell_tool = false",
  "unified_exec = false",
  "shell_snapshot = false",
  "apps = false",
  "code_mode.enabled = false",
  "hooks = true",
  "default_mode_request_user_input = true",
  "multi_agent = true",
  "remote_plugin = false",
  "skill_mcp_dependency_install = false",
  "view_image = false",
  "web_search = true",
  "[mcp_servers.commerce_web]",
  "required = true",
  'enabled_tools = ["search"]',
  'default_tools_approval_mode = "auto"',
  '"COMMERCE_WEB_SEARCH_TIMEOUT_MS"',
  '"COMMERCE_WEB_SEARCH_MAX_ATTEMPTS"',
  'inherit = "none"',
];

const missingLines = requiredLines.filter((line) => !generatedConfig.includes(line));
if (missingLines.length > 0) {
  throw new Error(`Generated Codex config is missing security controls: ${missingLines.join(", ")}`);
}
if (process.platform === "win32" && !generatedConfig.includes("commerce-runtime-hook.cmd")) {
  throw new Error("Generated Windows Codex config is missing the managed Hook command wrapper.");
}

const managedHookPath = join(config.codexHome, "managed-hooks/commerce-runtime-hook.mjs");
const managedWindowsHookPath = join(config.codexHome, "managed-hooks/commerce-runtime-hook.cmd");
const managedHookSource = await readFile(managedHookPath, "utf8");
const managedWindowsHookSource = await readFile(managedWindowsHookPath, "utf8");
const productionRequirements = await readFile(
  resolve("runtime/commerce-requirements.toml"),
  "utf8",
);
if (!productionRequirements.includes("allow_managed_hooks_only = true")) {
  throw new Error("Production requirements do not enforce managed-only Hooks.");
}
for (const eventName of [
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "Stop",
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
]) {
  if (!generatedConfig.includes(`[[hooks.${eventName}]]`)) {
    throw new Error(`Generated Codex config is missing managed hook ${eventName}.`);
  }
}
if (!managedHookSource.includes("Commerce Pilot runtime allowlist")) {
  throw new Error("Managed Hook runner does not contain the Commerce Pilot allowlist policy.");
}
if (!managedHookSource.includes('"web_search"')) {
  throw new Error("Managed Hook runner does not allow the native Codex Web Search tool.");
}
if (!managedHookSource.includes('"commerce_skill.publish"')) {
  throw new Error("Managed Hook runner does not allow the approval-gated Commerce Skill publisher.");
}
if (!managedHookSource.includes('"request_user_input"')) {
  throw new Error("Managed Hook runner does not allow Harness user questions in Default mode.");
}
if (!managedHookSource.includes("Object.keys(output).length > 0")) {
  throw new Error("Managed Hook runner must keep successful observe-only Hook stdout empty.");
}
if (process.platform === "win32" && !managedWindowsHookSource.includes('set "SystemRoot=')) {
  throw new Error("Managed Windows Hook wrapper does not initialize SystemRoot.");
}

if (generatedConfig.includes('sandbox_mode = "workspace-write"') || generatedConfig.includes('sandbox_mode = "danger-full-access"')) {
  throw new Error("Generated Codex config enables a write-capable sandbox.");
}
if (config.autoCompactThresholdPercent < 1 || config.autoCompactThresholdPercent > 95) {
  throw new Error("Automatic compaction threshold is outside the supported range.");
}
const thresholdUsage = readThreadContextUsage({
  threadId: "thread_12345",
  turnId: "turn_12345",
  tokenUsage: {
    last: { inputTokens: 75_000, totalTokens: 75_000 },
    modelContextWindow: 100_000,
  },
});
if (!thresholdUsage || !shouldAutoCompact(thresholdUsage, 75) || shouldAutoCompact({ ...thresholdUsage, utilization: 0.749 }, 75)) {
  throw new Error("Automatic compaction threshold policy failed its boundary check.");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      runtimeRootInsideCodexHome: true,
      toolPolicy: "application-registered-only",
      shell: false,
      hostFilesystem: false,
      arbitraryProcessNetwork: false,
      hostedWebSearch: true,
      managedMcpWebSearch: true,
      managedSkillPublisher: true,
      defaultModeRequestUserInput: true,
      nativeProviderWebSearch: true,
      multiAgent: true,
      localPathImageReader: false,
      managedHooks: true,
      managedHookEvents: 11,
      nativeContextCompaction: true,
      autoCompactThresholdPercent: config.autoCompactThresholdPercent,
      compactionTimeoutMs: config.compactionTimeoutMs,
      developmentHookTrust: "app-owned-bypass",
      productionHookTrust: "requirements-managed-only",
      checkedControls: requiredLines.length + 2,
    },
    null,
    2,
  ),
);
