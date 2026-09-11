import { createRequire } from "node:module";

// Resolve from this workspace whether npm hoists Next or installs it locally.
// Load in the main process so Next receives container shutdown signals directly.
const require = createRequire(import.meta.url);
require("next/dist/bin/next");
