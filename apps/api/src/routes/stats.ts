import type { DashboardStats } from '@flow/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../app.ts';
import { db } from '../db/client.ts';
import { executions } from '../db/schema.ts';

const ACTIVITY_DAYS = 14;

export async function registerStatsRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const user = requireUser(request);

    const [totals] = await db
      .select({
        workflowCount: sql<number>`(select count(*)::int from workflows w where w.user_id = ${user.id})`,
        executionCount: sql<number>`count(*)::int`,
        successCount: sql<number>`count(*) filter (where ${executions.status} = 'success')::int`,
        failureCount: sql<number>`count(*) filter (where ${executions.status} = 'failed')::int`,
        avgDurationMs: sql<number | null>`avg(${executions.durationMs}) filter (where ${executions.durationMs} is not null)`,
      })
      .from(executions)
      .where(eq(executions.userId, user.id));

    const since = new Date(Date.now() - ACTIVITY_DAYS * 24 * 60 * 60 * 1000);
    const activityRows = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${executions.startedAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        success: sql<number>`count(*) filter (where ${executions.status} = 'success')::int`,
        failed: sql<number>`count(*) filter (where ${executions.status} = 'failed')::int`,
      })
      .from(executions)
      .where(and(eq(executions.userId, user.id), gte(executions.startedAt, since)))
      .groupBy(sql`date_trunc('day', ${executions.startedAt} at time zone 'UTC')`)
      .orderBy(sql`date_trunc('day', ${executions.startedAt} at time zone 'UTC')`);

    // Both sides bucket by UTC day; mixing the server's local day with the UTC keys
    // below would silently drop every bar for anyone not running in UTC.
    // Fill the gaps so the chart has one bar per day, not one per day-with-runs.
    const byDate = new Map(activityRows.map((r) => [r.date, r]));
    const activity: DashboardStats['activity'] = [];
    for (let i = ACTIVITY_DAYS - 1; i >= 0; i -= 1) {
      const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = day.toISOString().slice(0, 10);
      const row = byDate.get(key);
      activity.push({ date: key, success: row?.success ?? 0, failed: row?.failed ?? 0 });
    }

    const finished = (totals?.successCount ?? 0) + (totals?.failureCount ?? 0);
    const stats: DashboardStats = {
      workflowCount: totals?.workflowCount ?? 0,
      executionCount: totals?.executionCount ?? 0,
      successRate: finished > 0 ? (totals?.successCount ?? 0) / finished : null,
      avgDurationMs: totals?.avgDurationMs ? Math.round(Number(totals.avgDurationMs)) : null,
      failureCount: totals?.failureCount ?? 0,
      activity,
    };

    return { stats };
  });
}
