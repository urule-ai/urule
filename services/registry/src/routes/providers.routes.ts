import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import { ulid } from 'ulid';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/connection.js';
import { providers } from '../db/schema/providers.js';
import { workspaces } from '../db/schema/workspaces.js';
import { AuditLogger } from '@urule/events';
import { requireMembership } from '@urule/authz-middleware';
import { bodyWorkspaceResolver, providerWorkspaceResolver } from '../authz.js';

/**
 * Per-#95: `GET /api/v1/providers` returns every provider system-wide when
 * called without a filter. Gate it: members may pass `?workspaceId=` and
 * see their workspace's providers; the no-filter (cross-workspace) path
 * requires `admin`.
 */
async function requireAdminOrWorkspaceFilter(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = req.uruleUser;
  if (!user?.id) {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }
  if (user.roles?.includes('admin')) return; // admin bypass — no filter required

  const wsId = (req.query as { workspaceId?: string }).workspaceId;
  if (!wsId) {
    reply.code(403).send({
      error: {
        code: 'FORBIDDEN',
        message: 'Pass ?workspaceId= to scope to your workspace, or call as admin for the cross-workspace list',
      },
    });
    return;
  }

  const { allowed } = await req.authz.check(`user:${user.id}`, 'member', `workspace:${wsId}`);
  if (!allowed) {
    reply.code(403).send({
      error: { code: 'FORBIDDEN', message: `Not a member of workspace:${wsId}` },
    });
  }
}

const createProviderSchema = z.object({
  workspaceId: z.string().optional(),
  workspace_id: z.string().optional(),
  name: z.string().min(1),
  provider: z.string().min(1),
  apiKey: z.string().optional(),
  api_key: z.string().optional(),
  modelName: z.string().optional(),
  model_name: z.string().optional(),
  baseUrl: z.string().optional(),
  base_url: z.string().optional(),
  isDefault: z.boolean().optional(),
  is_default: z.boolean().optional(),
}).superRefine(validateProviderApiKey);

const updateProviderSchema = z.object({
  name: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  api_key: z.string().optional(),
  modelName: z.string().optional(),
  model_name: z.string().optional(),
  baseUrl: z.string().optional(),
  base_url: z.string().optional(),
  isDefault: z.boolean().optional(),
  is_default: z.boolean().optional(),
  isActive: z.boolean().optional(),
  is_active: z.boolean().optional(),
}).strict();

type ProviderApiKeyInput = {
  provider?: string;
  apiKey?: string;
  api_key?: string;
  baseUrl?: string;
  base_url?: string;
};

const providerApiKeyPrefixes: Record<string, { prefix: string; label: string }> = {
  anthropic: { prefix: 'sk-ant-', label: 'Anthropic' },
  claude: { prefix: 'sk-ant-', label: 'Anthropic' },
  openai: { prefix: 'sk-', label: 'OpenAI' },
  gemini: { prefix: 'AIza', label: 'Gemini' },
  google: { prefix: 'AIza', label: 'Google' },
  openrouter: { prefix: 'sk-or-', label: 'OpenRouter' },
};

function validateProviderApiKey(data: ProviderApiKeyInput, ctx: z.RefinementCtx) {
  const apiKey = data.apiKey ?? data.api_key;
  const issue = getProviderApiKeyIssue({
    provider: data.provider,
    apiKey,
    baseUrl: data.baseUrl ?? data.base_url,
  });
  if (!issue) return;

  const path = data.apiKey !== undefined ? ['apiKey'] : ['api_key'];
  ctx.addIssue({ code: 'custom', path, message: issue });
}

function getProviderApiKeyIssue({
  provider,
  apiKey,
  baseUrl,
}: {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
}): string | null {
  if (apiKey === undefined || apiKey === '') return null;

  if (apiKey !== apiKey.trim()) return 'API key must not include leading or trailing whitespace';
  if (baseUrl?.trim()) return null;

  const expected = providerApiKeyPrefixes[provider?.trim().toLowerCase() ?? ''];
  if (expected && !apiKey.startsWith(expected.prefix)) {
    return `${expected.label} API keys must start with "${expected.prefix}"`;
  }

  return null;
}

function providerApiKeyValidationDetails(field: 'apiKey' | 'api_key', message: string) {
  return [{
    keyword: 'custom',
    instancePath: `/${field}`,
    schemaPath: `#/${field}/custom`,
    params: {},
    message,
  }];
}

/**
 * #6 (C-06) — recognised hosted endpoint per provider kind. A `baseUrl` whose
 * host matches its kind's hosted endpoint is accepted for any member; anything
 * else is a self-hosted / custom endpoint, which requires the admin role
 * (Ollama, vLLM, LiteLLM proxy — see issue #6's prescribed fix). Keep the keys
 * in sync with `providerApiKeyPrefixes` above.
 */
const providerHostAllowlist: Record<string, (host: string) => boolean> = {
  anthropic: (h) => h === 'api.anthropic.com',
  claude: (h) => h === 'api.anthropic.com',
  openai: (h) => h === 'api.openai.com',
  gemini: (h) => h === 'generativelanguage.googleapis.com',
  google: (h) => h === 'generativelanguage.googleapis.com',
  openrouter: (h) => h === 'openrouter.ai',
  azure: (h) => /^[a-z0-9-]+\.openai\.azure\.com$/.test(h),
};

/**
 * Normalise a host for the SSRF check: strip IPv6 brackets, lowercase, drop a
 * trailing FQDN dot, and collapse an IPv4-mapped/-compatible IPv6 literal
 * (`::ffff:169.254.169.254`, `::ffff:a9fe:a9fe`) down to its embedded IPv4 — so
 * the link-local check below can't be dodged by re-encoding the address.
 */
function normalizeHostForSsrf(host: string): string {
  let h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  const dotted = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1] as string;
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1] as string, 16);
    const lo = parseInt(hex[2] as string, 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return h;
}

/**
 * SSRF hard-stop (#6 / CWE-918): link-local + cloud-metadata + unspecified
 * addresses are never a valid LLM endpoint and are the classic credential-theft
 * target (AWS/GCP/Azure IMDS at `169.254.169.254`, `metadata.google.internal`).
 * Blocked even for admins — who may otherwise legitimately register a self-hosted
 * endpoint on a private/loopback host (Ollama at `localhost`, vLLM at `10.x`).
 * DNS names that *resolve* to these (and decimal/octal IP re-encodings the URL
 * parser leaves as opaque hostnames) can't be caught synchronously; the adapter
 * making the outbound call is the second line of defence.
 */
function isLinkLocalOrMetadataHost(host: string): boolean {
  const h = normalizeHostForSsrf(host);
  if (h === 'metadata.google.internal') return true;
  const v = isIP(h);
  if (v === 4) return h.startsWith('169.254.') || h === '0.0.0.0'; // link-local (incl. IMDS) + unspecified
  // IPv6 link-local fe80::/10 spans first-hextet fe80–febf → prefixes fe8/fe9/fea/feb; plus `::` unspecified.
  if (v === 6) return /^fe[89ab]/.test(h) || h === '::';
  return false;
}

export interface BaseUrlIssue { status: 400 | 403; message: string }

/**
 * Validate a provider `baseUrl` before persisting it (#6 / C-06). Without this,
 * a workspace member could PATCH `baseUrl` to an attacker host and silently
 * exfiltrate the API key + every chat payload the adapter sends there. Policy:
 *
 *  - empty / unset                               → null (adapter uses the default hosted endpoint)
 *  - non-http(s) scheme, or embedded credentials → 400 (blocks `file:`/`gopher:` SSRF + cred smuggling)
 *  - recognised hosted endpoint for the provider → null, but must be https (no plaintext key downgrade)
 *  - any other (self-hosted / custom) host       → 403 unless the caller is admin
 *  - link-local / cloud-metadata host            → 400 even for admins (SSRF hard-stop)
 */
export function getBaseUrlIssue({
  provider,
  baseUrl,
  isAdmin,
}: {
  provider?: string;
  baseUrl?: string;
  isAdmin: boolean;
}): BaseUrlIssue | null {
  if (!baseUrl || !baseUrl.trim()) return null;

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { status: 400, message: 'baseUrl must be a valid absolute URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { status: 400, message: 'baseUrl must use http:// or https://' };
  }
  if (url.username || url.password) {
    return { status: 400, message: 'baseUrl must not contain embedded credentials' };
  }

  // Strip a trailing FQDN dot so `api.openai.com.` is treated as the hosted
  // endpoint — it resolves to the same host, and we don't want the exact-host
  // allow-list to be dodgeable (in either direction) by the dotted form.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const matcher = providerHostAllowlist[provider?.trim().toLowerCase() ?? ''];
  if (matcher && matcher(host)) {
    // Recognised hosted endpoint — must not be downgraded to plaintext.
    if (url.protocol !== 'https:') {
      return { status: 400, message: `baseUrl for ${provider} must use https://` };
    }
    return null;
  }

  // Custom / self-hosted endpoint. Core C-06 fix: a non-admin member must never
  // be able to redirect provider egress off the hosted allow-list.
  if (!isAdmin) {
    return {
      status: 403,
      message: `baseUrl host "${url.hostname}" is not a recognised ${provider ?? 'provider'} endpoint; registering a self-hosted endpoint requires the admin role`,
    };
  }
  // Even an admin may not point egress at link-local / cloud-metadata.
  if (isLinkLocalOrMetadataHost(host)) {
    return { status: 400, message: 'baseUrl must not target a link-local or cloud-metadata address' };
  }
  return null;
}

/** Map a `BaseUrlIssue` to the route's error envelope (400 validation vs 403 forbidden). */
function baseUrlIssueResponse(issue: BaseUrlIssue) {
  if (issue.status === 400) {
    return {
      error: 'Validation failed',
      details: [{
        keyword: 'custom',
        instancePath: '/baseUrl',
        schemaPath: '#/baseUrl/custom',
        params: {},
        message: issue.message,
      }],
    };
  }
  return { error: { code: 'FORBIDDEN', message: issue.message } };
}

const providerIdParamsSchema = z.object({ providerId: z.string() });

const listProvidersQuerySchema = z.object({
  workspaceId: z.string().optional(),
});

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 5) + '...' + key.slice(-4);
}

/** Transform a Drizzle provider row to UI-expected snake_case. */
function toUiProvider(row: Record<string, unknown>, mask = true) {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    name: row.name,
    provider: row.provider,
    model_name: row.modelName,
    api_key: mask ? maskApiKey(row.apiKey as string) : row.apiKey,
    base_url: row.baseUrl,
    is_default: row.isDefault,
    is_active: row.isActive,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function registerProviderRoutes(app: FastifyInstance, db: Database) {
  // Audit events go through the Fastify Pino logger so they pick up the app's
  // redaction config instead of console.log, which bypasses it (#18).
  const audit = new AuditLogger('registry', (topic, data) => {
    app.log.info({ audit: true, topic, ...(data as Record<string, unknown>) }, 'audit');
  });

  // Resource-level authz for the write routes.
  const requireProviderMembership = requireMembership(providerWorkspaceResolver(db));
  const requireBodyMembership = requireMembership(bodyWorkspaceResolver(db));

  // List providers — `?workspaceId=` for members (membership-checked);
  // no filter requires the `admin` role (#95). Previously open to every
  // authenticated user, which leaked cross-workspace provider records.
  app.get<{ Querystring: z.infer<typeof listProvidersQuerySchema> }>('/api/v1/providers', {
    preHandler: requireAdminOrWorkspaceFilter,
    schema: {
      tags: ['providers'],
      summary: 'List LLM providers',
      description: 'Returns providers with masked API keys (last 4 chars only). `?workspaceId=` scopes to a single workspace and requires membership; calling without the filter returns every provider in the system and requires the `admin` role.',
      querystring: listProvidersQuerySchema,
    },
  }, async (request) => {
    const { workspaceId } = request.query;
    const rows = workspaceId
      ? await db.select().from(providers).where(eq(providers.workspaceId, workspaceId))
      : await db.select().from(providers);
    return rows.map(p => toUiProvider(p as Record<string, unknown>));
  });

  // Create provider (accepts both snake_case and camelCase fields)
  app.post<{
    Body: z.infer<typeof createProviderSchema>;
  }>('/api/v1/providers', {
    preHandler: requireBodyMembership,
    schema: {
      tags: ['providers'],
      summary: 'Register an LLM provider key',
      description: 'Body fields: `workspaceId`, `name`, `provider` (`anthropic | openai | gemini | …`), `modelName`, `apiKey`, optional `baseUrl` (for self-hosted), optional `isDefault`. Marking a provider as default unsets the previous default for the same workspace. Body accepts both snake_case and camelCase keys for back-compat.',
      body: createProviderSchema,
    },
  }, async (request, reply) => {
    const b = request.body;
    let workspaceId = (b.workspaceId ?? b.workspace_id ?? '') as string;
    // Resolve to actual workspace if not provided
    if (!workspaceId || workspaceId === 'default') {
      const [ws] = await db.select().from(workspaces).limit(1);
      workspaceId = ws?.id ?? 'default';
    }
    const name = b.name as string;
    const provider = b.provider as string;
    const modelName = (b.modelName ?? b.model_name ?? '') as string;
    const apiKey = (b.apiKey ?? b.api_key ?? '') as string;
    const baseUrl = (b.baseUrl ?? b.base_url ?? '') as string;
    const isDefault = (b.isDefault ?? b.is_default ?? false) as boolean;

    // #6 (C-06) — validate the egress endpoint before persisting. Self-hosted
    // (non-allow-listed) endpoints require the admin role.
    const baseUrlIssue = getBaseUrlIssue({
      provider,
      baseUrl,
      isAdmin: request.uruleUser?.roles?.includes('admin') ?? false,
    });
    if (baseUrlIssue) {
      reply.code(baseUrlIssue.status).send(baseUrlIssueResponse(baseUrlIssue));
      return;
    }

    const id = ulid();
    const now = new Date();

    // If marking as default, unset other defaults for this workspace
    if (isDefault) {
      await db.update(providers)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(providers.workspaceId, workspaceId));
    }

    const [row] = await db.insert(providers).values({
      id,
      workspaceId,
      name,
      provider,
      modelName,
      apiKey,
      baseUrl,
      isDefault,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }).returning();

    if (!row) {
      reply.status(500).send({ error: { code: 'INSERT_FAILED', message: 'Failed to create provider' } });
      return;
    }

    const user = request.uruleUser;
    audit.entityCreated(
      { id: user?.id ?? 'anonymous', username: user?.username ?? 'anonymous' },
      'provider', id, `Provider "${name}" (${provider}) created`,
      { workspaceId },
    ).catch((err: unknown) => request.log.warn({ err }, 'audit emit failed'));

    reply.status(201).send(toUiProvider(row as Record<string, unknown>));
  });

  // Get single provider (masked key)
  app.get<{ Params: z.infer<typeof providerIdParamsSchema> }>('/api/v1/providers/:providerId', {
    schema: {
      tags: ['providers'],
      summary: 'Get provider by id (masked)',
      description: 'Returns the provider row with the API key masked to its last 4 chars. For the unmasked key (used by adapter services to actually call the LLM), see `GET /:providerId/key`.',
      params: providerIdParamsSchema,
    },
  }, async (request, reply) => {
    const { providerId } = request.params;
    const [row] = await db.select().from(providers).where(eq(providers.id, providerId));
    if (!row) {
      reply.status(404).send({ error: { code: 'PROVIDER_NOT_FOUND', message: `Provider ${providerId} not found` } });
      return;
    }
    return toUiProvider(row as Record<string, unknown>);
  });

  // Get provider's real API key — internal-use, admin-gated (#5).
  app.get<{ Params: z.infer<typeof providerIdParamsSchema> }>('/api/v1/providers/:providerId/key', {
    schema: {
      tags: ['providers'],
      summary: 'Get unmasked API key (internal, admin-only)',
      description: 'Returns `{ apiKey, provider, modelName }` with the real API key. **Admin-only** — never expose from the office-ui (the UI uses the masked `GET /:providerId`). Called by orchestrator adapters when picking an LlmProvider impl. TODO(#4): swap the admin gate for proper service-to-service auth once the authz layer can scope provider access to the caller; until then this requires an admin token.',
      params: providerIdParamsSchema,
    },
  }, async (request, reply) => {
    // #5: this returns an UNMASKED LLM key — without the gate, any authenticated
    // user could exfiltrate any provider's key. Until the authz layer (#4) can
    // scope provider access to the caller's workspace, require the `admin` role.
    // The office-ui never calls this; orchestrator adapters are the only
    // legitimate callers and they run with an elevated/service identity.
    const user = request.uruleUser;
    if (!user?.roles?.includes('admin')) {
      reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Admin role required' } });
      return;
    }
    const { providerId } = request.params;
    const [row] = await db.select().from(providers).where(eq(providers.id, providerId));
    if (!row) {
      reply.status(404).send({ error: { code: 'PROVIDER_NOT_FOUND', message: `Provider ${providerId} not found` } });
      return;
    }
    return { apiKey: row.apiKey, provider: row.provider, modelName: row.modelName };
  });

  // Update provider
  app.patch<{ Params: z.infer<typeof providerIdParamsSchema>; Body: z.infer<typeof updateProviderSchema> }>(
    '/api/v1/providers/:providerId',
    {
      preHandler: requireProviderMembership,
      schema: {
        tags: ['providers'],
        summary: 'Update provider',
        description: 'Partial update of any provider field. Setting `isDefault: true` unsets the previous default for the same workspace. To rotate the API key, send the new value in `apiKey` — historical key is dropped.',
        params: providerIdParamsSchema,
        body: updateProviderSchema,
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const b = request.body;

      // Map snake_case to camelCase for Drizzle
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (b.name !== undefined) updates.name = b.name;
      if (b.provider !== undefined) updates.provider = b.provider;
      if (b.modelName !== undefined || b.model_name !== undefined) updates.modelName = b.modelName ?? b.model_name;
      if (b.apiKey !== undefined || b.api_key !== undefined) updates.apiKey = b.apiKey ?? b.api_key;
      if (b.baseUrl !== undefined || b.base_url !== undefined) updates.baseUrl = b.baseUrl ?? b.base_url;
      if (b.isDefault !== undefined || b.is_default !== undefined) updates.isDefault = b.isDefault ?? b.is_default;
      if (b.isActive !== undefined || b.is_active !== undefined) updates.isActive = b.isActive ?? b.is_active;

      const needsApiKeyValidation =
        updates.provider !== undefined ||
        updates.apiKey !== undefined ||
        updates.baseUrl !== undefined;
      if (needsApiKeyValidation) {
        const [existing] = await db.select().from(providers).where(eq(providers.id, providerId));
        if (!existing) {
          reply.status(404).send({ error: { code: 'PROVIDER_NOT_FOUND', message: `Provider ${providerId} not found` } });
          return;
        }

        const issue = getProviderApiKeyIssue({
          provider: (updates.provider as string | undefined) ?? existing.provider,
          apiKey: (updates.apiKey as string | undefined) ?? existing.apiKey,
          baseUrl: (updates.baseUrl as string | undefined) ?? existing.baseUrl,
        });
        if (issue) {
          return reply.code(400).send({
            error: 'Validation failed',
            details: providerApiKeyValidationDetails(b.apiKey !== undefined ? 'apiKey' : 'api_key', issue),
          });
        }

        // #6 (C-06) — only re-validate the egress endpoint when this PATCH is
        // actually changing it, so unrelated updates to rows with a pre-existing
        // custom baseUrl aren't rejected retroactively.
        if (updates.baseUrl !== undefined) {
          const baseUrlIssue = getBaseUrlIssue({
            provider: (updates.provider as string | undefined) ?? existing.provider,
            baseUrl: updates.baseUrl as string,
            isAdmin: request.uruleUser?.roles?.includes('admin') ?? false,
          });
          if (baseUrlIssue) {
            return reply.code(baseUrlIssue.status).send(baseUrlIssueResponse(baseUrlIssue));
          }
        }
      }

      const [row] = await db
        .update(providers)
        .set(updates)
        .where(eq(providers.id, providerId))
        .returning();

      if (!row) {
        reply.status(404).send({ error: { code: 'PROVIDER_NOT_FOUND', message: `Provider ${providerId} not found` } });
        return;
      }

      const user = request.uruleUser;
      // #6 (C-06) — surface egress-endpoint drift explicitly so it's monitorable;
      // a flipped baseUrl is the high-signal indicator of the redirect attack.
      const baseUrlChanged = updates.baseUrl !== undefined;
      if (baseUrlChanged) {
        request.log.warn(
          { providerId, newBaseUrl: row.baseUrl, userId: user?.id ?? 'anonymous' },
          'provider baseUrl changed — LLM egress endpoint updated',
        );
      }
      audit.entityUpdated(
        { id: user?.id ?? 'anonymous', username: user?.username ?? 'anonymous' },
        'provider', providerId, `Provider "${row.name}" updated`,
        { metadata: { fields: Object.keys(b), baseUrlChanged } },
      ).catch((err: unknown) => request.log.warn({ err }, 'audit emit failed'));

      return toUiProvider(row as Record<string, unknown>);
    },
  );

  // Delete provider
  app.delete<{ Params: z.infer<typeof providerIdParamsSchema> }>('/api/v1/providers/:providerId', {
    preHandler: requireProviderMembership,
    schema: {
      tags: ['providers'],
      summary: 'Delete a provider',
      description: 'Hard-removes the provider record. Agents configured with this `provider_id` will fall back to the workspace default on their next chat. 204 on success, 404 PROVIDER_NOT_FOUND when the id is unknown.',
      params: providerIdParamsSchema,
    },
  }, async (request, reply) => {
    const { providerId } = request.params;
    const [row] = await db.delete(providers).where(eq(providers.id, providerId)).returning();
    if (!row) {
      reply.status(404).send({ error: { code: 'PROVIDER_NOT_FOUND', message: `Provider ${providerId} not found` } });
      return;
    }

    const user = request.uruleUser;
    audit.entityDeleted(
      { id: user?.id ?? 'anonymous', username: user?.username ?? 'anonymous' },
      'provider', providerId, `Provider "${row.name}" deleted`,
    ).catch((err: unknown) => request.log.warn({ err }, 'audit emit failed'));

    reply.status(204).send();
  });
}
