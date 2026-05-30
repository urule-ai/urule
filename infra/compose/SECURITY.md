# Compose stack — security notes

`docker-compose.infra.yaml` + `docker-compose.phase6.yaml` is the **demo / local-dev** stack. It boots the whole platform on one host for the UX test scenario. It is **not** a production deployment template — production users should run a real Helm chart with TLS termination, per-service DB roles, an externally-managed identity provider, and observability behind SSO.

This file documents the deployment-time settings the compose stack expects, what defaults intentionally lean toward developer convenience, and what's known-gappy for production use.

---

## Required environment (no defaults — the stack will refuse to start if these aren't set)

Put these in `infra/compose/.env` (gitignored). The `${VAR:?}` syntax fails the compose parse if the var is missing.

| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD` | Postgres `urule` user (used by every service that owns a schema, by Keycloak, by OpenFGA). |
| `KEYCLOAK_ADMIN_USERNAME` | Keycloak realm admin username. **Phase N change** — used to default to `admin`; that default is removed. |
| `KEYCLOAK_ADMIN_PASSWORD` | Keycloak realm admin password. |
| `GRAFANA_ADMIN_PASSWORD` | Grafana admin password. |

---

## Hardened defaults (override only if you know why)

| Variable | Default | What changing it does |
|---|---|---|
| `URULE_BIND_HOST` | `127.0.0.1` | **Phase N change** — every host port now binds to loopback. Set to `0.0.0.0` to expose backend services on the host's external interface (needed for remote demo deploys; do not do this on a public-internet host without TLS in front + an auth gate). |
| `GRAFANA_ANONYMOUS_VIEWER` | `false` | **Phase N change** — used to default to `true`; anyone who reached the Grafana port read every dashboard. Set to `true` for a local-dev convenience workflow. |

Per-service `URULE_*_PORT` defaults are unchanged.

---

## Known production gaps (track + close before any non-demo deploy)

1. **Keycloak `start-dev`**. The current `command: start-dev` runs HTTP-only with weak default assertions. Replace with `command: start` + an HTTPS reverse proxy (Caddy / Traefik / nginx) terminating TLS in front, plus `KC_HOSTNAME` set to the public DNS name. Not done here because the demo stack expects to be reachable as `localhost:8281`.
2. **Single Postgres role for every database.** The `urule` Postgres principal owns + has full access to every per-service database. A production deployment should provision per-service roles with `GRANT ON DATABASE <name> TO <name>_svc` and have each service connect with its own credentials. Tracked as a follow-up to this file.
3. **`docker-compose.phase6.yaml` is not named like a demo.** Users have copied it as a production template. The audit recommended renaming it to `.demo.yaml`; deferred because it touches every README / CI / Makefile reference. Until renamed, treat it as the demo stack.
4. **No CodeQL / Trivy scanning on the compose images.** The image tags are pinned to specific versions (good), but a SBOM / CVE scan should run on each image weekly + on bump.
5. **Backend services run as root inside their containers.** No `USER` directive in the Dockerfiles. Switch to a non-root UID when the service doesn't need privileged ports.

---

## Pre-deploy checklist

Before pointing this stack at any host that isn't a developer laptop:

- [ ] `.env` contains real (not example) values for every required var above
- [ ] `URULE_BIND_HOST` left as `127.0.0.1`, OR there's a TLS-terminating reverse proxy in front of `0.0.0.0`
- [ ] `GRAFANA_ANONYMOUS_VIEWER` left as `false`
- [ ] You have a backup of the `pgdata` and `keycloak`-realm volumes
- [ ] You have read the four "Known production gaps" items above and either accept them or have remediation in place
