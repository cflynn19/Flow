import { buildApp } from './app.ts';
import { pool } from './db/client.ts';
import { env } from './env.ts';
import { expireIdleExternalRuns } from './engine/ingest.ts';
import { reconcileInterruptedExecutions } from './engine/runner.ts';
import { pruneExpiredSessions } from './lib/auth.ts';

const app = await buildApp();

await pruneExpiredSessions().catch(() => {
  /* best effort -- never block startup on housekeeping */
});

// Executions run in this process, so a restart orphans anything that was mid-flight.
const interrupted = await reconcileInterruptedExecutions().catch(() => 0);
if (interrupted > 0) {
  console.log(`  ⚠  Marked ${interrupted} interrupted execution(s) as failed`);
}

// Reported runs end when their app says so -- or, if it never does, when they go quiet.
const idleSweep = setInterval(() => {
  expireIdleExternalRuns(env.INGEST_IDLE_TIMEOUT_MS).catch((error) => {
    app.log.error({ err: error }, 'Failed to expire idle reported runs');
  });
}, 60_000);
idleSweep.unref();

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`Flow API listening on http://${env.HOST}:${env.PORT}`);
  console.log(`  ➜  API      http://${env.HOST}:${env.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
