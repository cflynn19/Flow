import type { UserRow } from './db/schema.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the session hook in app.ts; null for anonymous requests. */
    user: UserRow | null;
  }
}

export {};
