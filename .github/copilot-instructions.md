# Copilot Instructions for Urule

Urule is the open-source coordination layer for AI agents, built with TypeScript ESM, Fastify 5, and Next.js 14.

## Key Conventions

- **ESM only**: Use `.js` extension in imports (`import { x } from './module.js'`)
- **IDs**: Always `ulid()` from the `ulid` package, never UUID
- **Validation**: Zod schemas on all POST/PATCH routes with `safeParse()`
- **Errors**: `{ error: 'Validation failed', details }` for 400, `{ error: { code, message } }` for 404/500
- **Types**: TypeScript strict mode, never `any`, use `unknown` + validation
- **Tests**: Vitest with `app.inject()`, auth middleware in `skipAuth: true` mode
- **Logging**: `request.log` (Pino), never `console.log` in services
- **Database**: Drizzle ORM, schema-per-service, ULID primary keys
- **Events**: NATS pub/sub via `@urule/events` envelope pattern
- **Auth**: `@urule/auth-middleware` Fastify plugin (Keycloak JWKS)

## File Patterns

- Routes: `src/routes/<entity>.routes.ts` — export `registerEntityRoutes(app, db)`
- Schemas: Zod schemas defined as `const` before the route registration function
- Tests: `tests/<name>.test.ts` — use `describe/it/expect` from vitest
- Config: `src/config.ts` with `loadConfig()` and `validateConfig()`
- Middleware: `src/middleware/error-handler.ts`

## See CLAUDE.md for full recipes and architecture details.
