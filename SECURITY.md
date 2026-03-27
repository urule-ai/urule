# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in Urule, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead:

1. Email the maintainers directly with details of the vulnerability
2. Include steps to reproduce the issue
3. Include the potential impact

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Security Measures in Place

Urule implements the following security measures:

- **JWT Authentication** — All services validate Keycloak-issued JWTs via JWKS (`@urule/auth-middleware`)
- **Input Validation** — All POST/PATCH routes validate with Zod schemas
- **CORS Lockdown** — Configurable origin whitelist (not `origin: *`)
- **Rate Limiting** — `@fastify/rate-limit` on all services (100 req/min, 30 for AI chat)
- **Audit Logging** — Sensitive operations logged with actor identity
- **Config Validation** — Required environment variables checked at startup
- **Graceful Shutdown** — SIGTERM handlers close connections properly
- **Schema-per-Service** — No cross-service database access

## Security Roadmap

See [ROADMAP.md](ROADMAP.md) Section 1 (Security) for completed and remaining security items.

## Responsible Disclosure

We follow a 90-day responsible disclosure policy. After a vulnerability is reported and confirmed, we will:

1. Develop and test a fix
2. Release a patched version
3. Publish a security advisory on GitHub
4. Credit the reporter (unless they prefer anonymity)
