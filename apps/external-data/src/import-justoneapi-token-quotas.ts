import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { config } from "./config.js";
import { loadJustOneApiCredentials } from "./justoneapi-credentials.js";
import { importJustOneApiQuotaSnapshot } from "./justoneapi-quota-import.js";

const database = new Pool({ connectionString: config.migrationDatabaseUrl, max: 1, application_name: "justoneapi-quota-import" });
try {
  const { values } = parseArgs({ options: { "snapshot-file": { type: "string" }, "tokens-file": { type: "string" }, "token-id": { type: "string" } } });
  if (!config.migrationDatabaseUrl || !values["snapshot-file"]) throw new Error();
  let credentials = await loadJustOneApiCredentials({ token: config.justOneApi.token, tokensFile: values["tokens-file"] ?? config.justOneApi.tokensFile });
  if (values["token-id"]) credentials = credentials.filter((credential) => credential.id === values["token-id"]);
  if (!credentials.length) throw new Error();
  const bytes = await readFile(values["snapshot-file"]);
  if (bytes.length > 1_048_576) throw new Error();
  console.log(JSON.stringify(await importJustOneApiQuotaSnapshot(database,credentials,JSON.parse(bytes.toString("utf8"))),null,2));
} catch {
  console.error("JustOneAPI quota import failed; check protected input, migration access, existing usage and snapshot freshness.");
  process.exitCode = 1;
} finally { await database.end(); }
