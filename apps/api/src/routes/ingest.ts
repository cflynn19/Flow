import { ingestBatchSchema } from '@flow/shared';
import type { FastifyInstance } from 'fastify';
import { ingestEvents } from '../engine/ingest.ts';
import { requireApiKeyUser } from '../lib/api-keys.ts';
import { parse } from '../lib/validate.ts';

/**
 * Where other apps report their runs. Authenticated by API key rather than session
 * cookie, since the caller is a server, not a browser.
 */
export async function registerIngestRoutes(app: FastifyInstance) {
  app.post('/events', async (request, reply) => {
    const user = await requireApiKeyUser(request);
    const batch = parse(ingestBatchSchema, request.body);
    const result = await ingestEvents(user.id, batch.events, {
      onRunError: (err, run) => request.log.error({ err, ...run }, 'Could not record a reported run'),
    });
    return reply.status(202).send(result);
  });
}
