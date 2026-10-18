#!/usr/bin/env node
/**
 * Reports a run to Flow the way a real app would, step by step as it happens.
 *
 *   FLOW_API_KEY=flow_... node examples/report-run.mjs
 *
 * The work is faked with timers -- it imitates an account-deletion function with a
 * parallel cleanup and a flaky storage call -- but the reporting is exactly what you
 * would put around real code. Open the run in Flow while it is going to watch it live.
 */

const FLOW_URL = process.env.FLOW_URL ?? 'http://localhost:4000';
const API_KEY = process.env.FLOW_API_KEY;
if (!API_KEY) {
  console.error('Set FLOW_API_KEY (create one with: npm run api-key -- <your email>)');
  process.exit(1);
}

/** A minimal reporter: one per run. Reporting failures are logged, never thrown. */
function createRun(workflow, input) {
  const runId = `${workflow}-${Date.now()}`;

  /**
   * Every event carries a unique id, so resending one is harmless: Flow skips ids it has
   * already seen. That is what makes the retry below safe.
   */
  async function send(event, attemptsLeft = 3) {
    const body = JSON.stringify({
      events: [{ id: crypto.randomUUID(), runId, workflow, ts: new Date().toISOString(), ...event }],
    });
    for (let attempt = 1; attempt <= attemptsLeft; attempt += 1) {
      try {
        const response = await fetch(`${FLOW_URL}/ingest/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
          body,
        });
        if (response.ok) return response.json();
        // 4xx means the request itself is wrong; sending it again will not help.
        if (response.status < 500) {
          console.warn(`Flow rejected ${event.type}:`, await response.text());
          return null;
        }
      } catch (error) {
        if (attempt === attemptsLeft) console.warn(`Could not reach Flow for ${event.type}: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
    return null;
  }

  return {
    runId,
    start: () => send({ type: 'run.started', input }),
    /** Runs `fn` as a step, retrying up to `attempts` times, and reports each try. */
    async step(step, fn, { label, attempts = 1 } = {}) {
      for (let attempt = 1; ; attempt += 1) {
        await send({ type: 'step.started', step, label, maxAttempts: attempts });
        try {
          const output = await fn(attempt);
          await send({ type: 'step.completed', step, output });
          return output;
        } catch (error) {
          const willRetry = attempt < attempts;
          await send({
            type: 'step.failed',
            step,
            error: { message: error.message, code: error.code },
            willRetry,
          });
          if (!willRetry) throw error;
        }
      }
    },
    complete: () => send({ type: 'run.completed' }),
    fail: (error) => send({ type: 'run.failed', error: { message: error.message, code: error.code } }),
  };
}

/* ------------------------------------------------------- the fake workload ---- */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const work = (min, max) => wait(min + Math.random() * (max - min));

const run = createRun('deleteAccount', { userId: 'demo-user-42' });
const opened = await run.start();
const executionId = opened?.runs?.[0]?.executionId;
console.log(`Reporting run ${run.runId}`);
if (executionId) console.log(`Watch it: http://localhost:5173/app/executions (newest run)\n`);

try {
  await run.step('prefetch', () => work(300, 500).then(() => ({ friends: 3, partner: true })), {
    label: 'Pre-fetch user state',
  });

  // These three are independent, so the real function runs them with Promise.allSettled.
  await Promise.all([
    run.step('remove-friends', () => work(600, 1200).then(() => ({ removed: 3 })), {
      label: 'Remove from friends',
    }),
    run.step('partner-cleanup', () => work(400, 700), { label: 'Partner cleanup' }),
    run.step('delete-content', () => work(900, 1500).then(() => ({ reviews: 12, comments: 40 })), {
      label: 'Delete reviews & feed',
    }),
  ]);

  await run.step(
    'sweep-storage',
    async (attempt) => {
      await work(300, 600);
      if (attempt === 1) {
        const error = new Error('Storage request timed out');
        error.code = 'storage/retry-limit-exceeded';
        throw error;
      }
      return { filesDeleted: 4 };
    },
    { label: 'Sweep Storage', attempts: 3 },
  );

  await run.step('delete-user', () => work(200, 400), { label: 'Delete user doc' });
  await run.step('delete-auth', () => work(150, 300), { label: 'Delete auth user' });

  await run.complete();
  console.log('Run completed.');
} catch (error) {
  await run.fail(error);
  console.log(`Run failed: ${error.message}`);
}
