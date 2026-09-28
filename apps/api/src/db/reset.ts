import { sql } from 'drizzle-orm';
import { db, pool } from './client.ts';

/**
 * Drops every table so `db:migrate` can rebuild from scratch. The `drizzle` schema holds
 * the migration ledger -- leaving it behind would make the migrator think an empty
 * database is already up to date.
 */
await db.execute(sql`drop schema if exists public cascade`);
await db.execute(sql`drop schema if exists drizzle cascade`);
await db.execute(sql`create schema public`);
console.log('Database reset. Run `npm run db:migrate` next.');
await pool.end();
