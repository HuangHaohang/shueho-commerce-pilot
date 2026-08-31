FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS node-tools

FROM rust:1.95.0-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1 AS codex-runtime-build

RUN rm -f /etc/apt/sources.list.d/debian.sources && \
    echo 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260825T000000Z bookworm main' > /etc/apt/sources.list && \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      build-essential \
      clang \
      cmake \
      git \
      libcap-dev \
      libclang-dev \
      libssl-dev \
      pkg-config \
      python3 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=node-tools /usr/local/bin/node /usr/local/bin/node

WORKDIR /commerce-pilot

COPY vendor/codex ./vendor/codex
COPY scripts/codex-runtime ./scripts/codex-runtime

RUN node scripts/codex-runtime/build.mjs \
      --build-root=/tmp/commerce-codex-build \
      --output-dir=/opt/shueho-codex/bin && \
    node scripts/codex-runtime/verify.mjs \
      --bin=/opt/shueho-codex/bin/codex

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build

ENV CODEX_BIN=/opt/shueho-codex/bin/codex

WORKDIR /app

COPY --from=codex-runtime-build /opt/shueho-codex /opt/shueho-codex
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY vendor ./vendor
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime

ENV NODE_ENV=production
ENV COMMERCE_AGENT_HOST=0.0.0.0
ENV COMMERCE_AGENT_PORT=8787
ENV CODEX_HOME=/var/lib/shueho-commerce-pilot/codex
ENV CODEX_BIN=/opt/shueho-codex/bin/codex

WORKDIR /app

COPY --from=codex-runtime-build /opt/shueho-codex /opt/shueho-codex
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/codex-runtime ./scripts/codex-runtime
COPY --from=build /app/vendor ./vendor
COPY AGENTS.md README.md ./
COPY docs ./docs
COPY examples ./examples
COPY runtime/commerce-requirements.toml /etc/codex/requirements.toml

RUN node scripts/codex-runtime/verify.mjs --bin=/opt/shueho-codex/bin/codex

RUN mkdir -p /var/lib/shueho-commerce-pilot/codex && \
    chown -R node:node /var/lib/shueho-commerce-pilot

USER node

EXPOSE 8787

CMD ["node", "dist/src/gateway/server.js"]
