import { config } from "./config.js";
import { database } from "./database.js";
import { JustOneApiClient } from "./justoneapi-client.js";
import { loadJustOneApiCredentials } from "./justoneapi-credentials.js";
import { JustOneApiHttpTransport } from "./justoneapi-http-transport.js";
import { getJustOneApiProxyPool } from "./justoneapi-proxy-runtime.js";
import { PostgresJustOneApiTokenStore } from "./justoneapi-token-store.js";

const client = new JustOneApiClient({
  credentials: () => loadJustOneApiCredentials(config.justOneApi),
  store: new PostgresJustOneApiTokenStore(database),
  transport: new JustOneApiHttpTransport({
    baseUrl: config.justOneApi.baseUrl,
    maxResponseBytes: config.justOneApi.maxResponseBytes,
    production: config.environment === "production",
  }, getJustOneApiProxyPool),
  timeoutMs: () => config.justOneApi.timeoutMs,
  configured: Boolean(config.justOneApi.token || config.justOneApi.tokensFile),
});

export function getJustOneApiClient(): JustOneApiClient { return client; }
