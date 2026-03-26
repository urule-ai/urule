import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export interface UruleError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  request.log.error({ err: error, requestId: request.id }, 'Request error');

  const statusCode = error.statusCode ?? 500;
  const response: UruleError = {
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: error.message,
      requestId: request.id,
    },
  };

  reply.status(statusCode).send(response);
}
