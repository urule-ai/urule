# API Reference

The TypeScript API surface of Urule's library packages is documented
via [TypeDoc](https://typedoc.org/). The generated site is **not
checked in** — every commit produces a fresh build.

## Generate locally

```sh
# From the workspace root
npm run docs:api          # one-shot build → docs/api/
npm run docs:api:watch    # rebuilds on save (good for IDE preview)

# Open the result
open docs/api/index.html  # macOS
xdg-open docs/api/index.html  # Linux
```

The build covers every published package under [packages/](../packages/):

| Package | Purpose |
|---------|---------|
| [@urule/auth-middleware](../packages/auth-middleware/) | Fastify JWT plugin (Keycloak JWKS) |
| [@urule/authz](../packages/authz/) | OpenFGA SDK wrapper |
| [@urule/correlation-id](../packages/correlation-id/) | Per-request correlation tracking |
| [@urule/events](../packages/events/) | NATS event envelope, topics, AuditLogger |
| [@urule/observability](../packages/observability/) | OpenTelemetry init, Prometheus metrics |
| [@urule/spec](../packages/spec/) | Entity types, manifest schema, validators |

## Adding a package to the docs

1. Create `packages/<name>/typedoc.json` with:
   ```json
   {
     "$schema": "https://typedoc.org/schema.json",
     "entryPoints": ["src/index.ts"],
     "tsconfig": "./tsconfig.json"
   }
   ```
2. Append the package directory to the `entryPoints` array in
   [`typedoc.json`](../typedoc.json) at the workspace root.
3. Re-run `npm run docs:api` and verify the new module appears on the
   generated index page.

## Hosting the generated site

`docs/api/` is a static site — drop it behind any HTTP server (GitHub
Pages, S3 + CloudFront, internal nginx). The build is deterministic
across runs, so a CI job can safely overwrite a deployed artifact on
every merge to main.

## Troubleshooting

- **"No entry points were provided or discovered"** — the package is
  missing its `typedoc.json` or its `src/index.ts`.
- **Warnings about unexported referenced types** — TypeDoc is honest
  about leaked types: a public method takes a parameter that is
  itself not exported. Fix by exporting the type from the package's
  `index.ts` or by marking the method `@internal`.
- **Out-of-date references after a refactor** — `docs:api` always
  rebuilds from source; clear `docs/api/` and re-run if anything looks
  stale.
