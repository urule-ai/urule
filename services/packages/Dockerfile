# syntax=docker/dockerfile:1
# Build context: urule/ (the npm workspace root). Compose passes
#   build:
#     context: ../../
#     dockerfile: services/packages/Dockerfile

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/auth-middleware/package.json packages/auth-middleware/
COPY packages/authz/package.json packages/authz/
COPY packages/correlation-id/package.json packages/correlation-id/
COPY packages/events/package.json packages/events/
COPY packages/observability/package.json packages/observability/
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
COPY packages packages
RUN npm run build -w @urule/auth-middleware -w @urule/correlation-id -w @urule/events -w @urule/observability
COPY services/packages services/packages
RUN npm run build -w @urule/packages

FROM deps AS migrator
WORKDIR /app/services/packages
COPY services/packages/drizzle.config.ts ./
COPY services/packages/migrations ./migrations
COPY services/packages/src/db ./src/db
CMD ["npx", "drizzle-kit", "migrate"]

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/auth-middleware/package.json packages/auth-middleware/
COPY packages/correlation-id/package.json packages/correlation-id/
COPY packages/events/package.json packages/events/
COPY packages/observability/package.json packages/observability/
COPY services/packages/package.json services/packages/
RUN npm ci -w @urule/packages --omit=dev --include-workspace-root
COPY --from=builder /app/packages/auth-middleware/dist packages/auth-middleware/dist
COPY --from=builder /app/packages/correlation-id/dist packages/correlation-id/dist
COPY --from=builder /app/packages/events/dist packages/events/dist
COPY --from=builder /app/packages/observability/dist packages/observability/dist
COPY --from=builder /app/services/packages/dist services/packages/dist
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"
WORKDIR /app/services/packages
CMD ["node", "dist/index.js"]
