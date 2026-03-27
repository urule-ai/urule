# Urule — AI Assistant Guide

Urule is the open-source coordination layer for AI agents. It composes open-source projects (Keycloak, NATS, OpenFGA, OPA, Temporal, PostgreSQL) into a cohesive platform and only builds the coordination glue. This file helps AI coding assistants understand the codebase and contribute effectively.

## Architecture Principles

1. **Contract-first** — Types and interfaces live in library packages (`packages/`). Services implement them.
2. **Schema-per-service** — Each service owns its PostgreSQL schema. Never query another service's database.
3. **Event-driven** — Mutations publish events to NATS. Consumers are idempotent.
4. **Services are glue** — If a service exceeds ~2000 lines, it's doing too much.
5. **Auth flow** — User → Keycloak JWT → service validates via `@urule/auth-middleware` → governance/authz checks.

## Tech Stack

- **Language**: TypeScript ESM (`"type": "module"`, strict mode)
- **HTTP**: Fastify 5
- **ORM**: Drizzle ORM (PostgreSQL 16)
- **Events**: NATS + JetStream
- **Tests**: Vitest (unit), Playwright (E2E)
- **IDs**: ULID via `ulid` package
- **Validation**: Zod (request bodies)
- **Auth**: `@urule/auth-middleware` (Keycloak JWKS)
- **Frontend**: Next.js 14, React 18, Tailwind CSS, Zustand

## Project Layout

```
packages/          — shared libraries (imported by services)
  spec/            — entity types, manifest schema, validators
  events/          — NATS event envelope, topics, AuditLogger
  authz/           — OpenFGA SDK wrapper
  auth-middleware/  — Fastify JWT plugin (Keycloak JWKS)

services/          — backend microservices
  registry/        — source of truth (orgs, workspaces, agents, runtimes, providers)
  packages/        — package install/upgrade/remove lifecycle
  packagehub/      — package discovery, search, metadata
  governance/      — OPA policy + OpenFGA authz gateway
  state/           — room presence, task ownership, widget state (NATS KV)

plugins/
  backstage/       — Backstage catalog sync

apps/
  office-ui/       — Next.js 14 frontend (Tailwind, Zustand, React Query)

infra/
  compose/         — Docker Compose files, SQL seeds, init scripts
  scripts/         — dev-setup, run-phase scripts
  e2e/             — backend E2E tests (phase1.test.mjs)
```

## Standalone Repos (separate GitHub repos under urule-os org)

- `widget-sdk` — Widget iframe bridge protocol
- `orchestrator-contract` — Adapter interface for AI orchestrators
- `mcp-gateway` — MCP server registry + tool catalog
- `channel-router` — Multi-channel message normalization
- `approvals` — Temporal-backed approval workflows
- `runtime-broker` — Sandbox session allocation
- `langgraph-adapter` — LangGraph + Anthropic Claude adapter

## Code Conventions

### Imports
```typescript
// ESM imports — always use .js extension for local imports
import { something } from './module.js';
import type { SomeType } from './types.js';
```

### ID Generation
```typescript
import { ulid } from 'ulid';
const id = ulid(); // Always ULID, never UUID
```

### Fastify Route Pattern
```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const createThingSchema = z.object({
  name: z.string().min(1).max(255),
  workspaceId: z.string(),
  config: z.record(z.unknown()).optional(),
});

export function registerThingRoutes(app: FastifyInstance, db: Database) {
  // Health check (always public)
  app.get('/healthz', async () => ({ status: 'ok' }));

  // Create
  app.post<{ Body: z.infer<typeof createThingSchema> }>(
    '/api/v1/things',
    async (request, reply) => {
      const parsed = createThingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const { name, workspaceId } = parsed.data;
      const id = ulid();
      // ... insert into DB
      return reply.code(201).send({ id, name, workspaceId });
    },
  );

  // Get by ID
  app.get<{ Params: { thingId: string } }>(
    '/api/v1/things/:thingId',
    async (request, reply) => {
      const { thingId } = request.params;
      const thing = await db.select().from(things).where(eq(things.id, thingId));
      if (!thing[0]) {
        return reply.code(404).send({ error: { code: 'THING_NOT_FOUND', message: `Thing ${thingId} not found` } });
      }
      return thing[0];
    },
  );

  // List with pagination
  app.get('/api/v1/things', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = Math.min(parseInt(query['limit'] ?? '50', 10), 100);
    const offset = parseInt(query['offset'] ?? '0', 10);
    return db.select().from(things).limit(limit).offset(offset);
  });
}
```

### Error Response Pattern
```typescript
// 400 — validation failure
reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });

// 404 — not found
reply.code(404).send({ error: { code: 'ENTITY_NOT_FOUND', message: `Entity ${id} not found` } });

// 500 — internal (via error handler)
// Handled automatically by middleware/error-handler.ts
```

### Drizzle Schema Pattern
```typescript
import { pgTable, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

export const things = pgTable('things', {
  id: varchar('id', { length: 26 }).primaryKey(),
  workspaceId: varchar('workspace_id', { length: 26 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  config: jsonb('config').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workspaceIdIdx: index('things_workspace_id_idx').on(table.workspaceId),
}));
```

### Test Pattern
```typescript
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

describe('thing routes', () => {
  async function buildTestApp() {
    const app = Fastify({ logger: false });
    // Register middleware with skipAuth for tests
    await app.register(authMiddleware, { skipAuth: true });
    registerThingRoutes(app, mockDb);
    return app;
  }

  it('should return 400 for invalid input', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      payload: { /* missing required fields */ },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

### Frontend Component Pattern (Next.js App Router)
```typescript
"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import api from "@/lib/api";

export default function ThingsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["things"],
    queryFn: () => api.get("/api/v1/things").then(r => r.data),
  });

  if (isLoading) return <SkeletonList />;
  return /* JSX */;
}
```

## Recipes

### How to Add a New API Route

1. Create `src/routes/things.routes.ts` with the Fastify route pattern above
2. Define Zod schemas for POST/PATCH bodies
3. Register in `src/server.ts`: `registerThingRoutes(app, db);`
4. Add `/api/v1/things` to the ROUTE_MAP in `apps/office-ui/src/lib/api.ts`
5. Add tests in `tests/routes.test.ts`

### How to Add a New Service

1. Create directory `services/my-service/` with:
   - `package.json` (name: `@urule/my-service`, deps: fastify, zod, ulid)
   - `tsconfig.json` (extend `../../tsconfig.base.json`)
   - `src/index.ts`, `src/server.ts`, `src/config.ts`
   - `src/routes/`, `src/middleware/error-handler.ts`
   - `Dockerfile` (multi-stage: builder + runner, with HEALTHCHECK)
   - `tests/`
2. Register in `server.ts`: CORS → rate limit → auth middleware → swagger → error handler → healthz → routes
3. Add to `docker-compose.phase6.yaml`
4. Add to `scripts/clone-all.sh` if standalone

### How to Add a New Widget

1. Create `apps/office-ui/src/widgets/builtin/MyWidget.tsx`
2. Add manifest to `apps/office-ui/src/widgets/manifests.ts`
3. Register in `apps/office-ui/src/widgets/builtin/index.ts`
4. Use `WidgetRenderContext` for host communication

### How to Add a New Event Type

1. Add topic to `packages/events/src/topics.ts`
2. Create type in `packages/events/src/events/my-domain.events.ts`
3. Export from `packages/events/src/index.ts`
4. Publish in service: `createEvent(TOPIC, serviceName, data)`

### How to Add a New Channel Adapter

1. Create `src/adapters/my-channel.adapter.ts` implementing `ChannelAdapter`
2. Add channel type to `ChannelType` union in `src/types.ts`
3. Register: `channelManager.registerAdapter(new MyChannelAdapter())`

### How to Add a New Orchestrator Adapter

1. Implement `OrchestratorAdapter` interface (8 methods)
2. Run compliance test suite from `@urule/orchestrator-contract/testing`
3. Deploy as Fastify service with the standard middleware stack

## Anti-Patterns — Do NOT

- Import directly between services (use HTTP APIs or NATS events)
- Query another service's database
- Use `any` type — use `unknown` with runtime validation
- Use UUID — always ULID via `ulid()`
- Use Express — all services use Fastify
- Skip Zod validation on POST/PATCH routes
- Put business logic in route handlers — extract to service classes
- Use `console.log` — use `request.log` or `app.log` (Pino)
- Hard-code secrets — use environment variables via `config.ts`
- Skip the auth middleware — register it in every service

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add webhook retry logic
fix: correct approval status transition
docs: update API reference
test: add route tests for packagehub
refactor: extract validation schemas
chore: align dependency versions
```

## Key Files Reference

| What | Where |
|------|-------|
| Entity types | `packages/spec/src/types/entities.ts` |
| Event topics | `packages/events/src/topics.ts` |
| Event envelope | `packages/events/src/envelope.ts` |
| Auth middleware | `packages/auth-middleware/src/plugin.ts` |
| Audit logger | `packages/events/src/audit/audit-logger.ts` |
| API router (frontend) | `apps/office-ui/src/lib/api.ts` |
| Widget manifests | `apps/office-ui/src/widgets/manifests.ts` |
| Docker Compose (full) | `infra/compose/docker-compose.phase6.yaml` |
| Seed data | `infra/compose/seed-packagehub.sql` |
| E2E auth fixture | `apps/office-ui/e2e/fixtures/auth.ts` |
