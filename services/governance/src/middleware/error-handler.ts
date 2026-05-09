import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { redactSecrets } from "@urule/events";

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Zod request-validation failures get the historical `{ error: 'Validation
  // failed', details }` envelope — keeps the type-provider'd response shape
  // identical to the pre-migration `safeParse()` path.
  if (hasZodFastifySchemaValidationErrors(error)) {
    return reply.code(400).send({
      error: 'Validation failed',
      details: error.validation,
    }) as unknown as void;
  }

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
