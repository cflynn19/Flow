import { createHash, randomBytes } from 'node:crypto';
import type { ApiKey } from '@flow/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { db } from '../db/client.ts';
import { apiKeys, users, type ApiKeyRow, type UserRow } from '../db/schema.ts';
import { unauthorized } from './errors.ts';

const KEY_PREFIX = 'flow_';
/** Enough of the key to tell several apart in a list, nowhere near enough to guess it. */
const VISIBLE_PREFIX_LENGTH = KEY_PREFIX.length + 6;

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** The raw key is returned exactly once. Only its hash is ever stored. */
export async function createApiKey(
  userId: string,
  name: string,
): Promise<{ key: string; apiKey: ApiKey }> {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const [row] = await db
    .insert(apiKeys)
    .values({ userId, name, tokenHash: hashKey(key), prefix: key.slice(0, VISIBLE_PREFIX_LENGTH) })
    .returning();
  if (!row) throw new Error('Could not create API key');
  return { key, apiKey: serializeApiKey(row) };
}

export async function resolveApiKey(key: string): Promise<UserRow | null> {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const [row] = await db
    .select({ user: users, keyId: apiKeys.id })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(eq(apiKeys.tokenHash, hashKey(key)))
    .limit(1);
  if (!row) return null;

  // Best effort: a failed bookkeeping write must not reject a valid request.
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.keyId))
    .catch(() => undefined);

  return row.user;
}

/** Throws 401 unless the request carries `Authorization: Bearer <api key>`. */
export async function requireApiKeyUser(request: FastifyRequest): Promise<UserRow> {
  const header = request.headers.authorization ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const user = match?.[1] ? await resolveApiKey(match[1]) : null;
  if (!user) throw unauthorized('A valid API key is required (Authorization: Bearer <key>)');
  return user;
}

export function serializeApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
