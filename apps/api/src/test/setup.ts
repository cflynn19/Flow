import { config } from 'dotenv';

/**
 * Runs inside every test worker before any module is imported, so `src/env.ts` reads the
 * test database rather than the development one.
 */
config({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error('TEST_DATABASE_URL is not set. Run `createdb flow_test` and add it to .env.');
}

process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
