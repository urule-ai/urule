# Urule — A Linux for AI

> A thin, open control plane for AI coworkers that composes open-source projects into one cohesive platform.

Urule doesn't reinvent orchestration, execution, auth, or eventing. It glues together best-in-class open-source tools and only builds the coordination layer — so you can focus on what your AI agents actually do.

**Core principle:** Reuse execution, reuse orchestration, reuse auth, reuse eventing — only build the glue.

## Why Urule?

AI tooling today is fragmented. You need orchestration (LangGraph, CrewAI), sandboxed execution, approval workflows, tool registries, multi-channel routing, and a UI — but no single project provides the coordination layer that ties them together.

Urule is that layer. It's designed to be:

- **Composable** — Swap orchestrators, add channels, install widgets. Everything is pluggable.
- **Extendable** — Build widgets, orchestrator adapters, channel adapters, and package types.
- **Open** — Every component is Apache 2.0 licensed. Standalone components work outside Urule too.

## Architecture

```
 HUMANS
   |
   +-- Operators (Backstage UI, CLI)
   +-- End Users (Office UI, Chat Channels)
   |
═══════════════════════════════════════════════════
 LAYER 1: PORTAL
═══════════════════════════════════════════════════
   backstage plugin ──> Backstage (OSS)
   |
═══════════════════════════════════════════════════
 LAYER 2: CONTROL PLANE (what Urule builds)
═══════════════════════════════════════════════════
   registry ─────── source of truth for all entities
   packages ─────── install/upgrade/remove lifecycle
   packagehub ───── discovery, search, metadata
   governance ───── policy (OPA) + authz (OpenFGA) gateway
   approvals ────── approval lifecycle (Temporal-backed)    ★ standalone
   channel-router ─ message normalization                   ★ standalone
   mcp-gateway ──── MCP server registry + tool routing      ★ standalone
   state ────────── room presence, task ownership
   |
═══════════════════════════════════════════════════
 LAYER 3: ORCHESTRATION
═══════════════════════════════════════════════════
   langgraph-adapter ── LangGraph + Anthropic Claude        ★ standalone
   |
═══════════════════════════════════════════════════
 LAYER 4: EXECUTION
═══════════════════════════════════════════════════
   runtime-broker ──> sandboxed.sh (OSS)                    ★ standalone
   |
═══════════════════════════════════════════════════
 PLATFORM SERVICES (external OSS)
═══════════════════════════════════════════════════
   Temporal │ Keycloak │ OpenFGA │ OPA │ NATS
   PostgreSQL │ OpenTelemetry │ Jaeger
```

Items marked with ★ are **standalone repos** that can be used independently of Urule.

## Ecosystem

Urule is split across multiple repositories. Some are generic and usable independently; others are Urule-specific.

### Standalone Repos (use independently or with Urule)

| Repo | Description | Use Case |
|------|-------------|----------|
| [widget-sdk](https://github.com/urule-os/widget-sdk) | Widget iframe bridge protocol, manifest schema, registry | Embed micro-frontends in any app |
| [orchestrator-contract](https://github.com/urule-os/orchestrator-contract) | Standard adapter interface + compliance test suite | Build AI orchestrator integrations |
| [mcp-gateway](https://github.com/urule-os/mcp-gateway) | MCP server registry, workspace bindings, tool catalog | Manage MCP tools at scale |
| [channel-router](https://github.com/urule-os/channel-router) | Multi-channel message normalization (Slack, Telegram, webhooks) | Unify messaging across channels |
| [approvals](https://github.com/urule-os/approvals) | Temporal-backed approval workflow engine | Add approval flows to any system |
| [runtime-broker](https://github.com/urule-os/runtime-broker) | Sandbox session allocation broker | Manage isolated execution environments |
| [langgraph-adapter](https://github.com/urule-os/langgraph-adapter) | LangGraph + Anthropic Claude orchestrator adapter | Run AI agents with LangGraph |

### This Repo (Urule Core)

| Path | Package | Purpose |
|------|---------|---------|
| `packages/spec` | `@urule/spec` | Entity types, manifest JSON Schema, validators |
| `packages/events` | `@urule/events` | NATS event envelope, topic conventions, typed pub/sub |
| `packages/authz` | `@urule/authz` | OpenFGA SDK wrapper, relation types, auth model |
| `services/registry` | `@urule/registry` | Source of truth: orgs, workspaces, agents, runtimes |
| `services/packages` | `@urule/packages` | Install/upgrade/remove lifecycle, dependency resolution |
| `services/packagehub` | `@urule/packagehub` | Package discovery, search, metadata |
| `services/governance` | `@urule/governance` | Combined OPA + OpenFGA policy/authz gateway |
| `services/state` | `@urule/state` | Room presence, task ownership, widget state |
| `plugins/backstage` | `@urule/backstage-plugin` | Sync entities to Backstage catalog |
| `apps/office-ui` | `@urule/office-ui` | Next.js 14 immersive office frontend |
| `infra/` | — | Docker Compose, scripts, SQL seeds, E2E tests |

## Quick Start

### Prerequisites

- Docker and Docker Compose v2
- Node.js 20+ (for local development)

### Run the full stack

```bash
# Clone this repo and standalone repos
./scripts/clone-all.sh

# Start infrastructure + all services
cd infra
docker compose -f compose/docker-compose.phase6.yaml up --build

# Access the Office UI
open http://localhost:3000
```

### Run tests

```bash
# All unit tests in Docker
cd infra/compose
docker compose -f docker-compose.tests.yaml up --build --abort-on-container-exit

# E2E integration tests (28 tests)
cd infra
./scripts/run-phase1.sh
```

### Service Ports

| Service | Default Port |
|---------|-------------|
| Office UI | http://localhost:3000 |
| Registry | http://localhost:3001 |
| LangGraph Adapter | http://localhost:3002 |
| Approvals | http://localhost:3003 |
| Runtime Broker | http://localhost:4500 |
| State | http://localhost:3007 |
| PackageHub | http://localhost:3009 |
| PostgreSQL | localhost:5500 |
| NATS | localhost:4222 |
| Temporal UI | http://localhost:8280 |
| Keycloak | http://localhost:8281 |
| Jaeger | http://localhost:16686 |

## How to Extend Urule

### Build a Widget

Widgets are micro-frontends that plug into the Office UI. Use the [Widget SDK](https://github.com/urule-os/widget-sdk) to build one:

1. Define a `WidgetManifest` with your widget's metadata
2. Implement your widget as a React component or iframe-based app
3. Use the bridge protocol for host communication
4. Register it in the widget registry

See the [Widget SDK docs](https://github.com/urule-os/widget-sdk) for details.

### Add an Orchestrator

Implement the [Orchestrator Contract](https://github.com/urule-os/orchestrator-contract) to integrate any AI framework:

1. Implement the `OrchestratorAdapter` interface (8 methods)
2. Run the compliance test suite to verify correctness
3. Deploy as a Fastify service
4. Register with the Urule registry

See the [langgraph-adapter](https://github.com/urule-os/langgraph-adapter) for a reference implementation.

### Add a Channel

Add a new messaging channel to the [Channel Router](https://github.com/urule-os/channel-router):

1. Implement the `ChannelAdapter` interface
2. Normalize messages into the unified format
3. Register the adapter

See the [Channel Router docs](https://github.com/urule-os/channel-router) for a step-by-step guide.

### Create a Package

Urule supports 11 package types: `personality`, `skill`, `tool`, `mcp-connector`, `widget`, `theme`, `workflow`, `integration`, `template`, `runtime-profile`, `governance-policy`.

Each package has a manifest validated against the `@urule/spec` JSON Schema.

## Tech Stack

| Concern | Choice |
|---------|--------|
| Language | TypeScript (ESM) |
| HTTP framework | Fastify 5 |
| ORM | Drizzle ORM |
| Database | PostgreSQL 16 (schema-per-service) |
| Test runner | Vitest |
| Container | Docker multi-stage (node:20-slim) |
| ID generation | ULID |
| Events | NATS + JetStream |
| Auth | Keycloak (authn) + OpenFGA (authz) |
| Frontend | Next.js 14, React 18, Tailwind CSS, Zustand |

## Design Principles

1. **Services are glue, not business logic.** If a service exceeds ~2000 lines, it's doing too much.
2. **Contract-first.** Types and interfaces live in library packages; services implement them.
3. **Schema-per-service.** Each service owns its Postgres schema. Never query another service's database.
4. **Event-driven.** Mutations publish events to NATS. Consumers are idempotent.
5. **Auth flow.** User → Keycloak JWT → service validates → governance/authz checks.

## Test Summary

| Area | Tests |
|------|-------|
| Core libraries (spec, events, authz) | 45 |
| Standalone services (approvals, mcp-gateway, etc.) | 133 |
| Core services (registry, packages, governance, state) | 72 |
| E2E integration | 28 |
| **Total** | **278** |

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full improvement plan — ~140 items across security, testing, UX, infrastructure, developer experience, and features. Each item is scoped to a specific repo with actionable sub-tasks. Pick any unchecked item and contribute!

## User Journeys & Testing

See [USER-JOURNEYS.md](USER-JOURNEYS.md) for the complete user journey map — every screen, every flow, manual UX test checklists, and future feature ideas organized by section.

## Contributing

We'd love your help making AI more usable. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Ways to contribute:
- Pick an item from the [Roadmap](ROADMAP.md) — security fixes, tests, UX improvements, and more
- Build a new [widget](https://github.com/urule-os/widget-sdk)
- Implement an [orchestrator adapter](https://github.com/urule-os/orchestrator-contract) for your favorite AI framework
- Add a [channel adapter](https://github.com/urule-os/channel-router) for a new messaging platform
- Improve docs, fix bugs, or suggest features via [Issues](https://github.com/urule-os/urule/issues)

## Acknowledgments

Agent personality templates and formats are inspired by:

- [agency-agents](https://github.com/msitarzewski/agency-agents/) — Agent personality templates with markdown + YAML frontmatter
- [gstack](https://github.com/garrytan/gstack) — Garry Tan's agent stack
- [dexter](https://github.com/virattt/dexter) — Dexter agent framework

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
