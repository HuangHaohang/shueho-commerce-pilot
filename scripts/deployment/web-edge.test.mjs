import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../../deploy/production-web/edge.conf", import.meta.url), "utf8");

// Evaluate the actual map rows for representative traffic. Keep the supported
// syntax deliberately small; nginx -t remains the deployment syntax authority.
function mapValue(name, input) {
  const rows = config.match(new RegExp(`map [^\\n]+ \\$${name} \\{([\\s\\S]*?)\\n  \\}`))?.[1];
  assert.ok(rows, `missing traffic map ${name}`);
  let fallback;
  for (const row of rows.trim().split("\n")) {
    const [, selector, value] = row.trim().match(/^(\S+)\s+(\S+);$/) ?? [];
    assert.ok(selector, `unsupported map row: ${row}`);
    const resolved = value === '""' ? "" : value;
    if (selector === "default") fallback = resolved;
    else if (selector.startsWith("~") ? new RegExp(selector.slice(1)).test(input) : selector === input) return resolved;
  }
  return fallback;
}

test("office reads and SSE reconnects do not consume write admission", () => {
  for (const method of ["GET", "HEAD"]) {
    for (const uri of ["/", "/api/agent/threads", "/api/agent/threads/a/events", "/api/agent/threads/a/images"]) {
      assert.equal(mapValue("commerce_write_key", method), "");
      assert.equal(mapValue("commerce_read_key", `${method}:${uri}`), "$binary_remote_addr");
    }
  }
  assert.match(config, /limit_req_zone \$commerce_read_key zone=reads:10m rate=150r\/s;/);
  assert.match(config, /limit_req zone=reads burst=300 nodelay;/);
});

test("all write methods retain the original per-client limit including static-looking URLs", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "UNKNOWN"]) {
    assert.equal(mapValue("commerce_write_key", method), "$binary_remote_addr");
    for (const uri of ["/api/agent/threads/a/turns", "/_next/static/chunks/a.js"]) {
      assert.equal(mapValue("commerce_read_key", `${method}:${uri}`), "");
    }
  }
  assert.match(config, /limit_req_zone \$commerce_write_key zone=writes:10m rate=30r\/s;/);
  assert.match(config, /limit_req zone=writes burst=100 nodelay;/);
  assert.doesNotMatch(config, /limit_req_zone \$(?:cookie|http)_/);
});

test("only public build assets bypass request rate limits and enable buffering", () => {
  assert.equal(mapValue("commerce_read_key", "GET:/_next/static/chunks/a.js"), "");
  assert.equal(mapValue("commerce_read_key", "HEAD:/_next/static/css/a.css"), "");
  for (const uri of ["/_next/image", "/_next/static-private/a.js", "/api/agent/threads/a/images", "/api/auth/session"]) {
    assert.equal(mapValue("commerce_read_key", `GET:${uri}`), "$binary_remote_addr");
  }
  assert.match(config, /location \^~ \/_next\/static\/ \{\s+limit_except GET HEAD \{ deny all; \}\s+proxy_buffering on;\s+proxy_max_temp_file_size 0;/);
  assert.equal(config.match(/proxy_buffering on;/g)?.length, 1);
  assert.equal(config.match(/limit_req zone=/g)?.length, 2, "location overrides must not drop inherited protection");
});

test("bounds shared-NAT and total connections without weakening isolation, upload or SSE contracts", () => {
  assert.match(config, /limit_conn connections 600;/);
  assert.match(config, /limit_conn server_connections 800;/);
  assert.match(config, /limit_conn_status 429;/);
  assert.match(config, /limit_req_status 429;/);
  assert.match(config, /limit_conn_zone \$server_name zone=server_connections:1m;/);
  assert.match(config, /location = \/api\/internal \{ return 404; \}/);
  assert.match(config, /location \^~ \/api\/internal\/ \{ return 404; \}/);
  assert.match(config, /client_max_body_size 64k;/);
  assert.equal(config.match(/client_max_body_size 6m;/g)?.length, 2);
  assert.match(config, /location = \/api\/products\/imports \{\s+client_max_body_size 6m;/);
  assert.match(config, /location ~ \^\/api\/agent\/threads\/\[\^\/\]\+\/attachments\$ \{\s+client_max_body_size 6m;/);
  for (const directive of ["proxy_next_upstream off;", "proxy_cache off;", "proxy_buffering off;", "proxy_read_timeout 1800s;", "set_real_ip_from 127.0.0.1;", "set_real_ip_from 172.30.87.1;", "real_ip_header CF-Connecting-IP;"]) {
    assert.ok(config.includes(directive), `missing ${directive}`);
  }
  assert.doesNotMatch(config, /set_real_ip_from (?:0\.0\.0\.0\/0|::\/0);/);
});
