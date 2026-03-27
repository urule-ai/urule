<p align="center">
  <strong>URULE</strong><br>
  <em>The open-source coordination layer for AI agents</em>
</p>

<p align="center">
  <a href="https://github.com/urule-ai/urule/actions"><img src="https://github.com/urule-ai/urule/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/urule-ai/urule/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://github.com/urule-ai/urule/stargazers"><img src="https://img.shields.io/github/stars/urule-ai/urule?style=social" alt="Stars"></a>
  <a href="https://github.com/urule-ai/urule/issues"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://github.com/urule-ai/urule"><img src="https://img.shields.io/badge/TypeScript-ESM-3178c6.svg" alt="TypeScript"></a>
  <a href="https://x.com/uruleai"><img src="https://img.shields.io/badge/follow-%40uruleai-1DA1F2?logo=x&style=social" alt="Follow @uruleai"></a>
</p>

<p align="center">
  <a href="#get-started-in-60-seconds">Quick Start</a> |
  <a href="GETTING-STARTED.md">Full Guide</a> |
  <a href="ROADMAP.md">Roadmap</a> |
  <a href="CONTRIBUTING.md">Contribute</a> |
  <a href="AI-JOURNEYS.md">AI Journeys</a>
</p>

---

**Urule is the open-source coordination layer for AI agents.** It composes best-in-class open-source projects into one cohesive platform and only builds the coordination glue — so you can focus on what your AI agents actually do.

- **Deploy AI agents** with personality packs, system prompts, and real-time streaming chat
- **Orchestrate with any framework** — LangGraph, CrewAI, AutoGen, ADK (pluggable adapter interface)
- **Human-in-the-loop approvals** with risk levels, reasoning, and audit trails
- **11 installable package types** — personalities, skills, tools, widgets, workflows, and more
- **MCP tool registry** — connect any MCP server, discover tools, bind to workspaces
- **Multi-channel routing** — Slack, Telegram, webhooks, with more adapters coming
- **Office UI** — immersive Next.js dashboard with widgets, light/dark mode, and mobile support

## Why Urule?

| | Urule | LangGraph alone | Dify | CrewAI |
|---|---|---|---|---|
| **Control plane** (auth, registry, approvals) | Built-in | Build yourself | Partial | No |
| **Pluggable orchestrators** | Any (adapter interface) | LangGraph only | Built-in only | CrewAI only |
| **MCP tool registry** | Built-in gateway | No | No | No |
| **Package ecosystem** (install/publish/discover) | 11 package types | No | Templates only | No |
| **Human-in-the-loop approvals** | Rich (risk, reasoning, audit) | Manual | Basic | No |
| **Multi-channel messaging** | Slack, Telegram, webhooks | No | No | No |
| **Office UI** | Full-featured | No | Yes | No |
| **Open source** | Apache 2.0 | Apache 2.0 | Apache 2.0 | MIT |
| **Standalone components** | 7 repos usable independently | No | No | No |

**Core principle:** Reuse execution, reuse orchestration, reuse auth, reuse eventing — only build the glue.

## Get Started in 60 Seconds

```bash
# Clone the repo
git clone https://github.com/urule-ai/urule.git && cd urule

# Start everything with Docker
make infra-up

# Start the Office UI
make dev-ui

# Open http://localhost:3000 and click "Demo Login"
```

See [GETTING-STARTED.md](GETTING-STARTED.md) for the full setup guide including deploying your first AI agent.

## Architecture

```
 HUMANS
   |
   +-- Operators (Backstage UI, CLI)
   +-- End Users (Office UI, Chat Channels)
   |
============================================================
 LAYER 1: PORTAL
   backstage plugin --> Backstage (OSS)

 LAYER 2: CONTROL PLANE (what Urule builds)
   registry ------- source of truth for all entities
   packages ------- install/upgrade/remove lifecycle
   packagehub ----- discovery, search, metadata
   governance ----- policy (OPA) + authz (OpenFGA) gateway
   approvals ------ approval lifecycle (Temporal-backed)
   channel-router - message normalization (Slack, Telegram)
   mcp-gateway ---- MCP server registry + tool routing
   state ---------- room presence, task ownership

 LAYER 3: ORCHESTRATION
   langgraph-adapter -- LangGraph + Anthropic Claude

 LAYER 4: EXECUTION
   runtime-broker --> sandboxed.sh (OSS)

 PLATFORM SERVICES (external OSS)
   Temporal | Keycloak | OpenFGA | OPA | NATS
   PostgreSQL | OpenTelemetry | Jaeger
============================================================
```

## Ecosystem

Urule is split across 8 repositories. Standalone repos work independently outside Urule.

### Standalone Repos

| Repo | Description | Use Case |
|------|-------------|----------|
| [widget-sdk](https://github.com/urule-ai/widget-sdk) | Widget iframe bridge protocol | Embed micro-frontends in any app |
| [orchestrator-contract](https://github.com/urule-ai/orchestrator-contract) | Adapter interface + compliance tests | Build AI orchestrator integrations |
| [mcp-gateway](https://github.com/urule-ai/mcp-gateway) | MCP server registry + tool catalog | Manage MCP tools at scale |
| [channel-router](https://github.com/urule-ai/channel-router) | Multi-channel message normalization | Unify messaging across channels |
| [approvals](https://github.com/urule-ai/approvals) | Temporal-backed approval workflows | Add approval flows to any system |
| [runtime-broker](https://github.com/urule-ai/runtime-broker) | Sandbox session allocation | Manage isolated execution environments |
| [langgraph-adapter](https://github.com/urule-ai/langgraph-adapter) | LangGraph + Anthropic Claude adapter | Run AI agents with LangGraph |

### Core Packages (this repo)

| Path | Purpose |
|------|---------|
| `packages/spec` | Entity types, manifest schema, validators |
| `packages/events` | NATS event envelope, topics, audit logger |
| `packages/authz` | OpenFGA SDK wrapper |
| `packages/auth-middleware` | Fastify JWT plugin (Keycloak JWKS) |
| `services/registry` | Source of truth: orgs, workspaces, agents, runtimes |
| `services/packagehub` | Package discovery, search, metadata |
| `services/governance` | OPA + OpenFGA policy/authz gateway |
| `services/state` | Room presence, task ownership, widget state |
| `apps/office-ui` | Next.js 14 immersive office frontend |

## How to Extend

| What to Build | Start Here | Time |
|--------------|-----------|------|
| New AI orchestrator adapter | [orchestrator-contract](https://github.com/urule-ai/orchestrator-contract) | ~2 hours |
| New messaging channel | [channel-router](https://github.com/urule-ai/channel-router) | ~1 hour |
| New UI widget | [widget-sdk](https://github.com/urule-ai/widget-sdk) | ~30 min |
| New agent personality | [CLAUDE.md](CLAUDE.md) recipes | ~15 min |
| New MCP tool integration | [mcp-gateway](https://github.com/urule-ai/mcp-gateway) | ~30 min |
| New backend service | [CLAUDE.md](CLAUDE.md) recipes | ~1 hour |

## Examples

```bash
examples/
  hello-agent/      # Deploy your first AI agent
  custom-widget/    # Build a widget from scratch
  mcp-tool/         # Connect an MCP server
```

See [examples/](examples/) for step-by-step walkthroughs.

## Tech Stack

| Concern | Choice |
|---------|--------|
| Language | TypeScript (ESM, strict) |
| Backend | Fastify 5, Drizzle ORM, PostgreSQL 16 |
| Events | NATS + JetStream |
| Auth | Keycloak (authn) + OpenFGA (authz) |
| Frontend | Next.js 14, React 18, Tailwind CSS, Zustand |
| Tests | Vitest (unit), Playwright (E2E) |
| IDs | ULID |
| Containers | Docker multi-stage (node:20-slim) |

## Documentation

| Document | For |
|----------|-----|
| [GETTING-STARTED.md](GETTING-STARTED.md) | First-time setup, deploy your first agent |
| [ROADMAP.md](ROADMAP.md) | ~140 improvement items to pick up |
| [USER-JOURNEYS.md](USER-JOURNEYS.md) | Every UI flow + Playwright test checklists |
| [AI-JOURNEYS.md](AI-JOURNEYS.md) | How AI agents use and build on Urule |
| [SKILLS.md](SKILLS.md) | Machine-readable platform capabilities |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design decisions + system diagrams |
| [CLAUDE.md](CLAUDE.md) | AI assistant patterns, recipes, conventions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute (human or AI) |

## Contributing

We'd love your help making AI more usable. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Ways to contribute:**
- Pick an item from the [Roadmap](ROADMAP.md)
- Build a [widget](https://github.com/urule-ai/widget-sdk), [orchestrator adapter](https://github.com/urule-ai/orchestrator-contract), or [channel adapter](https://github.com/urule-ai/channel-router)
- Add [examples](examples/), improve docs, or suggest features via [Issues](https://github.com/urule-ai/urule/issues)
- AI developers: read [CLAUDE.md](CLAUDE.md) for patterns and step-by-step recipes

If Urule is useful to you, please star the repo — it helps others discover it.

## Acknowledgments

Agent personality templates inspired by [agency-agents](https://github.com/msitarzewski/agency-agents/), [gstack](https://github.com/garrytan/gstack), and [dexter](https://github.com/virattt/dexter).

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
