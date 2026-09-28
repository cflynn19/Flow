import {
  EMPTY_DEFINITION,
  createWorkflowInputSchema,
  executeWorkflowInputSchema,
  updateWorkflowInputSchema,
  type ExecutionStatus,
  type WorkflowSummary,
} from '@flow/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../app.ts';
import { db } from '../db/client.ts';
import { executions, workflows } from '../db/schema.ts';
import { startExecution } from '../engine/runner.ts';
import { notFound } from '../lib/errors.ts';
import { serializeWorkflow } from '../lib/serialize.ts';
import { parse } from '../lib/validate.ts';
import { idParamSchema, loadOwnedWorkflow } from './helpers.ts';

export async function registerWorkflowRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const user = requireUser(request);

    const rows = await db
      .select()
      .from(workflows)
      .where(eq(workflows.userId, user.id))
      .orderBy(desc(workflows.updatedAt));

    if (rows.length === 0) return { workflows: [] satisfies WorkflowSummary[] };

    // One aggregate pass and one "latest run per workflow" pass, rather than N+1.
    const counts = await db
      .select({ workflowId: executions.workflowId, count: sql<number>`count(*)::int` })
      .from(executions)
      .where(eq(executions.userId, user.id))
      .groupBy(executions.workflowId);

    const latestRows = await db.execute<{
      workflow_id: string;
      id: string;
      seq: number;
      status: ExecutionStatus;
      started_at: string;
      duration_ms: number | null;
    }>(sql`
      select distinct on (workflow_id) workflow_id, id, seq, status, started_at, duration_ms
      from executions
      where user_id = ${user.id}
      order by workflow_id, started_at desc
    `);

    const countByWorkflow = new Map(counts.map((c) => [c.workflowId, c.count]));
    const latestByWorkflow = new Map(latestRows.rows.map((r) => [r.workflow_id, r]));

    const summaries: WorkflowSummary[] = rows.map((row) => {
      const last = latestByWorkflow.get(row.id);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        nodeCount: row.definition.nodes.length,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        executionCount: countByWorkflow.get(row.id) ?? 0,
        lastExecution: last
          ? {
              id: last.id,
              seq: last.seq,
              status: last.status,
              startedAt: new Date(last.started_at).toISOString(),
              durationMs: last.duration_ms,
            }
          : null,
      };
    });

    return { workflows: summaries };
  });

  app.post('/', async (request, reply) => {
    const user = requireUser(request);
    const input = parse(createWorkflowInputSchema, request.body);

    const [row] = await db
      .insert(workflows)
      .values({
        userId: user.id,
        name: input.name,
        description: input.description ?? null,
        definition: input.definition ?? EMPTY_DEFINITION,
      })
      .returning();
    if (!row) throw notFound('Workflow');

    return reply.status(201).send({ workflow: serializeWorkflow(row) });
  });

  app.get('/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParamSchema, request.params);
    return { workflow: serializeWorkflow(await loadOwnedWorkflow(id, user.id)) };
  });

  app.put('/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParamSchema, request.params);
    const input = parse(updateWorkflowInputSchema, request.body);
    await loadOwnedWorkflow(id, user.id);

    const [row] = await db
      .update(workflows)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.definition !== undefined ? { definition: input.definition } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(workflows.id, id), eq(workflows.userId, user.id)))
      .returning();
    if (!row) throw notFound('Workflow');

    return { workflow: serializeWorkflow(row) };
  });

  app.delete('/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParamSchema, request.params);
    await loadOwnedWorkflow(id, user.id);
    await db.delete(workflows).where(and(eq(workflows.id, id), eq(workflows.userId, user.id)));
    return reply.status(204).send();
  });

  app.post('/:id/execute', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParamSchema, request.params);
    const input = parse(executeWorkflowInputSchema, request.body ?? {});
    const workflow = await loadOwnedWorkflow(id, user.id);

    // Returns as soon as the execution row exists so the client can subscribe to the
    // event stream immediately; the run itself continues in the background.
    const execution = await startExecution({
      workflow,
      userId: user.id,
      input: input.input ?? null,
      seed: input.seed,
    });

    return reply.status(202).send({ execution });
  });
}
