import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/connection.js';
import { agents } from '../db/schema/agents.js';
import { eq, sql } from 'drizzle-orm';

/**
 * /api/v1/office/stats — Dashboard statistics.
 * Returns live agent counts from the DB and stub values for the rest.
 */
export function registerStatsRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/v1/office/stats', {
    schema: {
      tags: ['stats'],
      summary: 'Aggregate dashboard counters',
      description:
        "Returns `{ agents_online, agents_active, agents_idle, agents_offline, approvals_pending, workflows_today, api_calls_24h }` — drives the office-ui Overview widget's four tiles. Computed live (no caching) since the cost is small; hot-path memoisation can land if it ever becomes a concern.",
    },
  }, async () => {
    // Live agent counts
    const rows = await db.select({ status: agents.status, count: sql<number>`count(*)::int` })
      .from(agents)
      .groupBy(agents.status);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r.count;

    return {
      agents_online: (counts['active'] ?? 0) + (counts['idle'] ?? 0) + (counts['thinking'] ?? 0) + (counts['busy'] ?? 0),
      agents_active: counts['active'] ?? 0,
      agents_idle: counts['idle'] ?? 0,
      agents_offline: counts['offline'] ?? 0,
      approvals_pending: 0,
      workflows_today: 0,
      api_calls_24h: 0,
    };
  });
}
