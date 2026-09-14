// Real Linux/Docker fault injection against a disposable volume, never production.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const image = process.env.MODEL_RELAY_TEST_IMAGE || "commerce-model-relay:recovery-test";
const id = `commerce-relay-test-${randomUUID()}`;
const volume = `${id}-socket`;
const root = await mkdtemp(join(tmpdir(), "commerce-relay-test-"));
const conf = join(root, "nginx.conf");
await writeFile(conf, "pid /tmp/nginx.pid;\nerror_log /dev/stderr warn;\nevents {}\nhttp { access_log off; client_body_temp_path /tmp/body; proxy_temp_path /tmp/proxy; fastcgi_temp_path /tmp/fastcgi; uwsgi_temp_path /tmp/uwsgi; scgi_temp_path /tmp/scgi; server { listen unix:/run/model/relay.sock; location /health { return 200 'ok'; } } }\n");
function docker(args, allowFailure = false) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
  if (!allowFailure) assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result;
}
function fixture(command) {
  return docker(["run", "--rm", "--network", "none", "--user", "1000:1000", "-v", `${volume}:/run/model`, "--entrypoint", "sh", image, "-c", command]);
}
const options = ["--user", "1000:1000", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--tmpfs", "/tmp:size=16m,mode=1777", "-v", `${volume}:/run/model`, "-v", `${conf}:/etc/nginx/nginx.conf:ro`];
async function healthy(name) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = docker(["exec", name, "curl", "--fail", "--silent", "--max-time", "1", "--unix-socket", "/run/model/relay.sock", "http://localhost/health"], true);
    if (r.status === 0 && r.stdout === "ok") return;
    await delay(100);
  }
  assert.fail(docker(["logs", name], true).stderr || "relay never became healthy");
}
try {
  docker(["volume", "create", volume]);
  docker(["run", "--rm", "--network", "none", "--user", "0:0", "-v", `${volume}:/run/model`, "--entrypoint", "sh", image, "-c", "chown 1000:1000 /run/model"]);
  docker(["run", "-d", "--name", id, "--network", "none", ...options, "--entrypoint", "/usr/local/bin/start-model-relay", image]);
  await healthy(id);
  // This contender cannot see the other network namespace. The inherited flock
  // alone must protect the live socket, even across separate containers.
  const duplicate = docker(["run", "--rm", "--network", "none", ...options, "--entrypoint", "/usr/local/bin/start-model-relay", image], true);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /holds the startup lock/);
  await healthy(id);
  docker(["restart", id]); await healthy(id);
  for (let attempt = 0; attempt < 3; attempt++) {
    docker(["kill", "--signal", "KILL", id]);
    fixture("test -S /run/model/relay.sock");
    docker(["start", id]); await healthy(id);
  }
  assert.match(docker(["logs", id]).stderr, /removed stale Unix socket/);
  docker(["stop", id]);
  // A non-cooperating live listener (without the lock) is protected by the
  // kernel socket table when the contender shares its namespace.
  docker(["run", "-d", "--name", `${id}-unmanaged`, "--network", "none", ...options, "--entrypoint", "nginx", image, "-g", "daemon off;"]);
  await healthy(`${id}-unmanaged`);
  const active = docker(["run", "--rm", "--network", `container:${id}-unmanaged`, ...options, "--entrypoint", "/usr/local/bin/start-model-relay", image], true);
  assert.notEqual(active.status, 0);
  assert.match(active.stderr, /live process/);
  await healthy(`${id}-unmanaged`);
  docker(["stop", `${id}-unmanaged`]);
  for (const [setup, check] of [
    ["printf keep > /run/model/relay.sock", "test \"$(cat /run/model/relay.sock)\" = keep"],
    ["ln -s /tmp/not-a-socket /run/model/relay.sock", "test -L /run/model/relay.sock"],
  ]) {
    fixture(setup);
    const blocked = docker(["run", "--rm", "--network", "none", ...options, "--entrypoint", "/usr/local/bin/start-model-relay", image], true);
    assert.notEqual(blocked.status, 0);
    fixture(check);
    fixture("rm -- /run/model/relay.sock");
  }
  console.log(JSON.stringify({ firstStart: "passed", gracefulRestart: "passed", sigkillRecovery: 3, duplicateLock: "passed", liveListenerPreserved: "passed", regularFilePreserved: "passed", symlinkPreserved: "passed" }));
} finally {
  docker(["rm", "-f", id, `${id}-unmanaged`], true);
  docker(["volume", "rm", volume], true);
  await rm(root, { recursive: true, force: true });
}
