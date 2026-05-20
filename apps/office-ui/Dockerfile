# syntax=docker/dockerfile:1
# Build context: urule/ (the npm workspace root). Compose passes
#   build:
#     context: ../../
#     dockerfile: apps/office-ui/Dockerfile

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/auth-middleware/package.json packages/auth-middleware/
COPY packages/authz/package.json packages/authz/
COPY packages/correlation-id/package.json packages/correlation-id/
COPY packages/events/package.json packages/events/
COPY packages/spec/package.json packages/spec/
COPY services/governance/package.json services/governance/
COPY services/packagehub/package.json services/packagehub/
COPY services/packages/package.json services/packages/
COPY services/registry/package.json services/registry/
COPY services/state/package.json services/state/
COPY apps/office-ui/package.json apps/office-ui/
COPY plugins/backstage/package.json plugins/backstage/
RUN npm ci

FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/office-ui apps/office-ui
# Ensure public/ exists so the runner stage's COPY succeeds even when the
# repo's apps/office-ui/public is empty (git doesn't track empty dirs, so a
# fresh clone has no public/ at all). Without this, `docker build` fails on
# `COPY .../public ./public` in the runner stage. (#64)
RUN mkdir -p apps/office-ui/public
RUN npm run build -w @urule/office-ui

FROM node:20-slim AS runner
WORKDIR /app/apps/office-ui
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/apps/office-ui/.next/standalone /app/
COPY --from=builder /app/apps/office-ui/.next/static ./.next/static
COPY --from=builder /app/apps/office-ui/public ./public
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"
# #23: drop root before exec. node:20-slim ships a `node` user (uid 1000).
# Next standalone writes its runtime cache under .next/, so chown /app.
RUN chown -R node:node /app
USER node
CMD ["node", "server.js"]
