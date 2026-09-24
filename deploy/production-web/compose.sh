#!/bin/sh
set -eu
release_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
: "${COMMERCE_CONFIG_DIR:?Set COMMERCE_CONFIG_DIR to the protected production configuration directory}"
config_dir=$COMMERCE_CONFIG_DIR
exec docker compose --env-file "$config_dir/deployment.env" \
  -f "$release_root/deploy/production-mcp/compose.yaml" \
  -f "$release_root/deploy/production-mcp/compose.justoneapi-proxy.yaml" \
  -f "$release_root/deploy/production-mcp/compose.justoneapi-tokens.yaml" \
  -f "$release_root/deploy/production-web/compose.yaml" "$@"
