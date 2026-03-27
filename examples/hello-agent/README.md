# Example: Hello Agent

Deploy your first AI agent via the Urule API.

## Prerequisites

- Urule services running (`make infra-up` from repo root)
- Node.js 20+

## Steps

### 1. Create a workspace

```bash
curl -X POST http://localhost:3001/api/v1/orgs \
  -H "Content-Type: application/json" \
  -d '{"name": "My Org", "slug": "my-org"}'

# Save the orgId from the response

curl -X POST http://localhost:3001/api/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{"orgId": "YOUR_ORG_ID", "name": "Dev Workspace", "slug": "dev"}'
```

### 2. Add an AI provider

```bash
curl -X POST http://localhost:3001/api/v1/providers \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "YOUR_WORKSPACE_ID",
    "name": "Claude",
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "modelName": "claude-sonnet-4-20250514",
    "isDefault": true
  }'
```

### 3. Deploy an agent

```bash
curl -X POST http://localhost:3001/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "YOUR_WORKSPACE_ID",
    "name": "Hello Agent",
    "description": "A friendly greeting agent",
    "config": {
      "systemPrompt": "You are a friendly assistant. Greet users warmly and help them learn about Urule.",
      "role": "greeter"
    }
  }'
```

### 4. Create a conversation and chat

```bash
# Create conversation
curl -X POST http://localhost:3001/api/v1/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "YOUR_WORKSPACE_ID",
    "title": "Hello World",
    "agentIds": ["YOUR_AGENT_ID"]
  }'

# Send a message (triggers AI response via WebSocket)
curl -X POST http://localhost:3002/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "YOUR_CONVERSATION_ID",
    "agentId": "YOUR_AGENT_ID",
    "workspaceId": "YOUR_WORKSPACE_ID",
    "userMessage": "Hello! What can you tell me about Urule?"
  }'
```

### 5. Check the response

Open **http://localhost:3000/office/chat** to see the conversation in the UI, or connect via WebSocket:

```javascript
const ws = new WebSocket(`ws://localhost:3002/api/v1/ws/conversations/YOUR_CONVERSATION_ID`);
ws.onmessage = (event) => console.log(JSON.parse(event.data));
```

## What's Next

- Add MCP tools to your agent: [mcp-tool example](../mcp-tool/)
- Build a custom widget: [custom-widget example](../custom-widget/)
- Explore the full API: http://localhost:3001/docs
