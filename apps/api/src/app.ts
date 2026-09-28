import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { ApiError } from '@flow/shared';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import { ZodError } from 'zod';
import { env, isProduction } from './env.ts';
import { SESSION_COOKIE, resolveSession } from './lib/auth.ts';
import { AppError, unauthorized } from './lib/errors.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerExecutionRoutes } from './routes/executions.ts';
import { registerStatsRoutes } from './routes/stats.ts';
import { registerWorkflowRoutes } from './routes/workflows.ts';
import './types.ts';

/** Throws 401 unless the request carries a live session. */
export function requireUser(request: FastifyRequest) {
  if (!request.user) throw unauthorized();
  return request.user;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: isProduction ? 'info' : 'warn' },
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    request.user = await resolveSession(request.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      const body: ApiError = {
        error: { code: error.code, message: error.message, details: error.details },
      };
      return reply.status(error.statusCode).send(body);
    }

    if (error instanceof ZodError) {
      const body: ApiError = {
        error: {
          code: 'unprocessable_entity',
          message: 'Request validation failed',
          details: error.issues.map((i) => ({
            path: i.path.join('.') || '(root)',
            message: i.message,
          })),
        },
      };
      return reply.status(422).send(body);
    }

    // Anything that reaches here is a Fastify-level or genuinely unexpected error.
    const unexpected = error as FastifyError;
    const statusCode = unexpected.statusCode ?? 500;
    if (statusCode >= 500) request.log.error({ err: unexpected }, 'Unhandled error');

    const body: ApiError = {
      error: {
        code: statusCode >= 500 ? 'internal_error' : 'bad_request',
        message:
          statusCode >= 500 && isProduction ? 'Something went wrong' : unexpected.message,
      },
    };
    return reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ApiError = { error: { code: 'not_found', message: 'Route not found' } };
    return reply.status(404).send(body);
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(registerAuthRoutes, { prefix: '/auth' });
  await app.register(registerWorkflowRoutes, { prefix: '/workflows' });
  await app.register(registerExecutionRoutes, { prefix: '/executions' });
  await app.register(registerStatsRoutes, { prefix: '/stats' });

  return app;
}
