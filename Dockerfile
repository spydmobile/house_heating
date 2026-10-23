# SpyD Home Heat — one image serving the API and the built client on one port.
#
# Multi-stage so the runtime image carries no TypeScript, no Vite, no test
# framework and no build-time dependencies. The client is built here rather than
# copied in, because a dist/ built on a developer's machine is an artifact
# nobody can reproduce.
#
# BUILD FOR linux/amd64 EXPLICITLY, or build on the box. DP600 is x86_64, and an
# image built on an ARM Mac without --platform produces an arm64 binary that
# installs cleanly and fails at RUNTIME rather than at build.
#
#   docker build --platform linux/amd64 -t registry.home.spyd.com/house-heating:latest .
#
# Node is PINNED. "No Node version declared" plus native dependencies is how a
# build works today and breaks on a base-image bump.

# ---------------------------------------------------------------------------
# Stage 1 — build the client
# ---------------------------------------------------------------------------
FROM node:22.12-bookworm-slim AS client-build

WORKDIR /build/client

# Dependencies first: this layer is cached unless the manifests change, so an
# ordinary source edit does not reinstall the world.
COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./

# The Vite config FAILS THE BUILD if a required variable is missing, which is
# the point — a bundle that is wrong is worse than no bundle. In production the
# client calls the API at a relative /api on the same origin, so no host or port
# is baked in; only VITE_DEV_PORT is read, and only to satisfy the config.
ARG VITE_DEV_PORT=5178
ARG PORT=3008
ENV VITE_DEV_PORT=${VITE_DEV_PORT}
ENV PORT=${PORT}

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — build the server
# ---------------------------------------------------------------------------
FROM node:22.12-bookworm-slim AS server-build

WORKDIR /build/server

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/ ./

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:22.12-bookworm-slim AS runtime

# dumb-init so PID 1 forwards SIGTERM properly. Without it, `docker stop` kills
# the process outright and the server's own shutdown handler — which closes the
# pool rather than leaving Postgres to time the connection out — never runs.
RUN apt-get update \
 && apt-get install --no-install-recommends -y dumb-init \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app/server

# Production dependencies only, installed ON TARGET. A node_modules copied from
# a developer's machine is the wrong platform.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=server-build /build/server/dist ./dist

# The server resolves the client at ../../client/dist relative to its compiled
# location (/app/server/dist), so the build lands at /app/client/dist.
COPY --from=client-build /build/client/dist /app/client/dist

# Unprivileged. The base image ships a `node` user; nothing here needs root.
USER node

EXPOSE 3008

# No HEALTHCHECK here on purpose: the compose entry owns it, so it can be
# changed without rebuilding the image. /api/health is the endpoint.

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
