import type { FastifyInstance } from 'fastify';

/**
 * Stub routes for /api/v1/integrations — returns mock data so the Office UI
 * doesn't 404. Will be backed by a real DB table in a future phase.
 */
export function registerIntegrationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { category?: string } }>('/api/v1/integrations', {
    schema: {
      tags: ['integrations'],
      summary: 'List integrations',
      description: 'Returns the workspace\'s registered third-party integrations (Slack, Notion, GitHub, custom MCP servers, …) with their current status. Optional `?category=communication|productivity|development|custom_mcp` filter. Stub today (returns canned data) until the integration registry table lands.',
    },
  }, async (request) => {
    const { category } = request.query;
    const all = [
      {
        id: 'int-github',
        workspace_id: 'default',
        name: 'GitHub',
        category: 'development',
        integration_type: 'github',
        status: 'active',
        settings: {},
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'int-slack',
        workspace_id: 'default',
        name: 'Slack',
        category: 'communication',
        integration_type: 'slack',
        status: 'disconnected',
        settings: {},
        connected_at: null,
        last_synced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    return category ? all.filter(i => i.category === category) : all;
  });

  app.post('/api/v1/integrations', {
    schema: {
      tags: ['integrations'],
      summary: 'Connect a new integration (stub)',
      description: 'Stub returning `{ id: "int-stub", status: "active" }`. Real wire-up will OAuth-handshake with the upstream provider via Keycloak.',
    },
  }, async (_request, reply) => {
    reply.status(201).send({ id: 'int-stub', status: 'active' });
  });

  app.post<{ Params: { id: string } }>('/api/v1/integrations/:id/reconnect', {
    schema: {
      tags: ['integrations'],
      summary: 'Reconnect a disconnected integration (stub)',
      description: 'Stub returning the integration to `active` status. Real wire-up re-runs the OAuth handshake without re-prompting the user when refresh tokens are still valid.',
    },
  }, async (request) => {
    return { id: request.params.id, status: 'active' };
  });

  app.post('/api/v1/integrations/mcp', {
    schema: {
      tags: ['integrations'],
      summary: 'Register a custom MCP server (stub)',
      description: 'Stub: registers a custom Model Context Protocol server. Real wire-up persists to a `mcp_integrations` table and pings the server\'s `/health` to confirm it\'s reachable.',
    },
  }, async (_request, reply) => {
    reply.status(201).send({ id: 'mcp-stub', status: 'active' });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/integrations/mcp/:id', {
    schema: {
      tags: ['integrations'],
      summary: 'Remove a custom MCP server (stub)',
      description: 'Stub: 204 always. Real wire-up will revoke the server\'s registration and detach it from any agents that referenced it.',
    },
  }, async (_request, reply) => {
    reply.status(204).send();
  });

  // Sandbox MCP stubs
  app.get('/api/v1/sandbox/mcp', {
    schema: {
      tags: ['integrations'],
      summary: 'List sandbox MCP servers (stub)',
      description: 'Stub returning `[]`. Sandbox MCP servers run inside the per-agent sandbox and expose curated tool sets (filesystem, browser, etc.).',
    },
  }, async () => []);
  app.get('/api/v1/sandbox/tools', {
    schema: {
      tags: ['integrations'],
      summary: 'List sandbox tools (stub)',
      description: 'Stub returning `[]`. The full list pulls from each registered sandbox MCP server\'s tool catalogue.',
    },
  }, async () => []);
  app.post<{ Params: { id: string } }>('/api/v1/sandbox/mcp/:id/enable', {
    schema: { tags: ['integrations'], summary: 'Enable sandbox MCP server (stub)', description: 'Stub: returns `{ ok: true }`.' },
  }, async () => ({ ok: true }));
  app.post<{ Params: { id: string } }>('/api/v1/sandbox/mcp/:id/disable', {
    schema: { tags: ['integrations'], summary: 'Disable sandbox MCP server (stub)', description: 'Stub: returns `{ ok: true }`.' },
  }, async () => ({ ok: true }));
  app.post('/api/v1/sandbox/mcp/refresh', {
    schema: { tags: ['integrations'], summary: 'Refresh sandbox MCP catalogue (stub)', description: 'Stub: returns `{ ok: true }`. Real wire-up re-pings every registered server to refresh its tool list.' },
  }, async () => ({ ok: true }));
  app.post('/api/v1/sandbox/mcp', {
    schema: { tags: ['integrations'], summary: 'Add sandbox MCP server (stub)', description: 'Stub: returns 201 `{ ok: true }`.' },
  }, async (_request, reply) => { reply.status(201).send({ ok: true }); });
  app.delete<{ Params: { id: string } }>('/api/v1/sandbox/mcp/:id', {
    schema: { tags: ['integrations'], summary: 'Remove sandbox MCP server (stub)', description: 'Stub: 204 always.' },
  }, async (_request, reply) => { reply.status(204).send(); });
  app.post<{ Params: { name: string } }>('/api/v1/sandbox/tools/:name/toggle', {
    schema: { tags: ['integrations'], summary: 'Toggle a sandbox tool on/off (stub)', description: 'Stub: returns `{ ok: true }`. Real wire-up flips the tool\'s `enabled` flag in the sandbox config.' },
  }, async () => ({ ok: true }));
}
