FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV COMMERCE_AGENT_HOST=0.0.0.0
ENV COMMERCE_AGENT_PORT=8787
ENV CODEX_HOME=/var/lib/shueho-commerce-pilot/codex

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY AGENTS.md README.md ./
COPY docs ./docs
COPY examples ./examples
COPY runtime/commerce-requirements.toml /etc/codex/requirements.toml

RUN mkdir -p /var/lib/shueho-commerce-pilot/codex && \
    chown -R node:node /var/lib/shueho-commerce-pilot

USER node

EXPOSE 8787

CMD ["node", "dist/src/gateway/server.js"]
