# Getting Started with Urule

Deploy your first AI agent in 5 minutes.

## Prerequisites

- **Docker** and Docker Compose v2 ([install](https://docs.docker.com/get-docker/))
- **Node.js 20+** ([install](https://nodejs.org/))
- An **Anthropic API key** (for real AI chat — optional, demo mode works without it)

## Step 1: Clone and Setup

```bash
git clone https://github.com/urule-os/urule.git
cd urule
make setup
```

This clones all ecosystem repos and installs dependencies.

## Step 2: Start the Platform

```bash
# Start all backend services (PostgreSQL, NATS, registry, adapter, etc.)
make infra-up

# Start the Office UI
make dev-ui
```

Open **http://localhost:3000** in your browser.

## Step 3: Login

Click **"Demo Login"** on the login page. This bypasses Keycloak authentication and logs you in as a demo user with full access.

## Step 4: Configure an AI Provider (Optional)

To chat with a real AI agent, you need an API key:

1. Go to **Settings** (gear icon in sidebar)
2. In the **Model Providers** section, click **"Add Provider"**
3. Select **Claude** (Anthropic)
4. Enter your Anthropic API key
5. Click **Save**

Without an API key, you can still explore the UI, deploy agents, and manage approvals — the chat will just not have real AI responses.

## Step 5: Deploy Your First Agent

1. Click **"Agents"** in the sidebar
2. Click **"New Agent"**
3. Browse the template catalog (50+ agents across 7 categories)
4. Click a template to see details, then **"Select"**
5. Configure the agent name, thinking depth, and verbosity
6. Click **"Deploy Agent"**

You'll see a celebration page with confetti.

## Step 6: Chat with Your Agent

1. Click **"Start Chat"** from the agent success page (or go to **Chat** in the sidebar)
2. Type a message and press Enter
3. Watch the agent respond in real-time with streaming text

The agent has three built-in tools:
- **hire_agent** — hire specialist agents (requires your approval)
- **create_task** — create tracked tasks
- **update_task_status** — signal progress and request acceptance

## What's Next?

| Goal | Where to Go |
|------|-------------|
| Explore the dashboard | `/office` — stats, agent activity, infrastructure |
| Manage approvals | `/office/approvals` — review AI agent requests |
| Create a project | `/office/projects` — timeline and kanban views |
| Connect tools | `/office/integrations` — Slack, GitHub, MCP servers |
| Customize theme | `/office/settings` — dark/light/system toggle |
| Build a widget | [widget-sdk](https://github.com/urule-os/widget-sdk) |
| Add an orchestrator | [orchestrator-contract](https://github.com/urule-os/orchestrator-contract) |
| Run tests | `make test` (unit) or `make e2e-playwright` (E2E) |
| Read the architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Browse the roadmap | [ROADMAP.md](ROADMAP.md) |

## Troubleshooting

### Docker services won't start
```bash
# Check if ports are in use
lsof -i :3001  # registry
lsof -i :5500  # PostgreSQL

# Restart everything
make infra-down && make infra-up
```

### No personalities in agent catalog
The PackageHub service needs to be running with seeded data. Ensure `make infra-up` completed successfully and check `http://localhost:3009/healthz`.

### Permission errors with `.next/` or `node_modules/`
These are likely root-owned files from previous Docker builds:
```bash
sudo rm -rf apps/office-ui/.next
sudo rm -rf apps/office-ui/node_modules
npm install
```

### Chat not responding
Check that the adapter service is running: `curl http://localhost:3002/healthz`. If using real AI, verify your API key is configured in Settings.

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Office UI | 3000 | http://localhost:3000 |
| Registry | 3001 | http://localhost:3001/docs |
| Adapter | 3002 | http://localhost:3002/docs |
| Approvals | 3003 | http://localhost:3003/docs |
| State | 3007 | http://localhost:3007/docs |
| PackageHub | 3009 | http://localhost:3009/docs |
| PostgreSQL | 5500 | — |
| NATS | 4222 | http://localhost:8222 (monitor) |

Every service exposes Swagger docs at `/docs`.
