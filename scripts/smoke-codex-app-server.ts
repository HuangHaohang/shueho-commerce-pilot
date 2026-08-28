import "dotenv/config";

import { CodexAppServerClient } from "../src/codex/app-server-client.js";
import { ensureAppOwnedCodexConfig } from "../src/codex/runtime-config.js";
import { readGatewayConfig } from "../src/gateway/config.js";

const gatewayConfig = readGatewayConfig();
await ensureAppOwnedCodexConfig(gatewayConfig);

const client = new CodexAppServerClient({
  codexBin: gatewayConfig.codexBin,
  cwd: gatewayConfig.runtimeRoot,
  env: {
    ...process.env,
    CODEX_HOME: gatewayConfig.codexHome,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || gatewayConfig.provider.baseUrl,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || gatewayConfig.provider.apiKey,
  },
  requestTimeoutMs: 30_000,
});

try {
  await client.start();

  const effectiveConfig = await client.request("config/read", {
    includeLayers: true,
    cwd: gatewayConfig.runtimeRoot,
  });
  const authStatus = await client.request("account/read", {
    refreshToken: false,
  });
  const providerCapabilities = await client.request("modelProvider/capabilities/read", {});
  const hooks = await client.request("hooks/list", {
    cwds: [gatewayConfig.runtimeRoot],
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        codexBin: gatewayConfig.codexBin,
        codexHome: gatewayConfig.codexHome,
        providerId: gatewayConfig.provider.id,
        config: summarize(effectiveConfig),
        authStatus: summarize(authStatus),
        providerCapabilities,
        hooks,
      },
      null,
      2,
    ),
  );
} finally {
  await client.stop();
}

function summarize(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }

  return {
    type: "object",
    keys: Object.keys(value).sort(),
  };
}
