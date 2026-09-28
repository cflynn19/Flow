import type { Execution, ExecutionDetail, ExecutionEvent } from '@flow/shared';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../app.ts';
import { db } from '../db/client.ts';
import { executionEvents, executions, nodeExecutions, workflows } from '../db/schema.ts';
import { executionBus } from '../engine/bus.ts';
import { serializeEvent, serializeExecution, serializeNodeExecution } from '../lib/serialize.ts';
import { parse } from '../lib/validate.ts';
import { idParamSchema, loadOwnedExecution } from './helpers.ts';

const listQuerySchema = z.object({
  workflowId: z.uuid().optional(),
  status: z.enum(['pending', 'running', 'success', 'failed', 'canceled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

const streamQuerySchema = z.object({ since: z.coerce.number().int().min(0).optional() });

/**
 * Heartbeat interval. This is a named `ping` event rather than an SSE comment: comments
 * keep proxies from timing the stream out, but they are invisible to JavaScript, so a
 * socket that is open-but-dead looks identical to a healthy one from the client's side.
 */
const HEARTBEAT_MS = 5_000;

export async function registerExecutionRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const user = requireUser(request);
    const query = parse(listQuerySchema, request.query);

    const filters = [eq(executions.userId, user.id)];
    if (query.workflowId) filters.push(eq(executions.workflowId, query.workflowId));
    if (query.status) filters.push(eq(executions.status, query.status));

    const rows = await db
      .select({ execution: executions, workflowName: workflows.name })
      .from(executions)
      .innerJoin(workflows, eq(executions.workflowId, workflows.id))
      .where(and(...filters))
      .orderBy(desc(executions.startedAt))
      .limit(query.limit)
      .offset(query.offset);

    const [count] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(executions)
      .where(and(...filters));

    return {
      executions: rows.map((r) => serializeExecution(r.execution, r.workflowName)) satisfies Execution[],
      total: count?.total ?? 0,
    };
  });

  app.get('/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParamSchema, request.params);
    const { execution, workflowName } = await loadOwnedExecution(id, user.id);

    const nodeRows = await db
      .select()
      .from(nodeExecutions)
      .where(eq(nodeExecutions.executionId, id))
      .orderBy(asc(nodeExecutions.startedAt));

    const detail: ExecutionDetail = {
      ...serializeExecution(execution, workflowName),
      definitionSnapshot: execution.definitionSnapshot,
      nodeExecutions: nodeRows.map(serializeNodeExecution),
    };
    return { execution: detail };
  });

  app.get('/:id/events', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParamSchema, request.params);
    await loadOwnedExecution(id, user.id);

    const rows = await db
      .select()
      .from(executionEvents)
      .where(eq(executionEvents.executionId, id))
      .orderBy(asc(executionEvents.seq));

    return { events: rows.map(serializeEvent) satisfies ExecutionEvent[] };
  });

  /**
   * Live execution stream. A client always replays from `since` (or Last-Event-ID) before
   * attaching to the live bus, so reconnecting mid-run produces exactly the same sequence
   * it would have received had the connection never dropped.
   */
  app.get('/:id/stream', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParamSchema, request.params);
    const query = parse(streamQuerySchema, request.query);
    await loadOwnedExecution(id, user.id);

    const lastEventId = Number(request.headers['last-event-id']);
    const since = Number.isFinite(lastEventId) ? lastEventId : (query.since ?? 0);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');

    let highestSeq = since;
    let closed = false;
    const buffered: ExecutionEvent[] = [];
    let replaying = true;

    const write = (event: ExecutionEvent) => {
      if (closed) return;
      highestSeq = Math.max(highestSeq, event.seq);
      reply.raw.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'workflow.completed' || event.type === 'workflow.failed') close();
    };

    // Attach to the bus first and buffer, so events produced *during* the replay query
    // are not lost in the gap between the two.
    const unsubscribe = executionBus.subscribe(id, (event) => {
      if (replaying) buffered.push(event);
      else if (event.seq > highestSeq) write(event);
    });

    // No `id:` on the heartbeat -- it must not move the client's Last-Event-ID.
    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(`event: ping\ndata: {"ts":"${new Date().toISOString()}"}\n\n`);
    }, HEARTBEAT_MS);

    function close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    }

    request.raw.on('close', close);

    try {
      const past = await db
        .select()
        .from(executionEvents)
        .where(and(eq(executionEvents.executionId, id), gt(executionEvents.seq, since)))
        .orderBy(asc(executionEvents.seq));

      for (const row of past) write(serializeEvent(row));

      replaying = false;
      // Sorted defensively: anything at or below the replay watermark is a duplicate.
      for (const event of buffered.sort((a, b) => a.seq - b.seq)) {
        if (event.seq > highestSeq) write(event);
      }

      // Nothing more is coming for a run that already finished.
      if (!executionBus.isLive(id)) {
        const [row] = await db
          .select({ status: executions.status })
          .from(executions)
          .where(eq(executions.id, id))
          .limit(1);
        if (row && row.status !== 'running' && row.status !== 'pending') close();
      }
    } catch (error) {
      request.log.error({ err: error }, 'Failed to replay execution events');
      close();
    }

    return reply;
  });
}
