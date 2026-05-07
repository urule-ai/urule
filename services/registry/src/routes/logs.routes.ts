import type { FastifyInstance } from 'fastify';

/**
 * Stub routes for /api/v1/logs and /api/v1/notifications — returns mock data
 * so the Office UI doesn't 404. Will be backed by a real event store later.
 */
export function registerLogRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { actor_type?: string; event_type?: string; search?: string; limit?: string } }>(
    '/api/v1/logs',
    {
      schema: {
        tags: ['logs'],
        summary: 'List activity-log entries',
        description:
          "Filterable activity feed: `?actor_type=user|agent|system`, `?event_type=info|success|warning|critical|modification|integration`, free-text `?search=`, `?limit=`. Stub today (returns canned data) until the audit-event consumer lands; the office-ui logs page calls it directly.",
      },
    },
    async (request) => {
      const limit = parseInt(request.query.limit ?? '50', 10);
      const now = new Date().toISOString();
      const logs = [
        {
          id: 'log-1',
          workspace_id: 'default',
          actor_id: 'system',
          actor_type: 'system',
          event_type: 'info',
          title: 'Phase 6 stack started',
          description: 'All services are healthy and running',
          metadata_json: {},
          created_at: now,
        },
        {
          id: 'log-2',
          workspace_id: 'default',
          actor_id: 'system',
          actor_type: 'system',
          event_type: 'success',
          title: 'Database initialized',
          description: 'Registry and PackageHub schemas created',
          metadata_json: {},
          created_at: now,
        },
      ];
      return logs.slice(0, limit);
    },
  );

  app.get('/api/v1/notifications', {
    schema: {
      tags: ['logs'],
      summary: 'Notification list (stub)',
      description:
        "Per-user notification stream. Stub returning `[]` today — the real wire-up routes notifications through the office-ui notification-center store directly (no server roundtrip needed for the WS-pushed approvals path). Kept for forward-compat: a future inbox / mark-all-read flow lands here.",
    },
  }, async () => []);

  app.patch<{ Params: { id: string } }>('/api/v1/notifications/:id/read', {
    schema: {
      tags: ['logs'],
      summary: 'Mark notification read (stub)',
      description: "Stub: returns `{ id, is_read: true }` regardless. Pairs with the GET stub above.",
    },
  }, async (request) => {
    return { id: request.params.id, is_read: true };
  });
}
