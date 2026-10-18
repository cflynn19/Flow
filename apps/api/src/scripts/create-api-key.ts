import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { createApiKey } from '../lib/api-keys.ts';

/**
 * npm run api-key -- <email> [name]
 *
 * Issues an API key for reporting runs from another app. The key is printed once and
 * only its hash is stored, so it cannot be shown again.
 */
const [email, ...nameParts] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run api-key -- <email> [name]');
  process.exit(1);
}

const [user] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
  .limit(1);

if (!user) {
  console.error(`No Flow account for ${email}`);
  await pool.end();
  process.exit(1);
}

const { key, apiKey } = await createApiKey(user.id, nameParts.join(' ') || 'Default');
console.log(`\n  API key "${apiKey.name}" for ${email}:\n\n    ${key}\n\n  Store it now -- it will not be shown again.\n`);
await pool.end();
