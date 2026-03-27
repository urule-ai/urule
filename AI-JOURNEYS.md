# Urule AI Journeys

How AI agents interact with Urule — as platform users running inside the system AND as developers building on it. Each journey includes steps, test cases, and future improvements.

For human user journeys, see [USER-JOURNEYS.md](USER-JOURNEYS.md).

---

## Part A: AI Agent as Platform User

These journeys describe how an AI agent operates within Urule after being deployed.

### A1. Agent Onboarding

An AI agent gets configured and activated in a workspace.

| Step | What Happens | API |
|------|-------------|-----|
| 1 | Personality pack selected from PackageHub | `GET /api/v1/packages?type=personality` |
| 2 | Agent registered in workspace | `POST /api/v1/agents` with `config.systemPrompt` |
| 3 | MCP tools bound to workspace | `POST /api/v1/mcp/bindings` |
| 4 | Provider API key configured | `POST /api/v1/providers` |
| 5 | Agent status set to active | `POST /api/v1/agents/{id}/status` |

#### Tests — Agent Onboarding
- [ ] Agent created with personality pack → system prompt loaded from manifest
- [ ] Agent created without personality → uses default system prompt
- [ ] Agent with invalid provider → appropriate error on first chat
- [ ] Agent status transitions: idle → active → offline → active
- [ ] Agent config update persists across restarts

#### Future Improvements
- [ ] Agent self-configuration (agent reads its own config and suggests changes)
- [ ] Auto-detect required MCP tools from system prompt
- [ ] Agent onboarding wizard guided by another AI agent
- [ ] Agent cloning from templates with one API call
- [ ] Multi-model agents (switch models per task complexity)

---

### A2. Conversation & Reasoning

An AI agent receives a message, thinks, and responds with streaming.

| Step | What Happens | API/Protocol |
|------|-------------|-------------|
| 1 | User sends message | `POST /api/v1/chat` |
| 2 | Adapter fetches agent config | `GET /api/v1/agents/{id}` |
| 3 | Adapter fetches API key | `GET /api/v1/providers/{id}/key` |
| 4 | Adapter fetches conversation history | `GET /api/v1/conversations/{id}/messages?limit=50` |
| 5 | Adapter calls Anthropic API with system tools | Claude API with streaming |
| 6 | Response streamed via WebSocket | `WS /api/v1/ws/conversations/{id}` |
| 7 | Messages saved to registry | `POST /api/v1/conversations/{id}/messages` |

**WebSocket Events:**
- `text_delta` — incremental text chunk
- `thinking` — reasoning/chain-of-thought
- `tool_use` — agent is calling a tool
- `tool_result` — tool execution result
- `message_complete` — final message
- `error` — execution error

#### Tests — Conversation
- [ ] Send message → receive streaming response via WebSocket
- [ ] Conversation history loaded (last 50 messages) as context
- [ ] System prompt from agent config used correctly
- [ ] Markdown rendered properly in response
- [ ] Code blocks have language annotation
- [ ] Long conversations don't exceed context window (truncation)
- [ ] Agent handles empty/whitespace-only messages gracefully

#### Future Improvements
- [ ] Conversation branching (fork from any message)
- [ ] Multi-model routing (simple tasks → Haiku, complex → Opus)
- [ ] RAG integration (retrieve from workspace documents)
- [ ] Conversation summarization for context compression
- [ ] Agent memory persistence across conversations
- [ ] Streaming progress indicators for long-running tool calls
- [ ] Voice-to-text input / text-to-speech output

---

### A3. System Tool Use

AI agents have three built-in tools injected into every conversation.

#### hire_agent
Request a specialist agent for a subtask.

| Step | What Happens | API |
|------|-------------|-----|
| 1 | Agent determines specialist is needed | Internal reasoning |
| 2 | Agent calls `hire_agent` tool | `{ agent_role, reason, task_description, urgency }` |
| 3 | Task created in state service | `POST /api/v1/tasks` |
| 4 | Approval request created | `POST /api/v1/approvals` |
| 5 | Action buttons sent to user | Message with approve/deny buttons |
| 6 | User approves | `POST /api/v1/chat/action` → `POST /api/v1/approvals/{id}/approve` |
| 7 | New agent registered | `POST /api/v1/agents` |
| 8 | Task reassigned to new agent | `POST /api/v1/tasks/{id}/assign` |

#### create_task
Make work visible and tracked.

| Step | What Happens | API |
|------|-------------|-----|
| 1 | Agent identifies a task | Internal reasoning |
| 2 | Agent calls `create_task` | `{ title, description, priority }` |
| 3 | Task created | `POST /api/v1/tasks` |
| 4 | Confirmation sent to user | Text response with task details |

#### update_task_status
Signal progress and request acceptance.

| Step | What Happens | API |
|------|-------------|-----|
| 1 | Agent completes work | Internal reasoning |
| 2 | Agent calls `update_task_status` | `{ task_id, status, progress_note }` |
| 3 | Task updated | `PATCH /api/v1/tasks/{id}` |
| 4 | If status=review: action buttons | Accept/reject buttons in chat |

#### Tests — Tool Use
- [ ] hire_agent creates both task AND approval
- [ ] hire_agent approval → new agent registered with correct config
- [ ] hire_agent denial → task cancelled, no agent created
- [ ] create_task with all priority levels (low/medium/high/urgent)
- [ ] update_task_status transitions: in_progress → review → done
- [ ] update_task_status with review → shows accept/reject buttons
- [ ] Tools work in group conversations (multi-agent)
- [ ] Tool errors return graceful messages (not stack traces)

#### Future Improvements
- [ ] Custom tool registration (agents define their own tools)
- [ ] Tool result caching (avoid re-executing identical calls)
- [ ] Tool execution sandboxing (limit blast radius)
- [ ] Tool usage analytics (which agents use which tools)
- [ ] Tool approval rules (auto-approve low-risk tools)
- [ ] Agent-to-agent tool sharing
- [ ] Tool composition (pipe output of one tool to another)

---

### A4. MCP Tool Discovery & Execution

AI agents discover and use MCP (Model Context Protocol) tools.

| Step | What Happens | API |
|------|-------------|-----|
| 1 | List workspace MCP servers | `GET /api/v1/workspaces/{wsId}/mcp/servers` |
| 2 | Discover available tools | `GET /api/v1/workspaces/{wsId}/mcp/tools` |
| 3 | Tool details with JSON Schema | `GET /api/v1/mcp/tools/{toolId}` |
| 4 | Agent calls tool via MCP protocol | MCP server stdin/SSE |
| 5 | Result returned to agent context | Tool result in conversation |

#### Tests — MCP Tools
- [ ] Register MCP server → tools auto-discovered
- [ ] Bind MCP server to workspace → tools available to agents
- [ ] Unbind → tools no longer available
- [ ] Tool input validated against JSON Schema
- [ ] MCP server health check on connection
- [ ] Multiple MCP servers in same workspace

#### Future Improvements
- [ ] MCP tool marketplace (browse and install)
- [ ] Auto-bind popular MCP servers on workspace creation
- [ ] MCP server monitoring (uptime, latency, error rates)
- [ ] MCP tool usage analytics per agent
- [ ] AI-suggested MCP tools based on agent role
- [ ] MCP server auto-discovery via DNS/mDNS

---

### A5. Approval Workflow

AI agent actions that require human oversight.

| Step | What Happens | API |
|------|-------------|-----|
| 1 | Agent action triggers approval | `POST /api/v1/approvals` |
| 2 | Approval created with rich metadata | reasoning, risk level, proposed changes |
| 3 | User reviews in approvals UI | `GET /api/v1/approvals/{id}` |
| 4 | User decides | `POST /api/v1/approvals/{id}/approve` or `/deny` |
| 5 | Decision routed back to agent | Via action buttons or event |
| 6 | Agent proceeds or adjusts | Conditional logic |

**Approval Metadata:**
- `reasoningPoints[]` — why the agent wants to do this
- `proposedChanges[]` — what will change (diff format)
- `riskLevel` — low/medium/high/critical
- `impactSummary` — human-readable impact description
- `accessPermissions[]` — what access is being requested

#### Tests — Approvals
- [ ] Low-risk approval → created with correct risk level
- [ ] High-risk approval → escalation rules apply
- [ ] Approved → agent proceeds with action
- [ ] Denied → agent receives denial and adjusts
- [ ] Request changes → agent receives feedback
- [ ] Approval expires → agent notified
- [ ] Audit trail records all decisions

#### Future Improvements
- [ ] Auto-approve rules (low-risk actions from trusted agents)
- [ ] Batch approvals (approve multiple similar requests)
- [ ] Approval delegation to other agents
- [ ] Risk scoring ML model (predict risk from action context)
- [ ] Approval SLA alerts (time-to-decision tracking)
- [ ] Conditional approvals ("approve if X, deny if Y")

---

### A6. Multi-Agent Collaboration

Multiple AI agents working together in meetings and handoffs.

| Step | What Happens | API |
|------|-------------|-----|
| 1 | User creates meeting | `POST /api/v1/conversations` with `type: "meeting"` |
| 2 | Agents added as participants | `agentIds: [...]` |
| 3 | Each agent sees shared context | Conversation history |
| 4 | Agent hires specialist | `hire_agent` tool |
| 5 | Task delegated | `POST /api/v1/tasks/{id}/assign` |

#### Tests — Collaboration
- [ ] Meeting with 2+ agents → all receive messages
- [ ] Agent hires another agent → new agent joins workspace
- [ ] Task delegation between agents
- [ ] Presence tracking (which agents are in which rooms)

#### Future Improvements
- [ ] Agent-to-agent direct messaging (no human in loop)
- [ ] Agent role-based routing (DevOps questions → DevOps agent)
- [ ] Shared workspace memory (agents share learned context)
- [ ] Agent voting/consensus on decisions
- [ ] Agent performance reviews (peer evaluation)
- [ ] Automated standup meetings (daily agent status reports)

---

### A7. Artifact Emission

AI agents produce artifacts (code, files, reports).

| Step | What Happens | API |
|------|-------------|-----|
| 1 | Agent generates artifact | Internal processing |
| 2 | Artifact emitted to run | `POST /api/v1/runs/{runId}/artifacts` |
| 3 | Artifact stored | `{ artifactId, type, uri, metadata }` |
| 4 | UI renders artifact | Code viewer, file download, report display |

**Artifact Types:** code, file, report, image, data, log

#### Tests — Artifacts
- [ ] Code artifact with syntax highlighting
- [ ] File artifact with download link
- [ ] Multiple artifacts per run
- [ ] Artifact metadata preserved

#### Future Improvements
- [ ] Artifact versioning (track changes over iterations)
- [ ] Artifact sharing across conversations
- [ ] Artifact execution (run code artifacts in sandbox)
- [ ] Artifact search (full-text search across all artifacts)
- [ ] Auto-generated reports from task completion

---

## Part B: AI Agent as Developer

These journeys describe how an AI coding assistant (Claude Code, Cursor, Copilot) extends Urule.

### B1. API Discovery

An AI developer discovers Urule's API surface.

| Step | What Happens | Resource |
|------|-------------|----------|
| 1 | Read project overview | `README.md` |
| 2 | Read architecture decisions | `ARCHITECTURE.md` |
| 3 | Read coding conventions | `CLAUDE.md` |
| 4 | Browse API docs per service | `http://localhost:{port}/docs` |
| 5 | Fetch OpenAPI spec | `GET /docs/json` on any service |
| 6 | Read available skills | `SKILLS.md` |
| 7 | Read existing patterns | Source code in `services/`, `packages/` |

#### Tests — API Discovery
- [ ] CLAUDE.md contains all coding patterns
- [ ] Each service /docs returns valid OpenAPI spec
- [ ] /docs/json is machine-parseable
- [ ] SKILLS.md lists all capabilities
- [ ] README links to all discovery documents

#### Future Improvements
- [ ] Unified API gateway with single OpenAPI spec
- [ ] GraphQL federation layer for unified queries
- [ ] SDK generation from OpenAPI specs (TypeScript client)
- [ ] Interactive API playground (like Postman)
- [ ] API changelog (breaking changes tracking)

---

### B2. Package Creation

An AI developer creates and publishes a new package.

| Step | What Happens | API/File |
|------|-------------|----------|
| 1 | Choose package type | See SKILLS.md for 11 types |
| 2 | Create `urule-package.json` manifest | Follow manifest schema in `@urule/spec` |
| 3 | Implement package logic | Source code |
| 4 | Validate manifest | `validateManifest()` from `@urule/spec` |
| 5 | Publish to PackageHub | `POST /api/v1/packages` + `POST /api/v1/packages/{name}/versions` |
| 6 | Package discoverable | `GET /api/v1/packages?q=...` |

**Manifest Example (personality):**
```json
{
  "name": "@urule/my-agent",
  "version": "1.0.0",
  "type": "personality",
  "description": "A specialized agent for...",
  "personality": {
    "systemPrompt": "You are...",
    "goals": ["Goal 1", "Goal 2"],
    "operatingStyle": "Concise and direct"
  },
  "traits": ["analytical", "detail-oriented"],
  "skills": ["data-analysis", "reporting"]
}
```

#### Tests — Package Creation
- [ ] Personality package with valid manifest → published
- [ ] Skill package with tools → published
- [ ] Widget package with manifest + component → published
- [ ] Invalid manifest → validation error
- [ ] Duplicate package name → 409 conflict
- [ ] Package search finds published package
- [ ] Version bumping works

#### Future Improvements
- [ ] Package scaffolding CLI (`urule create-package`)
- [ ] Package testing framework (validate in sandbox before publish)
- [ ] Package dependency resolution visualization
- [ ] Automated compatibility testing across Urule versions
- [ ] Package usage analytics (downloads, active installs)

---

### B3. New Service Scaffolding

An AI developer creates a new microservice following Urule patterns.

| Step | What Happens | Reference |
|------|-------------|-----------|
| 1 | Read CLAUDE.md recipe | "How to add a new service" section |
| 2 | Create directory | `services/my-service/` |
| 3 | Create package.json | `@urule/my-service`, fastify, zod, ulid deps |
| 4 | Create config.ts | `loadConfig()` + `validateConfig()` |
| 5 | Create server.ts | CORS → rate limit → auth → swagger → error handler → routes |
| 6 | Create routes | Zod validation, pagination, error patterns |
| 7 | Create Dockerfile | Multi-stage + HEALTHCHECK |
| 8 | Add to docker-compose | Port, env vars, healthcheck |
| 9 | Add tests | `app.inject()` pattern |
| 10 | Add to API router | `apps/office-ui/src/lib/api.ts` ROUTE_MAP |

#### Tests — Service Scaffolding
- [ ] Service builds with `npm run build`
- [ ] Service passes tests with `npm test`
- [ ] /healthz returns 200
- [ ] /docs returns Swagger UI
- [ ] Zod validation rejects invalid input (400)
- [ ] Auth middleware protects routes
- [ ] Docker image builds and runs
- [ ] Graceful shutdown on SIGTERM

#### Future Improvements
- [ ] `urule scaffold service` CLI command
- [ ] Service template generator (Yeoman/Plop)
- [ ] Auto-generate service from OpenAPI spec
- [ ] Service dependency graph visualization
- [ ] Service health dashboard (real-time)

---

### B4. Widget Development

An AI developer creates a new widget for the Office UI.

| Step | What Happens | Reference |
|------|-------------|-----------|
| 1 | Read Widget SDK docs | `widget-sdk` repo README |
| 2 | Create widget component | `apps/office-ui/src/widgets/builtin/MyWidget.tsx` |
| 3 | Define manifest | Mount points, permissions, dimensions |
| 4 | Register manifest | `apps/office-ui/src/widgets/manifests.ts` |
| 5 | Export from index | `apps/office-ui/src/widgets/builtin/index.ts` |
| 6 | Widget appears in UI | WidgetZone renders it |

**Mount Points:** `sidebar`, `main-panel`, `modal`, `status-bar`, `drawer`

#### Tests — Widget Development
- [ ] Native widget renders in WidgetZone
- [ ] Widget receives theme updates
- [ ] Widget config persistence works
- [ ] Widget permissions enforced
- [ ] External (iframe) widget communicates via bridge

#### Future Improvements
- [ ] Widget hot-reload during development
- [ ] Widget marketplace (browse, install, rate)
- [ ] Widget analytics (usage, performance)
- [ ] AI-generated widgets from natural language description
- [ ] Widget composition (nest widgets inside widgets)

---

### B5. Channel Adapter Development

An AI developer adds support for a new messaging channel.

| Step | What Happens | Reference |
|------|-------------|-----------|
| 1 | Read channel-router README | `channel-router` repo |
| 2 | Implement `ChannelAdapter` interface | `receiveWebhook`, `sendMessage`, `sendApprovalCard`, `mapIdentity` |
| 3 | Add channel type to union | `src/types.ts` |
| 4 | Register adapter | `channelManager.registerAdapter(new MyAdapter())` |
| 5 | Webhook endpoint auto-created | `POST /api/v1/channels/my-channel/webhook` |

#### Tests — Channel Adapter
- [ ] Webhook receives and normalizes messages
- [ ] Outbound messages sent via channel API
- [ ] Approval cards rendered in channel format
- [ ] Identity mapping resolves channel users to Urule users

#### Future Improvements
- [ ] Channel adapter SDK with testing helpers
- [ ] Auto-generate adapter from API schema
- [ ] Channel health monitoring
- [ ] Multi-channel message routing rules

---

### B6. Orchestrator Adapter Development

An AI developer integrates a new AI framework (CrewAI, AutoGen, ADK, etc.).

| Step | What Happens | Reference |
|------|-------------|-----------|
| 1 | Install `@urule/orchestrator-contract` | npm package |
| 2 | Implement `OrchestratorAdapter` interface | 8 methods |
| 3 | Run compliance test suite | `import { runComplianceTests } from '@urule/orchestrator-contract/testing'` |
| 4 | Deploy as Fastify service | Standard middleware stack |
| 5 | Register with Urule | Docker Compose + config |

**Interface (8 methods):**
```typescript
startRun(params) → RunHandle
pauseForApproval(runId, approval) → void
resumeRun(runId, input) → void
cancelRun(runId, reason) → void
getState(runId) → RunState
emitArtifact(runId, artifact) → void
handoffAgent(runId, params) → void
getCapabilities() → OrchestratorCapabilities
```

#### Tests — Orchestrator Adapter
- [ ] Compliance test suite passes (all 8 methods)
- [ ] Run lifecycle: start → pause → resume → complete
- [ ] Artifact emission persists data
- [ ] Capabilities correctly advertised
- [ ] Human-in-the-loop approval gate works

#### Future Improvements
- [ ] Orchestrator adapter for CrewAI
- [ ] Orchestrator adapter for AutoGen
- [ ] Orchestrator adapter for Google ADK
- [ ] Orchestrator adapter for local LLMs (Ollama)
- [ ] Orchestrator benchmarking (compare performance across adapters)
- [ ] Multi-orchestrator routing (best adapter per task type)

---

### B7. Contributing Code

An AI developer submits a contribution via PR.

| Step | What Happens | Reference |
|------|-------------|-----------|
| 1 | Read CLAUDE.md | Coding patterns and conventions |
| 2 | Read CONTRIBUTING.md | PR process and testing requirements |
| 3 | Create feature branch | `git checkout -b feat/my-feature` |
| 4 | Make changes | Follow patterns from CLAUDE.md |
| 5 | Add tests | Vitest for unit, Playwright for E2E |
| 6 | Run tests | `make test` + `make e2e-playwright` |
| 7 | Commit | Conventional Commits format |
| 8 | Open PR | Use PR template |
| 9 | CI checks pass | Lint, test, security audit, Docker validate |

#### Tests — Contributing
- [ ] PR template renders correctly
- [ ] CI pipeline runs on PR
- [ ] Commit message validation (Conventional Commits)
- [ ] Test coverage doesn't decrease

#### Future Improvements
- [ ] AI code review bot (auto-review PRs)
- [ ] Auto-generate changelog from commits
- [ ] PR size warnings (flag large PRs)
- [ ] Automatic dependency update PRs (Renovate/Dependabot)
- [ ] AI-assisted PR description generation

---

## Cross-Cutting AI Tests

### API Consistency
- [ ] All services respond to `GET /healthz`
- [ ] All services expose `GET /docs` (Swagger)
- [ ] All POST endpoints validate with Zod (400 on invalid)
- [ ] All services require JWT auth (except public routes)
- [ ] All services rate-limit requests
- [ ] All list endpoints support `limit` and `offset`

### Error Handling
- [ ] Invalid JSON body → 400 (not 500)
- [ ] Missing required field → 400 with field name
- [ ] Unauthorized request → 401
- [ ] Non-existent resource → 404
- [ ] Rate limit exceeded → 429

### Event Consistency
- [ ] Entity creation publishes NATS event
- [ ] Audit logger fires on sensitive operations
- [ ] Events follow envelope format (id, type, source, timestamp, correlationId, data)

---

## AI Agent Capability Matrix

| Capability | Status | API | Notes |
|-----------|--------|-----|-------|
| Chat with streaming | Working | `POST /chat` + WebSocket | Anthropic Claude |
| Hire specialist agents | Working | `hire_agent` tool | Requires approval |
| Create tasks | Working | `create_task` tool | |
| Update task status | Working | `update_task_status` tool | Review triggers accept/reject |
| Search packages | Working | `GET /packages` | Full-text search |
| Install packages | Working | `POST /packages/install` | Semver resolution |
| Register MCP servers | Working | `POST /mcp/servers` | stdio/SSE/HTTP |
| Discover MCP tools | Working | `GET /mcp/tools` | Per-workspace |
| Request approvals | Working | `POST /approvals` | Rich metadata |
| Emit artifacts | Working | `POST /runs/{id}/artifacts` | Code, files, reports |
| Room presence | Working | `POST /rooms/{id}/presence` | Online/away/busy |
| Widget state | Working | `PUT /widget-state/{id}` | Per-instance config |
| Custom orchestration | Contract | `OrchestratorAdapter` | 8-method interface |
| Channel routing | Working | Channel adapters | Slack, Telegram, webhook |

---

*Last updated: 2026-03-27*
