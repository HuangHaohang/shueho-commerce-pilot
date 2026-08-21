import "dotenv/config";

import { CommerceProviderClient } from "../src/provider/commerce-provider-client.js";
import { readGatewayConfig } from "../src/gateway/config.js";

const config = readGatewayConfig();
const client = new CommerceProviderClient(config.provider);
const catalog = await client.listModels(true);

if (!catalog.agentModels.some((model) => model.id === config.defaultModel)) {
  throw new Error(`Default agent model ${config.defaultModel ?? "<unset>"} is not available.`);
}
if (!catalog.imageModels.some((model) => model.id === config.provider.imageModel)) {
  throw new Error(`Configured image model ${config.provider.imageModel} is not available.`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: catalog.provider,
      agentModelCount: catalog.agentModels.length,
      imageModelCount: catalog.imageModels.length,
      otherModelCount: catalog.otherModels.length,
      defaultAgentModel: config.defaultModel,
      configuredImageModel: catalog.configuredImageModel,
    },
    null,
    2,
  ),
);
