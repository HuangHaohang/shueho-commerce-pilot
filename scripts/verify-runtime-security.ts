import "dotenv/config";

import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ensureAppOwnedCodexConfig } from "../src/codex/runtime-config.js";
import { readThreadContextUsage, shouldAutoCompact } from "../src/gateway/compaction-policy.js";
import { readGatewayConfig } from "../src/gateway/config.js";
import {
  createRuntimeProviderProxyIdentity,
  runtimeProviderActorAuthorizationHeader,
} from "../src/provider/runtime-provider-proxy.js";

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
const agentThreadSource = await readFile(resolve("apps/web/lib/agent/use-agent-thread.ts"), "utf8");
const workbenchSource = await readFile(
  resolve("apps/web/components/shell/commerce-workbench-shell.tsx"),
  "utf8",
);
const copywritingBriefSource = await readFile(resolve("apps/web/lib/copywriting/brief.ts"), "utf8");
const providerClientSource = await readFile(resolve("src/provider/commerce-provider-client.ts"), "utf8");
const providerProxySource = await readFile(resolve("src/provider/runtime-provider-proxy.ts"), "utf8");
const runtimeRelativePath = relative(config.codexHome, config.runtimeRoot);
const runtimeProviderProxy = createRuntimeProviderProxyIdentity(config);

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
  `base_url = ${JSON.stringify(runtimeProviderProxy.baseUrl)}`,
  JSON.stringify(runtimeProviderActorAuthorizationHeader),
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
const managedSteerRouteStart = gatewaySource.indexOf("const steerMatch =");
const managedSteerRouteEnd = gatewaySource.indexOf("const turnMatch =", managedSteerRouteStart);
const managedSteerRoute = gatewaySource.slice(managedSteerRouteStart, managedSteerRouteEnd);
if (
  managedSteerRouteStart < 0 ||
  managedSteerRouteEnd < 0 ||
  !managedSteerRoute.includes('codex.request("turn/steer"')
) {
  throw new Error("Managed workflows must use the dedicated native Harness turn/steer route.");
}
if (managedSteerRoute.includes('codex.request("turn/interrupt"')) {
  throw new Error("Managed workflow steering must not interrupt its schema-constrained Harness turn.");
}
const queuedSteerStart = gatewaySource.indexOf("async function promoteQueuedSubmissionToSteer");
const queuedSteerEnd = gatewaySource.indexOf("async function interruptTurnWithRaceRetry", queuedSteerStart);
const queuedSteerTransition = gatewaySource.slice(queuedSteerStart, queuedSteerEnd);
if (
  queuedSteerStart < 0 ||
  queuedSteerEnd < 0 ||
  queuedSteerTransition.includes('codex.request("turn/steer"')
) {
  throw new Error("Queued direction changes must not steer and then interrupt the same Harness turn.");
}
if (gatewaySource.includes("PendingSteerStore") || gatewaySource.includes("PendingSteerRegistry")) {
  throw new Error("Gateway must not persist a second pending-steer state outside the Harness queue.");
}
if (!gatewaySource.includes('codex.request("thread/turns/list"')) {
  throw new Error("Gateway history reads must use the paginated Harness Turn API.");
}
if (
  !gatewaySource.includes("async function ensureThreadResumed") ||
  !gatewaySource.includes("threadResumePromises") ||
  !gatewaySource.includes("App Server read/list APIs can inspect persisted history without")
) {
  throw new Error("History reads must avoid resume while model execution deduplicates it.");
}
if (gatewaySource.includes("includeTurns: true")) {
  throw new Error("Gateway must not load complete thread history through thread/read.");
}
if (/thread\/resume[\s\S]{0,700}dynamicTools/.test(gatewaySource)) {
  throw new Error("thread/resume must not pretend to update the fixed dynamic-tool catalog.");
}
if (!gatewaySource.includes("externalDataService.configured && externalDataControl.configured")) {
  throw new Error("Configured commerce-data tools must be registered independently of transient connectivity.");
}
if (gatewaySource.includes('name: "commerce_image"')) {
  throw new Error("Gateway must not register a duplicate application image-generation tool.");
}
if (!gatewaySource.includes('item.type !== "imageGeneration"')) {
  throw new Error("Gateway does not persist native Harness imageGeneration artifacts.");
}
if (providerClientSource.includes('"images/generations"')) {
  throw new Error("Provider client must not duplicate native Harness image generation.");
}
if (generatedConfig.includes(`env_key = ${JSON.stringify(config.provider.apiKeyEnvName)}`)) {
  throw new Error("Codex App Server config must not receive the upstream Provider key directly.");
}
for (const route of [
  'suffix: "/models"',
  'suffix: "/responses"',
  'suffix: "/responses/compact"',
  'suffix: "/images/generations"',
  'suffix: "/images/edits"',
]) {
  if (!providerProxySource.includes(route)) {
    throw new Error(`Runtime Provider relay is missing allowlisted route ${route}.`);
  }
}
if (
  !providerProxySource.includes('name === ACTOR_AUTHORIZATION_HEADER') ||
  !providerProxySource.includes('authorization: `Bearer ${apiKey}`') ||
  !gatewaySource.includes("runtimeProviderProxy.matches")
) {
  throw new Error("Runtime Provider relay does not enforce actor auth and server-side upstream credential injection.");
}
if (agentThreadSource.includes("failActiveTurn") || agentThreadSource.includes("shouldExpireActiveTurn")) {
  throw new Error("Browser code must not fabricate a terminal Harness Turn state.");
}
if (!agentThreadSource.includes("/status") || !agentThreadSource.includes("hasOlderHistory")) {
  throw new Error("Browser must reconcile through lightweight status and paginated history APIs.");
}
if (
  !agentThreadSource.includes("historyLoadControllerRef") ||
  !agentThreadSource.includes("setThreadId(summary.threadId)")
) {
  throw new Error("Browser task selection must switch immediately and cancel stale history loads.");
}
if (!workbenchSource.includes("warmedThreadIdsRef") || !workbenchSource.includes("/status")) {
  throw new Error("Workbench must prewarm recent task status without loading conversation bodies.");
}
if (copywritingBriefSource.includes("buildCopywritingRecipeExecutionPrompt")) {
  throw new Error("Copywriting UI must submit the original user input and rely on the native Skill item.");
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
if (!managedHookSource.includes('"image_gen"')) {
  throw new Error("Managed Hook runner does not allow the native Codex image generation tool.");
}
if (!managedHookSource.includes('"commerce_skill.publish"')) {
  throw new Error("Managed Hook runner does not allow the approval-gated Commerce Skill publisher.");
}
if (!managedHookSource.includes('"commerce_data.research_social_content"')) {
  throw new Error("Managed Hook runner does not allow governed social-content research.");
}
if (!managedHookSource.includes('"commerce_data.research_marketplace_products"')) {
  throw new Error("Managed Hook runner does not preserve legacy marketplace-product research calls.");
}
if (!managedHookSource.includes('"commerce_data.plan_marketplace_research"')) {
  throw new Error("Managed Hook runner does not allow free marketplace planning.");
}
if (!managedHookSource.includes('"commerce_data.execute_marketplace_research"')) {
  throw new Error("Managed Hook runner does not allow governed marketplace plan execution.");
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
      nativeImageGeneration: true,
      actorAuthorizedProviderRelay: true,
      multiAgent: true,
      localPathImageReader: false,
      managedHooks: true,
      managedHookEvents: 11,
      nativeContextCompaction: true,
      autoCompactThresholdPercent: config.autoCompactThresholdPercent,
      compactionTimeoutMs: config.compactionTimeoutMs,
      developmentHookTrust: "app-owned-bypass",
      productionHookTrust: "requirements-managed-only",
      checkedControls: requiredLines.length + 4,
    },
    null,
    2,
  ),
);
