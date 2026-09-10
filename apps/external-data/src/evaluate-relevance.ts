import { LocalModelClient } from "./local-model-client.js";
import { evaluateProductionRelevance } from "./relevance-evaluation.js";
await evaluateProductionRelevance(new LocalModelClient());
