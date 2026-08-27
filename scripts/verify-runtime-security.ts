import "dotenv/config";

import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ensureAppOwnedCodexConfig } from "../src/codex/runtime-config.js";
import { readThreadContextUsage, shouldAutoCompact } from "../src/gateway/compaction-policy.js";
import { readGatewayConfig } from "../src/gateway/config.js";

const config = readGatewayConfig();
const configPath = await ensureAppOwnedCodexConfig(config);
const generatedConfig = await readFile(configPath, "utf8");
const gatewaySource = await readFile(resolve("src/gateway/server.ts"), "utf8");
const gatewayConfigSource = await readFile(resolve("src/gateway/config.ts"), "utf8");
const externalDataClientSource = await readFile(
  resolve("src/integrations/external-data-service-mcp-client.ts"),
  "utf8",
);
const userInputSource = await readFile(resolve("src/gateway/request-user-input.ts"), "utf8");
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
  '"COMMERCE_WEB_SEARCH_MODEL"',
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
if (/broadcastEvent\(\{\s*type:\s*"server_request"/.test(gatewaySource)) {
  throw new Error("Gateway source must not synthesize Codex App Server requests.");
}
if (gatewaySource.includes('"thread/inject_items"')) {
  throw new Error("Harness question answers must not be duplicated into model history.");
}
if (
  gatewayConfigSource.includes("mcp.justoneapi.com") ||
  gatewayConfigSource.includes("JUSTONEAPI_MCP_TOKEN") ||
  externalDataClientSource.includes("mcp.justoneapi.com")
) {
  throw new Error("Commerce Pilot must connect only to the SHUEHO external-data MCP service, never JustOneAPI MCP.");
}
if (!gatewayConfigSource.includes("EXTERNAL_DATA_SERVICE_MCP_TOKEN")) {
  throw new Error("Gateway config is missing the private SHUEHO external-data MCP credential.");
}
if (
  !userInputSource.includes('CODEX_REQUEST_USER_INPUT_METHOD = "item/tool/requestUserInput"') ||
  !userInputSource.includes('COMMERCE_APPROVAL_REQUESTED_METHOD = "commerce/approval/requested"')
) {
  throw new Error("Native Harness input and application approval channels are not separated.");
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
if (!managedHookSource.includes('"commerce_data.research_social_content"')) {
  throw new Error("Managed Hook runner does not allow governed social-content research.");
}
if (!managedHookSource.includes('"commerce_data.research_marketplace_products"')) {
  throw new Error("Managed Hook runner does not allow governed marketplace-product research.");
}
if (!managedHookSource.includes('"commerce_data.search_business_data"')) {
  throw new Error("Managed Hook runner does not allow curated business-data retrieval.");
}
if (!managedHookSource.includes('"commerce_data.get_research_result"')) {
  throw new Error("Managed Hook runner does not allow curated research-result reads.");
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
      governedExternalData: config.externalDataService.token ? "configured" : "disabled-without-service-token",
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
      checkedControls: requiredLines.length + 3,
    },
    null,
    2,
  ),
);
