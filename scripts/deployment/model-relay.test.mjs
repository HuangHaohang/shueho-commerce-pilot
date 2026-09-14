import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(`../../deploy/production-mcp/${path}`, import.meta.url), "utf8");

test("only the model relay selects the crash-recovering image entrypoint", () => {
  const compose = read("compose.yaml");
  const relay = compose.split("  model-relay:\n")[1].split("  model-client:\n")[0];
  assert.match(relay, /entrypoint: \["\/usr\/local\/bin\/start-model-relay"\]/);
  assert.match(relay, /COMMERCE_MODEL_RELAY_IMAGE/);
  assert.match(relay, /user: "1000:1000"/);
  assert.match(relay, /read_only: true/);
  assert.match(relay, /network_mode: host/);
  assert.match(relay, /--unix-socket, \/run\/model\/relay.sock, http:\/\/localhost\/health/);
  assert.match(compose.split("  model-client:\n")[1], /\/run\/model:ro/);
  assert.match(read("Dockerfile.proxy"), /COPY --chmod=0555 deploy\/production-mcp\/start-model-relay.sh \/usr\/local\/bin\/start-model-relay/);
});

test("startup cleanup is locked, kernel-checked and confined to the exact socket", () => {
  const script = read("start-model-relay.sh");
  assert.match(script, /flock -n 9/);
  assert.match(script, /\/proc\/net\/unix/);
  assert.match(script, /\[ ! -L "\$socket" \]/);
  assert.match(script, /\[ -S "\$socket" \]/);
  assert.match(script, /stat -c %u "\$socket"/);
  assert.equal((script.match(/^\s*rm /gm) || []).length, 1);
  assert.match(script, /rm -- "\$socket"/);
  assert.doesNotMatch(script, /rm\s+-[rf]|sudo|curl/);
  assert.match(script, /exec nginx -g 'daemon off;'/);
});
