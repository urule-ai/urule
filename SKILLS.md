# Urule Skills & Capabilities

A machine-readable reference of everything Urule can do — for AI agents discovering, using, and building on the platform.

## Platform Identity

```yaml
name: Urule
tagline: A Linux for AI
description: Thin control plane for AI coworkers — composes open-source projects into one cohesive platform
repository: https://github.com/urule-os/urule
license: Apache-2.0
language: TypeScript (ESM)
framework: Fastify 5 + Next.js 14
```

## Ecosystem Repositories

| Repository | Purpose | Standalone |
|-----------|---------|-----------|
| [urule](https://github.com/urule-os/urule) | Core platform (registry, state, governance, UI) | No |
| [widget-sdk](https://github.com/urule-os/widget-sdk) | Widget iframe bridge protocol | Yes |
| [orchestrator-contract](https://github.com/urule-os/orchestrator-contract) | Adapter interface for AI orchestrators | Yes |
| [mcp-gateway](https://github.com/urule-os/mcp-gateway) | MCP server registry + tool catalog | Yes |
| [channel-router](https://github.com/urule-os/channel-router) | Multi-channel message normalization | Yes |
| [approvals](https://github.com/urule-os/approvals) | Temporal-backed approval workflows | Yes |
| [runtime-broker](https://github.com/urule-os/runtime-broker) | Sandbox session allocation | Yes |
| [langgraph-adapter](https://github.com/urule-os/langgraph-adapter) | LangGraph + Anthropic Claude adapter | Yes |

## System Tools (Available to AI Agents)

AI agents running inside Urule have these tools injected automatically:

### hire_agent
Request a specialist agent for a subtask.
```json
{
  "name": "hire_agent",
  "parameters": {
    "agent_role": "string — role of the specialist needed",
    "reason": "string — why this specialist is needed",
    "task_description": "string — what the specialist should do",
    "urgency": "low | medium | high"
  },
  "requires_approval": true,
  "side_effects": ["creates task", "creates approval request", "registers new agent on approval"]
}
```

### create_task
Make work visible and tracked.
```json
{
  "name": "create_task",
  "parameters": {
    "title": "string — task title",
    "description": "string — task details",
    "priority": "low | medium | high | urgent"
  },
  "requires_approval": false,
  "side_effects": ["creates task in state service"]
}
```

### update_task_status
Signal progress and request acceptance.
```json
{
  "name": "update_task_status",
  "parameters": {
    "task_id": "string — ULID of the task",
    "status": "in_progress | review | done",
    "progress_note": "string — description of progress"
  },
  "requires_approval": false,
  "side_effects": ["updates task", "if review: shows accept/reject buttons"]
}
```

## API Surface

### Registry Service (port 3001)
Source of truth for all entities.

```
POST   /api/v1/orgs                    — Create organization
GET    /api/v1/orgs                    — List organizations
POST   /api/v1/workspaces             — Create workspace
GET    /api/v1/workspaces             — List workspaces
POST   /api/v1/agents                 — Register agent
GET    /api/v1/agents                 — List agents (paginated)
GET    /api/v1/agents/{id}            — Get agent details
PATCH  /api/v1/agents/{id}            — Update agent config
POST   /api/v1/agents/{id}/status     — Update agent status
POST   /api/v1/runtimes               — Register runtime
POST   /api/v1/providers              — Add model provider (API key)
GET    /api/v1/providers/{id}/key     — Get provider API key
POST   /api/v1/conversations          — Create conversation
GET    /api/v1/conversations          — List conversations
POST   /api/v1/conversations/{id}/messages — Send message
GET    /api/v1/conversations/{id}/messages — Get messages
POST   /auth/login                    — Authenticate (Keycloak proxy)
GET    /auth/me                       — Get current user
GET    /docs                          — OpenAPI Swagger UI
```

### Adapter Service (port 3002)
AI execution engine (LangGraph + Anthropic Claude).

```
POST   /api/v1/chat                   — Send chat message (streaming)
POST   /api/v1/chat/action            — Handle inline action button
WS     /api/v1/ws/conversations/{id}  — Real-time streaming WebSocket
POST   /api/v1/runs                   — Start orchestration run
GET    /api/v1/runs/{id}/state        — Get run state
POST   /api/v1/runs/{id}/pause        — Pause for approval
POST   /api/v1/runs/{id}/resume       — Resume run
DELETE /api/v1/runs/{id}              — Cancel run
POST   /api/v1/runs/{id}/artifacts    — Emit artifact
GET    /api/v1/capabilities           — List orchestrator capabilities
GET    /docs                          — OpenAPI Swagger UI
```

### Approvals Service (port 3003)
Human-in-the-loop approval workflows.

```
POST   /api/v1/approvals              — Create approval request
GET    /api/v1/approvals              — List approvals (filterable)
GET    /api/v1/approvals/{id}         — Get approval details
POST   /api/v1/approvals/{id}/approve — Approve
POST   /api/v1/approvals/{id}/deny    — Deny
POST   /api/v1/approvals/{id}/request-changes — Request changes
POST   /api/v1/approvals/{id}/escalate — Escalate
POST   /api/v1/approval-rules         — Create routing rule
GET    /docs                          — OpenAPI Swagger UI
```

### State Service (port 3007)
Room presence, task ownership, widget state.

```
POST   /api/v1/rooms                  — Create room
POST   /api/v1/rooms/{id}/presence    — Join room
POST   /api/v1/tasks                  — Create task
PATCH  /api/v1/tasks/{id}             — Update task
POST   /api/v1/tasks/{id}/assign      — Assign task
PUT    /api/v1/widget-state/{id}      — Set widget state
GET    /docs                          — OpenAPI Swagger UI
```

### MCP Gateway (port 3005)
MCP server registry and tool catalog.

```
POST   /api/v1/mcp/servers            — Register MCP server
GET    /api/v1/mcp/servers            — List servers
POST   /api/v1/mcp/servers/{id}/tools — Register tools
GET    /api/v1/mcp/tools              — Search tools
POST   /api/v1/mcp/bindings           — Bind server to workspace
GET    /docs                          — OpenAPI Swagger UI
```

### PackageHub (port 3009)
Package discovery and metadata.

```
GET    /api/v1/packages               — Search packages (?q=, ?type=, ?verified=)
POST   /api/v1/packages               — Publish package
GET    /api/v1/packages/{name}        — Get package details
POST   /api/v1/packages/{name}/versions — Publish version
GET    /docs                          — OpenAPI Swagger UI
```

## Package Types

AI agents can create, publish, and install these package types:

| Type | Purpose | Key Manifest Fields |
|------|---------|-------------------|
| `personality` | Agent persona | `systemPrompt`, `goals`, `operatingStyle`, `traits` |
| `skill` | Tool bundle | `tools[]`, `inputSchema`, `outputSchema` |
| `mcp_connector` | MCP server launcher | `serverCommand`, `args`, `env`, `auth` |
| `widget` | UI component | `entryType`, `mountPoints`, `permissions`, `dimensions` |
| `workflow` | Temporal workflow | `workflowId`, `taskQueue`, `steps[]` |
| `template` | Composed setup | `agents[]`, `skills[]`, `connectors[]`, `widgets[]` |
| `policy` | Governance rule | `opaPolicy`, `fgaModel`, `policyType` |
| `channel` | Messaging adapter | `channelType`, `webhookUrl`, `auth` |
| `orchestrator` | AI framework adapter | `adapterModule`, `capabilities` |
| `runtime` | Execution environment | `dockerImage`, `profile`, `resources` |
| `office` | Virtual workspace | `mapFile`, `rooms[]`, `theme` |

## Event Topics (NATS)

Events published to NATS for real-time integration:

```
urule.registry.org.created          — Organization created
urule.registry.workspace.created    — Workspace created
urule.registry.agent.registered     — Agent registered
urule.registry.agent.updated        — Agent config changed
urule.orchestrator.run.started      — Run started
urule.orchestrator.run.completed    — Run completed
urule.approvals.approval.requested  — Approval requested
urule.approvals.approval.decided    — Approval decided
urule.channels.message.received     — Message from external channel
urule.mcp.server.registered         — MCP server registered
urule.state.presence.changed        — Room presence changed
urule.audit.entity.created          — Audit: entity created
urule.audit.approval.decided        — Audit: approval decision
urule.audit.access.denied           — Audit: access denied
```

**Event Envelope:**
```json
{
  "id": "ULID",
  "type": "urule.domain.entity.action",
  "source": "service-name",
  "timestamp": "ISO 8601",
  "version": 1,
  "correlationId": "ULID",
  "data": { ... }
}
```

## Widget Mount Points

Where widgets can be placed in the Office UI:

| Mount Point | Location | Typical Use |
|------------|----------|-------------|
| `sidebar` | Left sidebar | Quick access tools, stats |
| `main-panel` | Central content area | Full-page widgets |
| `status-bar` | Bottom bar | System status, notifications |
| `modal` | Overlay dialog | Focused interactions |
| `drawer` | Slide-out panel | Detail views |

## Extension Points Summary

| What to Build | Interface/Pattern | Documentation |
|--------------|------------------|---------------|
| New AI orchestrator | `OrchestratorAdapter` (8 methods) | [orchestrator-contract](https://github.com/urule-os/orchestrator-contract) |
| New messaging channel | `ChannelAdapter` (4 methods) | [channel-router](https://github.com/urule-os/channel-router) |
| New UI widget | `WidgetManifest` + component | [widget-sdk](https://github.com/urule-os/widget-sdk) |
| New agent personality | `personality` package manifest | CLAUDE.md recipes |
| New MCP integration | MCP server registration | [mcp-gateway](https://github.com/urule-os/mcp-gateway) |
| New approval rules | Approval routing rules API | [approvals](https://github.com/urule-os/approvals) |
| New governance policy | OPA/OpenFGA rules | `services/governance/` |
| New backend service | Fastify service scaffold | CLAUDE.md "How to add a new service" |

## Discovery Endpoints

Every service exposes these for automated discovery:

| Endpoint | Returns |
|----------|---------|
| `GET /healthz` | Service health status |
| `GET /docs` | Swagger UI (human-readable) |
| `GET /docs/json` | OpenAPI 3.0 spec (machine-readable) |

---

*This document is designed to be parsed by AI agents for capability discovery. For human-oriented guides, see [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [CLAUDE.md](CLAUDE.md).*
