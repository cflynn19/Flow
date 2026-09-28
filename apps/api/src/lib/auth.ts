import { randomBytes } from 'node:crypto';
import type { PublicUser } from '@flow/shared';
import bcrypt from 'bcryptjs';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { sessions, users, type UserRow } from '../db/schema.ts';

export const SESSION_COOKIE = 'flow_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const BCRYPT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<UserRow | null> {
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row?.user ?? null;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, token));
}

/** Opportunistic cleanup so the sessions table does not grow without bound. */
export async function pruneExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

export const sessionCookieOptions = (secure: boolean) =>
  ({
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
