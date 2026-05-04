# Backup and recovery

What's stateful, how to back it up, how to restore.

## What's stateful

| Store | Service | Volume | Contents | Critical? |
|---|---|---|---|---|
| Postgres | `postgres` | `pgdata` | All per-service schemas: registry, packagehub, mcp_gateway, runtime_broker, approvals, urule_state, channel_router, keycloak, openfga, temporal, temporal_visibility | **Yes** |
| NATS JetStream | `nats` | `natsdata` | Stream messages + KV | Mostly, see below |
| Prometheus | `prometheus` | `prometheusdata` | Metric time series | Operational only |
| Grafana | `grafana` | `grafanadata` | Dashboards (operator-edited), saved queries | Operational only |

Stateless: registry, packagehub, state, mcp-gateway, channel-router, runtime-broker, approvals, adapter, office-ui, opa. They're disposable — restart and they reconstruct their working state from Postgres + NATS.

The `state` service IS in the table above as part of `urule_state` Postgres DB, but as of this writing it's actually in-memory (Map-based) — see ROADMAP §4.6 N/A note. When/if it migrates to NATS KV (the original CLAUDE.md description), it joins the NATS row.

## Postgres

### What to back up

`pgdata` contains all service databases. **Back up the whole instance**, not per-database — cross-database FK references don't exist (each service owns its schema), but a partial backup makes coordinated restore harder.

### Backup recipe (single-host compose)

```bash
docker compose -f urule/infra/compose/docker-compose.phase6.yaml exec -T postgres \
  pg_dumpall -U urule \
  | gzip > urule-postgres-$(date -u +%Y%m%dT%H%M%S).sql.gz
```

`pg_dumpall` includes roles + globals. Run on a schedule (cron, systemd timer, k8s CronJob); ship the resulting `.sql.gz` off-host (S3, GCS, Azure Blob — or any disk that doesn't share fate with the postgres volume).

For incremental / continuous backup, switch to **WAL archiving**:

```bash
# postgresql.conf
archive_mode = on
archive_command = 'gzip < %p > /backup/wal/%f.gz && aws s3 cp /backup/wal/%f.gz s3://urule-pg-wal/%f.gz'
```

Combined with a base backup taken with `pg_basebackup`, this enables point-in-time recovery (PITR). Recommended for any deployment where >1 hour of data loss is unacceptable.

### Recovery — full restore

1. Stop everything that writes: `docker compose stop` (NOT `down -v` — that drops the volume).
2. Drop the volume: `docker compose down -v`.
3. Bring postgres back up alone: `docker compose up -d postgres`. Wait for healthy.
4. The `init-db.sql` script auto-creates the per-service databases.
5. Restore: `gzip -d < urule-postgres-...sql.gz | docker compose exec -T postgres psql -U urule -d postgres`.
6. Bring the rest of the stack up: `docker compose up -d`. The `*-migrate` containers will run drizzle-kit, see migrations are already applied (tracked in `drizzle.__drizzle_migrations`), and exit 0.

### Recovery — single service's database

If only one service's data is corrupted (rare — usually a bad migration):

```bash
# Drop and recreate just that DB (CAUTION: data loss)
docker compose exec postgres psql -U urule -d postgres -c 'DROP DATABASE registry; CREATE DATABASE registry;'

# Restore from a per-database dump (see "Per-database dumps" below)
gzip -d < urule-registry-...sql.gz | docker compose exec -T postgres psql -U urule -d registry

# Bring the affected service back
docker compose up -d registry-migrate registry-seed registry
```

### Per-database dumps

`pg_dumpall` gives you the whole instance, but can be unwieldy if you want fine-grained restore. Per-DB dumps are easy to script:

```bash
for db in registry packagehub mcp_gateway runtime_broker approvals \
          urule_state channel_router; do
  docker compose exec -T postgres pg_dump -U urule -d "$db" \
    | gzip > "urule-${db}-$(date -u +%Y%m%dT%H%M%S).sql.gz"
done
```

Skip `keycloak`, `openfga`, `temporal`, `temporal_visibility` from this list — they have their own backup conventions (Keycloak `kc.sh export`, OpenFGA write-only stores, Temporal namespace export). For a "dump everything once" backup, `pg_dumpall` is simpler.

### Where pg_dumpall is sensitive

- **`urule:urule` default password is in the dump** — it's the role definition. Re-encrypt the dump if storing externally.
- **Drizzle migration tracking table** is in each restored DB. After a restore, drizzle-kit will see all migrations as already-applied, which is correct — never let it re-run them on the restored data.

## NATS JetStream

### What's at risk

Streams in `natsdata` hold:
- Audit events (published by services, consumed by anyone interested).
- Domain events (`urule.registry.*`, `urule.orchestrator.*`, etc.) — durable subscribers replay them on reconnect.
- KV values used by the state service (when it migrates off in-memory Maps).

**Most events are reproducible** because services emit them on every mutation, and Postgres is the source of truth for what mutations happened. Losing the stream means losing audit history older than the consumer's last-seen position, and any KV state the publisher hasn't persisted to Postgres.

### Backup recipe

JetStream supports stream snapshots:

```bash
docker compose exec nats nats stream backup URULE /backup/urule-stream-$(date -u +%Y%m%dT%H%M%S)
docker cp $(docker compose ps -q nats):/backup/urule-stream-... .
```

The `URULE` stream captures `urule.>` (see [packages/events/src/bus/event-bus.ts](../packages/events/src/bus/event-bus.ts), `streamName: 'URULE'`, `streamSubjects: ['urule.>']`).

### Recovery

```bash
docker compose exec nats nats stream restore /backup/urule-stream-... URULE
```

Restored streams keep their original sequence numbers, so durable consumers can resume. New consumers (created post-restore) will see the full history from `start_seq=1`.

## Prometheus

### Don't bother backing up

Metric time series are operational telemetry — derivable on-the-fly from a re-running stack, never source-of-truth for anything user-facing. If `prometheusdata` is lost, you lose query history (panels go blank for the lost window) but nothing else. Acceptable in practice.

For long-term metric retention (e.g. capacity planning beyond 30 days), use a dedicated TSDB backend: VictoriaMetrics, Mimir, Thanos. Those have their own backup stories.

### If you really want it

```bash
docker compose stop prometheus
docker run --rm -v compose_prometheusdata:/src -v $PWD:/dest alpine \
  tar czf /dest/prometheus-$(date -u +%Y%m%dT%H%M%S).tar.gz -C /src .
docker compose start prometheus
```

Prometheus 2.x's TSDB format is internally consistent — a snapshot of `/prometheus/data` is a valid backup.

## Grafana

### What's at risk

Operator-edited dashboards, saved queries, alert rules, user accounts (if you're using the local user store rather than SSO).

The shipped `Urule Services` dashboard is **provisioned** from [grafana-dashboard-services.json](../infra/compose/grafana-dashboard-services.json) and re-loaded on every restart — that part doesn't need backup. But anything an operator created or edited via the UI lives only in `grafanadata`.

### Backup recipe

```bash
docker compose stop grafana
docker run --rm -v compose_grafanadata:/src -v $PWD:/dest alpine \
  tar czf /dest/grafana-$(date -u +%Y%m%dT%H%M%S).tar.gz -C /src .
docker compose start grafana
```

For dashboard-only backup (without the SQLite user/team data), use Grafana's HTTP API:

```bash
curl -s -u admin:urule http://localhost:3030/api/search?type=dash-db \
  | jq -r '.[].uid' \
  | while read uid; do
      curl -s -u admin:urule "http://localhost:3030/api/dashboards/uid/$uid" \
        > "grafana-dashboard-${uid}.json"
    done
```

The exported JSON files can be checked into git — gives you both backup and review/diff for dashboard changes.

## Restore drill (recommended quarterly)

Test the recovery path by simulating loss:

```bash
# 1. Take a backup
./scripts/backup.sh   # whatever wraps the pg_dumpall + nats backup commands

# 2. Tear everything down INCLUDING volumes
docker compose -f infra/compose/docker-compose.phase6.yaml down -v

# 3. Restore from backup
./scripts/restore.sh urule-postgres-<timestamp>.sql.gz urule-stream-<timestamp>

# 4. Bring the stack up
docker compose -f infra/compose/docker-compose.phase6.yaml up -d

# 5. Verify
curl http://localhost:3001/api/v1/orgs   # registry data restored?
docker compose exec postgres psql -U urule -d packagehub -c 'SELECT count(*) FROM packages'   # 27?
```

A drill that hasn't been run is a backup that doesn't work.

## Out of scope

- Backup automation scripts under `scripts/`. The recipes above are the substance; wrapping them in a shell script is straightforward and project-specific (where do dumps go? how often? what's the retention?). Operators tend to want their own opinions on this.
- Cross-region replication / DR. Single-site backups + off-host shipping is the floor. For multi-region failover, run a hot standby Postgres with streaming replication, and a JetStream cluster spanning regions.
- Encryption at rest. Postgres TDE / volume-level encryption (LUKS, EBS-encrypted) — orthogonal to backup mechanics; do both.
