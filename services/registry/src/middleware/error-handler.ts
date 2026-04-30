import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { redactSecrets } from '@urule/events';

export interface UruleError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  request.log.error(
    {
      err: {
        name: error.name,
        code: error.code,
        statusCode: error.statusCode,
        message: redactSecrets(error.message ?? ''),
        stack: error.stack ? redactSecrets(error.stack) : undefined,
      },
      requestId: request.id,
    },
    'Request error',
  );

  const statusCode = error.statusCode ?? 500;
  const response: UruleError = {
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: redactSecrets(error.message ?? 'Internal Server Error'),
      requestId: request.id,
    },
  };

  reply.status(statusCode).send(response);
}
