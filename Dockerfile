# syntax=docker/dockerfile:1

##############################################################################
# Stage 1 — builder
#
# Installs the full dependency tree (incl. devDependencies), compiles the
# TypeScript sources with tsup, then prunes down to production-only deps so
# the runtime stage copies a lean node_modules.
##############################################################################
FROM node:24-alpine AS builder
WORKDIR /app

# pnpm ships with Node via Corepack; activate the exact version pinned in
# package.json ("packageManager": "pnpm@11.7.0").
RUN corepack enable

# Copy only the manifest + lockfile first so Docker can cache the (slow)
# dependency install layer whenever source-only changes are made.
COPY package.json pnpm-lock.yaml ./

# Deterministic install from the committed lockfile (fails if out of sync).
RUN pnpm install --frozen-lockfile

# Now bring in the rest of the sources and build.
COPY . .
RUN pnpm build

# Strip devDependencies in place, leaving only the runtime deps required by
# dist/entry/node.js (@hono/mcp, @hono/node-server, @modelcontextprotocol/sdk,
# hono, zod).
RUN pnpm prune --prod

##############################################################################
# Stage 2 — runtime
#
# Minimal image: just Node, the compiled dist/, production node_modules and
# the manifest. Runs as an unprivileged user.
##############################################################################
FROM node:24-alpine AS runtime
WORKDIR /app

# Production defaults. PORT matches the Node entry's fallback (src/entry/node.ts)
# and the EXPOSE / HEALTHCHECK below.
ENV NODE_ENV=production
ENV PORT=3001

# node:*-alpine already ships an unprivileged "node" user (uid 1000). Own the
# app directory with it and drop root privileges for the running process.
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json

USER node

EXPOSE 3001

# Alpine has no curl/wget by default, so probe the health endpoint with Node's
# built-in fetch. Exit 0 = healthy, exit 1 = unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node --eval "fetch('http://localhost:' + (process.env.PORT || 3001) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Launch the HTTP/VPS server. It listens on $PORT and serves MCP at /mcp.
CMD ["node", "dist/entry/node.js"]
