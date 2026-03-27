# Example: MCP Tool Integration

Connect an MCP (Model Context Protocol) server to Urule so agents can use its tools.

## Prerequisites

- Urule services running (`make infra-up`)
- An MCP server binary or package

## Steps

### 1. Register the MCP server

```bash
curl -X POST http://localhost:3005/api/v1/mcp/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "filesystem",
    "description": "Read and write files on the local filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/workspace"],
    "transportType": "stdio"
  }'
```

Save the `id` from the response.

### 2. Register the server's tools

```bash
curl -X POST http://localhost:3005/api/v1/mcp/servers/SERVER_ID/tools \
  -H "Content-Type: application/json" \
  -d '[
    {
      "name": "read_file",
      "description": "Read the contents of a file",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "File path to read" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "write_file",
      "description": "Write content to a file",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "File path to write" },
          "content": { "type": "string", "description": "Content to write" }
        },
        "required": ["path", "content"]
      }
    }
  ]'
```

### 3. Bind to a workspace

```bash
curl -X POST http://localhost:3005/api/v1/mcp/bindings \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "YOUR_WORKSPACE_ID",
    "serverId": "SERVER_ID"
  }'
```

### 4. Verify tools are available

```bash
# List all tools in the workspace
curl http://localhost:3005/api/v1/workspaces/YOUR_WORKSPACE_ID/mcp/tools
```

### 5. Use from the UI

Go to **Integrations** in the sidebar. Your MCP server should appear under "Custom MCP" with its tools listed. You can toggle individual tools on/off.

## Popular MCP Servers

| Server | Install | Purpose |
|--------|---------|---------|
| `@modelcontextprotocol/server-filesystem` | `npx -y @modelcontextprotocol/server-filesystem /path` | File read/write |
| `@modelcontextprotocol/server-brave-search` | `npx -y @modelcontextprotocol/server-brave-search` | Web search |
| `@modelcontextprotocol/server-github` | `npx -y @modelcontextprotocol/server-github` | GitHub API |
| `@modelcontextprotocol/server-postgres` | `npx -y @modelcontextprotocol/server-postgres` | Database queries |

## API Reference

Full MCP Gateway API docs: http://localhost:3005/docs

See the [MCP Gateway repo](https://github.com/urule-os/mcp-gateway) for more details.
