FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/external-data/package.json apps/external-data/package.json
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY apps ./apps
COPY designs ./designs
COPY deploy/production-mcp/tsconfig.json ./deploy/production-mcp/tsconfig.json
RUN node node_modules/typescript/bin/tsc -p deploy/production-mcp/tsconfig.json && \
    npm --workspace @shueho-commerce-pilot/external-data run build && \
    node --test dist/src/mcp/public-http-transport.test.js
# Page compilation must not connect to an operator database or bake real secrets.
RUN DATABASE_URL=postgresql://build:unused@127.0.0.1:1/build \
    BETTER_AUTH_SECRET=build-only-placeholder-at-least-32-characters \
    BETTER_AUTH_URL=https://localhost AUTH_TRUSTED_ORIGINS=https://localhost \
    COMMERCE_DATABASE_ROLE_MODE=migration NEXT_TELEMETRY_DISABLED=1 npm run web:build
RUN node --input-type=module -e "import ts from 'typescript'; import fs from 'node:fs'; fs.writeFileSync('apps/web/next.config.mjs', ts.transpileModule(fs.readFileSync('apps/web/next.config.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText)"

FROM build AS jobs
ARG COMMERCE_SOURCE_COMMIT=uncommitted
LABEL org.opencontainers.image.revision=$COMMERCE_SOURCE_COMMIT
ENV NODE_ENV=production
USER node

FROM build AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime
ARG COMMERCE_SOURCE_COMMIT=uncommitted
LABEL org.opencontainers.image.revision=$COMMERCE_SOURCE_COMMIT
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/apps/external-data/package.json ./apps/external-data/package.json
COPY --from=build /app/apps/external-data/dist ./apps/external-data/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/.next-build ./apps/web/.next-build
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/next.config.mjs ./apps/web/next.config.mjs
USER node
CMD ["node", "dist/src/mcp/commerce-data-public-server.js"]
