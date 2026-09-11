#!/bin/sh
set -eu
release_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
config_dir=${COMMERCE_CONFIG_DIR:-/home/shueho/services/shueho-commerce-pilot/config}
exec docker compose --env-file "$config_dir/deployment.env" \
  -f "$release_root/deploy/production-mcp/compose.yaml" \
  -f "$release_root/deploy/production-mcp/compose.justoneapi-proxy.yaml" \
  -f "$release_root/deploy/production-mcp/compose.justoneapi-tokens.yaml" \
  -f "$release_root/deploy/production-web/compose.yaml" "$@"
