import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';

/**
 * Points the whole test run at TEST_DATABASE_URL and rebuilds its schema once, so specs
 * exercise real Postgres (jsonb, `distinct on`, filtered aggregates) rather than a mock.
 */
export default function setup() {
  config({ path: new URL('../../../../.env', import.meta.url).pathname, quiet: true });

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Run `createdb flow_test` and add it to .env -- see README.',
    );
  }

  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';

  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' };
  const cwd = new URL('../../', import.meta.url).pathname;
  execFileSync('npx', ['tsx', 'src/db/reset.ts'], { cwd, env, stdio: 'pipe' });
  execFileSync('npx', ['tsx', 'src/db/migrate.ts'], { cwd, env, stdio: 'pipe' });
}
