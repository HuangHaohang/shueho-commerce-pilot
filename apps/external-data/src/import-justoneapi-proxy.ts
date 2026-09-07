import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { compileProxySubscription, writeProxyBundle } from "./justoneapi-proxy-subscription.js";
import { downloadProxySubscription } from "./justoneapi-proxy-download.js";

try {
  const { values } = parseArgs({ options: {
    "subscription-file": { type: "string" },
    "subscription-url-file": { type: "string" },
    "output-dir": { type: "string" },
    "proxy-host": { type: "string", default: "127.0.0.1" },
    listen: { type: "string", default: "127.0.0.1" },
    "first-port": { type: "string", default: "19000" },
    "allow-redirect-origin": { type: "string", multiple: true, default: [] },
    format: { type: "string", default: "unchanged" },
  } });
  if (!values["output-dir"] || Boolean(values["subscription-file"]) === Boolean(values["subscription-url-file"]) ||
      !["127.0.0.1", "0.0.0.0"].includes(values.listen) ||
      !["unchanged", "meta", "clash"].includes(values.format) || values["allow-redirect-origin"].length > 4) {
    throw new Error("Provide output-dir and exactly one protected subscription-file or subscription-url-file.");
  }
  const source = values["subscription-file"]
    ? await readFile(values["subscription-file"], "utf8")
    : await downloadProxySubscription((await readFile(values["subscription-url-file"]!, "utf8")).trim(), {
      allowedRedirectOrigins: values["allow-redirect-origin"],
      format: values.format as "unchanged" | "meta" | "clash",
    });
  const bundle = compileProxySubscription(source, {
    proxyHost: values["proxy-host"],
    listen: values.listen as "127.0.0.1" | "0.0.0.0",
    firstPort: Number(values["first-port"]),
  });
  const directory = await writeProxyBundle(values["output-dir"], bundle);
  console.log(JSON.stringify({ ...bundle.receipt, directory }, null, 2));
} catch {
  // File paths and remote subscription credentials must never enter npm/operator logs.
  console.error("Proxy import failed: check protected input, supported node fields and output permissions.");
  process.exitCode = 1;
}
