import { createApiKeyInputSchema } from '@flow/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../app.ts';
import { db } from '../db/client.ts';
import { apiKeys } from '../db/schema.ts';
import { createApiKey, serializeApiKey } from '../lib/api-keys.ts';
import { notFound } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { idParamSchema } from './helpers.ts';

export async function registerApiKeyRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const user = requireUser(request);
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id))
      .orderBy(desc(apiKeys.createdAt));
    return { apiKeys: rows.map(serializeApiKey) };
  });

  /** The only response that ever contains the key itself. */
  app.post('/', async (request, reply) => {
    const user = requireUser(request);
    const input = parse(createApiKeyInputSchema, request.body);
    const { key, apiKey } = await createApiKey(user.id, input.name);
    return reply.status(201).send({ apiKey, key });
  });

  app.delete('/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParamSchema, request.params);
    const deleted = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
      .returning({ id: apiKeys.id });
    if (deleted.length === 0) throw notFound('API key');
    return reply.status(204).send();
  });
}
