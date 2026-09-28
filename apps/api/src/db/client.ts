import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.ts';
import * as schema from './schema.ts';

/**
 * `timestamptz` comes back from pg as a JS Date by default, which is what Drizzle
 * expects. `numeric`/`int8` would arrive as strings, but we do not use them.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.NODE_ENV === 'test' ? 4 : 10,
});

export const db = drizzle(pool, { schema, casing: 'snake_case' });
export type Db = typeof db;
export { schema };
