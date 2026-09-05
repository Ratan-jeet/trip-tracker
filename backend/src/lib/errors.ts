import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../config';

/** An error whose message and status are safe to show the caller. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, code?: string) => new ApiError(400, message, code);
export const unauthorized = (message = 'Unauthorized', code?: string) => new ApiError(401, message, code);
export const forbidden = (message: string, code?: string) => new ApiError(403, message, code);
export const notFound = (message: string, code?: string) => new ApiError(404, message, code);
export const conflict = (message: string, code?: string) => new ApiError(409, message, code);

/**
 * Without this, a `schema.parse()` failure escaped as an unhandled throw and Fastify
 * answered 500 — a validation problem reported as a server fault.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message })),
      });
    }

    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: error.message, code: error.code });
    }

    // Fastify's own errors (body parse failures, rate limit, payload size) carry a status.
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: error.message, code: (error as any).code });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: 'Internal server error',
      // Never leak stack traces or driver messages to a client in production.
      ...(config.isProduction ? {} : { detail: error.message }),
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: `Route ${request.method} ${request.url} not found` });
  });
}
