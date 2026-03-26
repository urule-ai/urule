import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  request.log.error({ err: error, requestId: request.id }, 'Request error');

  const statusCode = error.statusCode ?? 500;

  reply.status(statusCode).send({
    error: {
      message: error.message,
      code: error.code ?? "INTERNAL_ERROR",
      statusCode,
    },
  });
}
