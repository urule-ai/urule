import fp from 'fastify-plugin';
import { ulid } from 'ulid';
import type { FastifyInstance } from 'fastify';
import { correlationStorage } from './storage.js';

export const CORRELATION_HEADER = 'x-correlation-id';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

async function correlationIdPluginFn(app: FastifyInstance) {
  app.decorateRequest('correlationId', '');

  app.addHook('onRequest', (request, reply, done) => {
    const incoming = request.headers[CORRELATION_HEADER];
    const id =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 256
        ? incoming
        : ulid();

    request.id = id;
    request.correlationId = id;
    reply.header(CORRELATION_HEADER, id);

    correlationStorage.run({ correlationId: id }, () => done());
  });
}

export const correlationIdPlugin = fp(correlationIdPluginFn, {
  name: '@urule/correlation-id',
  fastify: '5.x',
});
