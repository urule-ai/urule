import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { WorkspaceIdResolver } from '@urule/authz-middleware';
import type { Database } from './db/connection.js';
import { agents } from './db/schema/agents.js';
import { conversations } from './db/schema/conversations.js';
import { providers } from './db/schema/providers.js';
import { runtimes } from './db/schema/runtimes.js';
import { workspaces } from './db/schema/workspaces.js';

/* ------------------------------------------------------------------ *
 * Workspace-id resolvers for `requireMembership` preHandlers.
 *
 * Each resolver mirrors how its route already determines the workspace,
 * so the membership check and the handler never target different
 * workspaces. Resolvers return `null` to make `requireMembership` answer
 * 404 (unknown resource / no workspace) without leaking existence.
 *
 * The OpenFGA client itself is built by `bootstrapAuthzClient` from
 * `@urule/authz` — see server.ts.
 * ------------------------------------------------------------------ */

/** The first workspace in the database — the registry's demo-mode "current" workspace. */
export async function firstWorkspaceId(db: Database): Promise<string | null> {
  const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
  return ws?.id ?? null;
}

/**
 * Resolver for create routes that carry the workspace id in the body
 * (`workspaceId` / `workspace_id`). Mirrors the routes' own fallback:
 * a missing or `"default"` id resolves to the first workspace.
 */
export function bodyWorkspaceResolver(db: Database): WorkspaceIdResolver {
  return async (req: FastifyRequest) => {
    const body = (req.body ?? {}) as { workspaceId?: string; workspace_id?: string };
    const wsId = body.workspaceId ?? body.workspace_id;
    if (wsId && wsId !== 'default') return wsId;
    return firstWorkspaceId(db);
  };
}

/** Resolver for `/agents/:agentId/...` routes — looks up the agent's workspace. */
export function agentWorkspaceResolver(db: Database): WorkspaceIdResolver {
  return async (req: FastifyRequest) => {
    const { agentId } = req.params as { agentId?: string };
    if (!agentId) return null;
    const [row] = await db
      .select({ workspaceId: agents.workspaceId })
      .from(agents)
      .where(eq(agents.id, agentId));
    return row?.workspaceId ?? null;
  };
}

/** Resolver for `/providers/:providerId` routes — looks up the provider's workspace. */
export function providerWorkspaceResolver(db: Database): WorkspaceIdResolver {
  return async (req: FastifyRequest) => {
    const { providerId } = req.params as { providerId?: string };
    if (!providerId) return null;
    const [row] = await db
      .select({ workspaceId: providers.workspaceId })
      .from(providers)
      .where(eq(providers.id, providerId));
    return row?.workspaceId ?? null;
  };
}

/**
 * Resolver for `/workspaces/:wsId/...` routes — the workspace IS the addressed
 * resource, so the path param is the workspace id directly. A non-existent
 * `:wsId` is left to the membership check (a non-member of an unknown workspace
 * is denied 403, which also avoids leaking which workspace ids exist). Returns
 * `null` only when the param is missing.
 */
export function workspaceParamResolver(): WorkspaceIdResolver {
  return async (req: FastifyRequest) => {
    const { wsId } = req.params as { wsId?: string };
    return wsId ?? null;
  };
}

/**
 * Resolver for `/orgs/:orgId/...` routes — the org IS the addressed resource,
 * so the path param is the org id directly (no DB lookup). Pair with
 * `requireMembership(orgParamResolver(), { objectType: 'org' })`. Returns `null`
 * only when the param is missing; a non-member of an unknown org is denied 403
 * (which also avoids leaking which org ids exist).
 */
export function orgParamResolver(): WorkspaceIdResolver {
  return async (req: FastifyRequest) => {
    const { orgId } = req.params as { orgId?: string };
    return orgId ?? null;
  };
}

/** Resolver for `/conversations/:conversationId/...` routes. */
export function conversationWorkspaceResolver(db: Database): WorkspaceIdResolver {
  return async (req: FastifyRequest) => {
    const { conversationId } = req.params as { conversationId?: string };
    if (!conversationId) return null;
    const [row] = await db
      .select({ workspaceId: conversations.workspaceId })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    return row?.workspaceId ?? null;
  };
}

/** Resolver for `/runtimes/:runtimeId` routes — looks up the runtime's workspace. */
export function runtimeWorkspaceResolver(db: Database): WorkspaceIdResolver {
  return async (req: FastifyRequest) => {
    const { runtimeId } = req.params as { runtimeId?: string };
    if (!runtimeId) return null;
    const [row] = await db
      .select({ workspaceId: runtimes.workspaceId })
      .from(runtimes)
      .where(eq(runtimes.id, runtimeId));
    return row?.workspaceId ?? null;
  };
}
