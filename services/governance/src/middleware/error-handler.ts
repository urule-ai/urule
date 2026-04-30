import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { redactSecrets } from "@urule/events";

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  request.log.error(
    {
      err: {
        name: error.name,
        code: error.code,
        statusCode: error.statusCode,
        message: redactSecrets(error.message ?? ""),
        stack: error.stack ? redactSecrets(error.stack) : undefined,
      },
      requestId: request.id,
    },
    'Request error',
  );

  const statusCode = error.statusCode ?? 500;

  reply.status(statusCode).send({
    error: {
      message: redactSecrets(error.message ?? "Internal Server Error"),
      code: error.code ?? "INTERNAL_ERROR",
      statusCode,
    },
  });
}
