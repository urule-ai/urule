import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/connection.js';
import { buildDependencyTree } from '../services/dependency-tree.js';

const querySchema = z.object({
  maxDepth: z.coerce.number().int().min(1).max(16).optional(),
});

/**
 * GET /api/v1/packages/:name/versions/:version/dependency-tree
 *
 * Returns the recursive dependency tree for a published version. Each
 * node carries `name`, `versionRange` (verbatim from the parent
 * manifest), `resolvedVersion` (latest non-yanked match in packagehub,
 * or null), and `dependencies` (children, recursively). Unresolvable
 * nodes carry an `unresolved` reason so the caller can render them
 * differently from successfully-resolved ones (`missing`, `no_version`,
 * `cycle`, `max_depth`).
 */
export function registerDependencyTreeRoutes(app: FastifyInstance, db: Database) {
  app.get<{
    Params: { name: string; version: string };
    Querystring: { maxDepth?: string };
  }>(
    '/api/v1/packages/:name/versions/:version/dependency-tree',
    {
      schema: {
        tags: ['dependencies'],
        summary: 'Resolve a version\'s dependency tree',
        description:
          'Walks `manifest.dependencies` recursively and returns a tree of `{ name, versionRange, resolvedVersion, dependencies, unresolved? }` nodes. Latest non-yanked version is picked at each step. Cycles, missing packages, no-published-versions, and depth-cap hits are surfaced via `unresolved: "cycle" | "missing" | "no_version" | "max_depth"` rather than failing the whole walk. `?maxDepth` defaults to 8, range 1-16.',
      },
    },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const { name, version } = request.params;
      const tree = await buildDependencyTree(db, name, version, {
        maxDepth: parsed.data.maxDepth,
      });
      if (!tree) {
        return reply.code(404).send({
          error: {
            code: 'PACKAGE_OR_VERSION_NOT_FOUND',
            message: `Package "${name}" version "${version}" not found`,
          },
        });
      }
      return tree;
    },
  );
}
