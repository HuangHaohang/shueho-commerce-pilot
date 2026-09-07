import { config } from "./config.js";
import { credentialForToken } from "./justoneapi-credentials.js";
import { JustOneApiHttpTransport } from "./justoneapi-http-transport.js";
import type { JustOneApiProxyPool } from "./justoneapi-proxy-pool.js";
import { getJustOneApiProxyPool } from "./justoneapi-proxy-runtime.js";
import type { ProviderEndpoint, ProviderTransportRequest } from "./types.js";

/** Network component fixture only; business call tests use the full client and a real PostgreSQL ledger. */
export function createTransportTestClient(pool?: JustOneApiProxyPool) {
  const transport = new JustOneApiHttpTransport({
    get baseUrl() { return config.justOneApi.baseUrl; },
    get maxResponseBytes() { return config.justOneApi.maxResponseBytes; },
    production: false,
  }, pool ? async () => pool : getJustOneApiProxyPool);
  return {
    async call(endpoint: ProviderEndpoint, request: ProviderTransportRequest) {
      const prepared = await transport.prepare(endpoint, request, Date.now() + config.justOneApi.timeoutMs);
      try { return await prepared.send(credentialForToken(config.justOneApi.token)); }
      finally { prepared.close(); }
    },
  };
}
