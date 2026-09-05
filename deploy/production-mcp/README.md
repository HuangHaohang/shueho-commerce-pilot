# Public MCP deployment

This deployment publishes the Commerce Pilot business-tool MCP boundary. Commerce Pilot's agent foundation remains the open-source Codex Harness. This unit contains no agent loop and does not start a Gateway/App Server or publish the browser workbench. External agents use their own MCP-capable Harness; the existing Next.js BFF runs privately for Enterprise token authentication, authorization, quotes, audit and billing.

See [the server244 runbook](../../docs/deployment/public-mcp-server244.md) for the installed topology, configuration, validation and rollback.

Build the application, operator-job and proxy artifacts from one reviewed commit:

```sh
docker build --target runtime -f deploy/production-mcp/Dockerfile \
  --build-arg COMMERCE_SOURCE_COMMIT="$RELEASE_COMMIT" \
  -t "commerce-pilot-mcp:$RELEASE_COMMIT" .
docker build --target jobs -f deploy/production-mcp/Dockerfile \
  --build-arg COMMERCE_SOURCE_COMMIT="$RELEASE_COMMIT" \
  -t "commerce-pilot-mcp-jobs:$RELEASE_COMMIT" .
docker build -f deploy/production-mcp/Dockerfile.proxy \
  --build-arg COMMERCE_SOURCE_COMMIT="$RELEASE_COMMIT" \
  -t "commerce-pilot-mcp-proxy:$RELEASE_COMMIT" .
```

Runtime images have no migration credentials. The jobs target is for bounded operator jobs only. Supply job-only environment files and the private CA through protected mounts; do not use the jobs image as a long-running application.

The public MCP uses stateless SSE with native SDK keepalive comments every ten seconds. Ingress disables buffering, caching and upstream retries. A transport failure never authorizes repeating a paid call. The regression test is included in `npm run test:gateway` and the image build.
