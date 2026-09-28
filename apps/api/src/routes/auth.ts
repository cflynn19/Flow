import { loginInputSchema, registerInputSchema } from '@flow/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../app.ts';
import { db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { env } from '../env.ts';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  hashPassword,
  sessionCookieOptions,
  toPublicUser,
  verifyPassword,
} from '../lib/auth.ts';
import { conflict, unauthorized } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    const input = parse(registerInputSchema, request.body);

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email))
      .limit(1);
    if (existing) throw conflict('An account with that email already exists');

    const [user] = await db
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
      })
      .returning();
    if (!user) throw conflict('Could not create account');

    const { token } = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(env.COOKIE_SECURE));
    return reply.status(201).send({ user: toPublicUser(user) });
  });

  app.post('/login', async (request, reply) => {
    const input = parse(loginInputSchema, request.body);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email))
      .limit(1);

    // Always run a comparison so a missing account and a wrong password take the
    // same amount of time.
    const placeholder = '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await verifyPassword(input.password, user?.passwordHash ?? placeholder);
    if (!user || !ok) throw unauthorized('Incorrect email or password');

    const { token } = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(env.COOKIE_SECURE));
    return { user: toPublicUser(user) };
  });

  app.post('/logout', async (request, reply) => {
    await destroySession(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', async (request) => ({ user: toPublicUser(requireUser(request)) }));
}
