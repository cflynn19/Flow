import { eq, sql } from 'drizzle-orm';
import { db, pool } from './client.ts';
import { startExecution, waitForExecution } from '../engine/runner.ts';
import { hashPassword } from '../lib/auth.ts';
import { executions, nodeExecutions, users, workflows } from './schema.ts';
import { SEED_WORKFLOWS } from './workflows.fixtures.ts';

const DEMO_EMAIL = 'demo@flow.dev';
const DEMO_PASSWORD = 'flowdemo123';

/**
 * Executions are run for real -- the engine produces the timings, retries and branch
 * decisions -- and then shifted back in time so the dashboard opens with a populated
 * history rather than fifteen runs from the same second.
 */
async function backdate(executionId: string, minutesAgo: number) {
  const interval = sql.raw(`interval '${minutesAgo} minutes'`);

  await db.execute(sql`
    update executions
    set started_at = started_at - ${interval}, completed_at = completed_at - ${interval}
    where id = ${executionId}
  `);
  await db.execute(sql`
    update node_executions
    set started_at = started_at - ${interval}, completed_at = completed_at - ${interval}
    where execution_id = ${executionId}
  `);
  await db.execute(sql`update execution_events set ts = ts - ${interval} where execution_id = ${executionId}`);

  // Attempt records carry their own ISO timestamps. Shifting them in TypeScript keeps
  // the inspector's attempt timeline consistent with the rest of the run.
  const shiftMs = minutesAgo * 60_000;
  const rows = await db
    .select({ id: nodeExecutions.id, attempts: nodeExecutions.attempts })
    .from(nodeExecutions)
    .where(eq(nodeExecutions.executionId, executionId));

  for (const row of rows) {
    if (row.attempts.length === 0) continue;
    const shifted = row.attempts.map((attempt) => ({
      ...attempt,
      startedAt: new Date(new Date(attempt.startedAt).getTime() - shiftMs).toISOString(),
      completedAt: new Date(new Date(attempt.completedAt).getTime() - shiftMs).toISOString(),
    }));
    await db.update(nodeExecutions).set({ attempts: shifted }).where(eq(nodeExecutions.id, row.id));
  }
}

async function main() {
  console.log('Seeding Flow…');

  await db.execute(
    sql`truncate table execution_events, node_executions, executions, workflows, sessions, users restart identity cascade`,
  );

  const [user] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      name: 'Demo User',
      passwordHash: await hashPassword(DEMO_PASSWORD),
    })
    .returning();
  if (!user) throw new Error('Could not create the demo user');

  const created: { row: typeof workflows.$inferSelect; seeds: number[] }[] = [];

  for (const seedWorkflow of SEED_WORKFLOWS) {
    const [row] = await db
      .insert(workflows)
      .values({
        userId: user.id,
        name: seedWorkflow.name,
        description: seedWorkflow.description,
        definition: seedWorkflow.definition,
      })
      .returning();
    if (!row) throw new Error(`Could not create workflow ${seedWorkflow.name}`);
    console.log(`  ${seedWorkflow.name} — ${seedWorkflow.definition.nodes.length} nodes`);
    created.push({ row, seeds: [...seedWorkflow.runSeeds] });
  }

  // Interleave the runs round-robin so the history reads like three workflows being used
  // side by side, rather than fifteen runs grouped by workflow.
  const plan: { row: typeof workflows.$inferSelect; seed: number }[] = [];
  for (let round = 0; plan.length < created.reduce((n, c) => n + c.seeds.length, 0); round += 1) {
    for (const entry of created) {
      const seed = entry.seeds[round];
      if (seed !== undefined) plan.push({ row: entry.row, seed });
    }
  }

  const totalRuns = plan.length;
  // Spread across the last ~30 hours, newest last.
  const spacing = Math.floor((60 * 30) / totalRuns);

  for (const [index, { row, seed }] of plan.entries()) {
    const execution = await startExecution({ workflow: row, userId: user.id, input: null, seed });
    await waitForExecution(execution.id);

    const minutesAgo = Math.max(3, (totalRuns - index) * spacing - (seed % 17));
    await backdate(execution.id, minutesAgo);

    process.stdout.write(`\r  ${index + 1}/${totalRuns} executions recorded`);
  }
  process.stdout.write('\n');

  const [summary] = await db
    .select({
      total: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where status = 'success')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
      retries: sql<number>`coalesce(sum((stats->>'totalRetries')::int), 0)::int`,
      anomalies: sql<number>`coalesce(sum(jsonb_array_length(anomalies)), 0)::int`,
    })
    .from(executions);

  console.log(
    `\nDone. ${summary?.total ?? 0} executions — ${summary?.succeeded ?? 0} succeeded, ` +
      `${summary?.failed ?? 0} failed, ${summary?.retries ?? 0} retries, ` +
      `${summary?.anomalies ?? 0} anomalies flagged.`,
  );
  console.log(`\nSign in with  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}\n`);
}

try {
  await main();
} catch (error) {
  console.error('\nSeed failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
