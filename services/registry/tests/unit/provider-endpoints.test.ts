import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerProviderRoutes } from '../../src/routes/providers.routes.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

function makeMockDb({
  existingProvider,
  insertReturns,
  updateReturns,
}: {
  existingProvider?: Record<string, unknown>;
  insertReturns?: Record<string, unknown>[];
  updateReturns?: Record<string, unknown>[];
} = {}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([{ id: '01WORKSPACE' }])),
        where: vi.fn(() => Promise.resolve(existingProvider ? [existingProvider] : [])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve(insertReturns ?? [])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(updateReturns ?? [])),
        })),
      })),
    })),
  };
}

async function buildApp(db = makeMockDb()) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  registerProviderRoutes(app, db as never);
  return app;
}

function expectValidationDetail(details: unknown, field: string, message: string) {
  expect((details as Array<Record<string, unknown>>).some((detail) => {
    if (detail.message !== message) return false;
    if (Array.isArray(detail.path) && detail.path.join('.') === field) return true;
    return detail.instancePath === `/${field}`;
  })).toBe(true);
}

describe('provider endpoints - API key validation', () => {
  it('rejects Anthropic keys that do not use the Anthropic prefix', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: {
        name: 'Claude',
        provider: 'anthropic',
        apiKey: 'sk-openai-key',
      },
    });

    expect(res.statusCode).toBe(400);
    expectValidationDetail(
      JSON.parse(res.body).details,
      'apiKey',
      'Anthropic API keys must start with "sk-ant-"',
    );
  });

  it('rejects API keys with leading or trailing whitespace', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: {
        name: 'OpenAI',
        provider: 'openai',
        apiKey: ' sk-test',
      },
    });

    expect(res.statusCode).toBe(400);
    expectValidationDetail(
      JSON.parse(res.body).details,
      'apiKey',
      'API key must not include leading or trailing whitespace',
    );
  });

  it('validates snake_case API keys with the selected provider', async () => {
    const app = await buildApp(makeMockDb({
      existingProvider: {
        id: '01PROVIDER',
        provider: 'openai',
        baseUrl: '',
      },
    }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/providers/01PROVIDER',
      payload: {
        provider: 'gemini',
        api_key: 'sk-wrong-provider-key',
      },
    });

    expect(res.statusCode).toBe(400);
    expectValidationDetail(
      JSON.parse(res.body).details,
      'api_key',
      'Gemini API keys must start with "AIza"',
    );
  });

  it('validates key rotation against the existing provider when provider is omitted', async () => {
    const app = await buildApp(makeMockDb({
      existingProvider: {
        id: '01PROVIDER',
        provider: 'openai',
        baseUrl: '',
      },
    }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/providers/01PROVIDER',
      payload: {
        apiKey: 'not-an-openai-key',
      },
    });

    expect(res.statusCode).toBe(400);
    expectValidationDetail(
      JSON.parse(res.body).details,
      'apiKey',
      'OpenAI API keys must start with "sk-"',
    );
  });

  it('allows OpenAI-compatible custom base URLs to use non-OpenAI key formats', async () => {
    const inserted = {
      id: '01PROVIDER',
      workspaceId: '01WORKSPACE',
      name: 'Local OpenAI-compatible',
      provider: 'openai',
      modelName: 'local-model',
      apiKey: 'local-token',
      baseUrl: 'http://localhost:11434/v1',
      isDefault: false,
      isActive: true,
      createdAt: new Date('2026-01-01').toISOString(),
      updatedAt: new Date('2026-01-01').toISOString(),
    };
    const app = await buildApp(makeMockDb({ insertReturns: [inserted] }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: {
        name: 'Local OpenAI-compatible',
        provider: 'openai',
        apiKey: 'local-token',
        base_url: 'http://localhost:11434/v1',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({
      id: '01PROVIDER',
      provider: 'openai',
      api_key: 'local...oken',
    });
  });

  it('uses the existing custom base URL when rotating an OpenAI-compatible key', async () => {
    const updated = {
      id: '01PROVIDER',
      workspaceId: '01WORKSPACE',
      name: 'Local OpenAI-compatible',
      provider: 'openai',
      modelName: 'local-model',
      apiKey: 'local-token',
      baseUrl: 'http://localhost:11434/v1',
      isDefault: false,
      isActive: true,
      createdAt: new Date('2026-01-01').toISOString(),
      updatedAt: new Date('2026-01-02').toISOString(),
    };
    const app = await buildApp(makeMockDb({
      existingProvider: {
        id: '01PROVIDER',
        provider: 'openai',
        baseUrl: 'http://localhost:11434/v1',
      },
      updateReturns: [updated],
    }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/providers/01PROVIDER',
      payload: {
        apiKey: 'local-token',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      id: '01PROVIDER',
      provider: 'openai',
      api_key: 'local...oken',
      base_url: 'http://localhost:11434/v1',
    });
  });

  it('rejects clearing a custom base URL when the existing OpenAI key is not official', async () => {
    const app = await buildApp(makeMockDb({
      existingProvider: {
        id: '01PROVIDER',
        provider: 'openai',
        apiKey: 'local-token',
        baseUrl: 'http://localhost:11434/v1',
      },
    }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/providers/01PROVIDER',
      payload: {
        baseUrl: '',
      },
    });

    expect(res.statusCode).toBe(400);
    expectValidationDetail(
      JSON.parse(res.body).details,
      'api_key',
      'OpenAI API keys must start with "sk-"',
    );
  });

  it('validates the existing key when changing provider', async () => {
    const app = await buildApp(makeMockDb({
      existingProvider: {
        id: '01PROVIDER',
        provider: 'openai',
        apiKey: 'sk-openai-key',
        baseUrl: '',
      },
    }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/providers/01PROVIDER',
      payload: {
        provider: 'anthropic',
      },
    });

    expect(res.statusCode).toBe(400);
    expectValidationDetail(
      JSON.parse(res.body).details,
      'api_key',
      'Anthropic API keys must start with "sk-ant-"',
    );
  });

  it('allows unknown local providers without provider-specific prefixes', async () => {
    const inserted = {
      id: '01LOCAL',
      workspaceId: '01WORKSPACE',
      name: 'Local',
      provider: 'local',
      modelName: 'local-model',
      apiKey: 'local-token',
      baseUrl: '',
      isDefault: false,
      isActive: true,
      createdAt: new Date('2026-01-01').toISOString(),
      updatedAt: new Date('2026-01-01').toISOString(),
    };
    const app = await buildApp(makeMockDb({ insertReturns: [inserted] }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: {
        name: 'Local',
        provider: 'local',
        apiKey: 'local-token',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({
      id: '01LOCAL',
      provider: 'local',
    });
  });

  it('does not treat a blank base URL as a custom provider endpoint', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/providers',
      payload: {
        name: 'OpenAI',
        provider: 'openai',
        apiKey: 'not-an-openai-key',
        baseUrl: '   ',
      },
    });

    expect(res.statusCode).toBe(400);
    expectValidationDetail(
      JSON.parse(res.body).details,
      'apiKey',
      'OpenAI API keys must start with "sk-"',
    );
  });
});
