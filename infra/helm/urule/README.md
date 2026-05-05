# Urule Helm Chart

Umbrella chart for the Urule first-party microservices: registry,
packagehub, packages, governance, state, channel-router, mcp-gateway,
runtime-broker, approvals, langgraph-adapter, and office-ui.

## What this chart does

- Deploys every first-party service as a parameterized
  `Deployment` + `ClusterIP Service` pair.
- Runs schema migrations as a `Job` per migrating service, wired as
  `pre-install` / `pre-upgrade` Helm hooks so the schema is up before
  the Deployment rolls.
- Renders an optional `Ingress` for `office-ui`.

A single template file produces N manifests at render time — all
services share the same `Deployment` shape and read their config from
a per-service entry under `.Values.services`. Adding a new service is
a values change, not a template change.

## What this chart does NOT do

Stateful infrastructure (PostgreSQL, NATS, Keycloak, OpenFGA, OPA) is
**not** packaged. Bring your own. Two reference patterns:

1. **External managed services** — RDS / Cloud SQL / Aiven for
   Postgres, Synadia / NATS Cloud for NATS, Keycloak managed via your
   IdP team. Set `global.databaseUrlBase`, `global.natsUrl`,
   `global.keycloakUrl`, `global.openfgaUrl` in your values override.
2. **Bitnami / community subcharts** — install separately:
   ```sh
   helm install postgres bitnami/postgresql --set auth.postgresPassword=urule
   helm install nats nats/nats --set jetstream.enabled=true
   helm install keycloak bitnami/keycloak
   ```
   Then point this chart at the resulting service hostnames.

We deliberately don't bundle subcharts: every operator we've talked to
already has opinions about how Postgres is provisioned, networked, and
backed up.

## Install

```sh
# From the chart directory
helm lint .
helm install urule . \
  --namespace urule --create-namespace \
  --set global.imageTag=v0.1.0 \
  --set global.databaseUrlBase=postgres://urule:urule@postgres:5432 \
  --set global.natsUrl=nats://nats:4222
```

## Image tags

The chart expects each service's image at:
```
<global.imageRegistry>/<service.image>:<global.imageTag>
```
(default registry `ghcr.io/urule-ai`).

Migration images use the same registry with a `-migrator` suffix:
```
<global.imageRegistry>/<service.image>-migrator:<global.imageTag>
```
This matches the multi-stage Dockerfile pattern (`target: migrator`)
the services already ship — just publish the migrator stage as a
separate tag. The `docker-publish` CI job is the natural place to do
that bake.

## Per-service overrides

Every entry under `.Values.services` accepts:

| Key | Default | Notes |
|-----|---------|-------|
| `enabled` | `true` | Skip the service for this install |
| `image` | service name | Image basename (registry + tag added by the chart) |
| `port` | `3000` | Container + Service port |
| `replicas` | `1` | Deployment replica count |
| `databaseName` | _(unset)_ | When set, `DATABASE_URL` is rendered |
| `migrate.enabled` | _(false)_ | When `true`, emits the migration Job hook |
| `env` | `{}` | Extra env vars merged on top of the chart-wide ones |
| `resources` | _(unset)_ | Pod resources — passed through verbatim |

The chart-wide env (`NATS_URL`, `KEYCLOAK_URL`, `OPENFGA_URL`,
`CORS_ORIGINS`, `DATABASE_URL`) is injected first; per-service `env`
overrides take precedence.

## Custom values example

```yaml
global:
  imageTag: v0.2.3
  databaseUrlBase: postgres://urule:strong-password@postgres.urule.svc:5432
  corsOrigins: https://urule.example.com

services:
  langgraph-adapter:
    replicas: 3
    env:
      ANTHROPIC_API_KEY: sk-...   # consider sealed-secrets / external-secrets instead
  office-ui:
    enabled: false                # frontend served from a CDN

ingress:
  enabled: true
  className: nginx
  host: urule.example.com
  tls:
    enabled: true
    secretName: urule-tls
```

## Verifying

```sh
# Render without applying — useful for diff vs. cluster
helm template urule . --namespace urule > rendered.yaml

# Lint
helm lint .

# Dry-run install against a real cluster (server-side validation)
helm install --dry-run --debug urule . --namespace urule
```

## Uninstall

```sh
helm uninstall urule --namespace urule
```

Migration Jobs are pruned automatically (`hook-delete-policy:
hook-succeeded,before-hook-creation`); release-managed Deployments,
Services, and the optional Ingress are removed by `uninstall`. Stateful
data in your external Postgres remains, by design.
