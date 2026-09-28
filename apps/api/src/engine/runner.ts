import type { Execution, ExecutionEvent, ExecutionStats } from '@flow/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  executionEvents,
  executions,
  nodeExecutions,
  type WorkflowRow,
} from '../db/schema.ts';
import { unprocessable } from '../lib/errors.ts';
import { serializeExecution } from '../lib/serialize.ts';
import { EMPTY_BASELINE, detectAnomalies, type Baseline } from './anomalies.ts';
import { executionBus } from './bus.ts';
import { randomSeed } from './rng.ts';
import { runGraph, type NodeExecutionRecord } from './scheduler.ts';
import type { DraftEvent } from './types.ts';

/** Runs the engine keeps in memory so tests (and shutdown) can await them. */
const inFlight = new Map<string, Promise<void>>();

export function waitForExecution(executionId: string): Promise<void> {
  return inFlight.get(executionId) ?? Promise.resolve();
}

export function activeExecutionCount(): number {
  return inFlight.size;
}

export interface StartExecutionOptions {
  workflow: WorkflowRow;
  userId: string;
  input: Record<string, unknown> | null;
  seed?: number | undefined;
  /** Test hook: makes simulated durations instantaneous. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Creates the execution row, emits `workflow.started`, and hands the graph to the engine
 * in the background. It resolves as soon as the row exists so the client can subscribe to
 * the event stream before any node has run.
 */
export async function startExecution(options: StartExecutionOptions): Promise<Execution> {
  const { workflow, userId, input } = options;
  const definition = workflow.definition;

  if (definition.nodes.length === 0) {
    throw unprocessable('This workflow has no nodes to execute');
  }
  const hasRoot = definition.nodes.some(
    (node) => !definition.edges.some((edge) => edge.target === node.id),
  );
  if (!hasRoot) {
    throw unprocessable('This workflow has no starting node -- every node has an incoming edge');
  }

  const startedAt = new Date();
  const [row] = await db
    .insert(executions)
    .values({
      workflowId: workflow.id,
      userId,
      status: 'running',
      triggerInput: input,
      definitionSnapshot: definition,
      startedAt,
    })
    .returning();
  if (!row) throw unprocessable('Could not start execution');

  const executionId = row.id;
  executionBus.markLive(executionId);

  let seq = 0;
  let chain: Promise<void> = Promise.resolve();

  /**
   * Parallel branches emit concurrently, so persistence and broadcast are serialised
   * through one chain. Without it a later event could reach a subscriber before an
   * earlier one, and a client that reconnected would have a hole in its sequence.
   */
  const emit = (draft: DraftEvent): Promise<void> => {
    seq += 1;
    const event = { ...draft, executionId, seq } as ExecutionEvent;

    const task = chain.then(async () => {
      await db.insert(executionEvents).values({
        executionId,
        seq: event.seq,
        nodeId: event.nodeId,
        type: event.type,
        ts: new Date(event.ts),
        payload: event,
      });
      executionBus.publish(executionId, event);
    });

    // A failed write must not wedge every later event behind a rejected promise.
    chain = task.catch(() => undefined);
    return task;
  };

  await emit({
    type: 'workflow.started',
    ts: startedAt.toISOString(),
    nodeId: null,
    payload: {
      workflowId: workflow.id,
      workflowName: workflow.name,
      triggerInput: input,
    },
  });

  const run = executeInBackground({
    executionId,
    workflow,
    startedAt,
    input,
    seed: options.seed ?? randomSeed(),
    sleep: options.sleep,
    emit,
  }).finally(() => {
    inFlight.delete(executionId);
    executionBus.markFinished(executionId);
  });

  inFlight.set(executionId, run);

  return serializeExecution(row, workflow.name);
}

async function executeInBackground(args: {
  executionId: string;
  workflow: WorkflowRow;
  startedAt: Date;
  input: Record<string, unknown> | null;
  seed: number;
  sleep: ((ms: number) => Promise<void>) | undefined;
  emit: (draft: DraftEvent) => Promise<void>;
}): Promise<void> {
  const { executionId, workflow, startedAt, input, seed, sleep, emit } = args;

  try {
    const result = await runGraph({
      definition: workflow.definition,
      triggerInput: input,
      seed,
      emit,
      sleep,
    });

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const stats: ExecutionStats = { ...result.stats, totalDurationMs: durationMs };

    const baseline = await loadBaseline(workflow.id, executionId);
    const anomalies = detectAnomalies({
      definition: workflow.definition,
      records: result.records,
      stats,
      totalDurationMs: durationMs,
      capReached: result.capReached,
      deadlockedNodes: result.deadlockedNodes,
      baseline,
    });

    await persistNodeExecutions(executionId, result.records);

    await db
      .update(executions)
      .set({
        status: result.status,
        completedAt,
        durationMs,
        error: result.error,
        stats,
        anomalies,
      })
      .where(eq(executions.id, executionId));

    await emit({
      type: result.status === 'success' ? 'workflow.completed' : 'workflow.failed',
      ts: completedAt.toISOString(),
      nodeId: null,
      payload: {
        status: result.status,
        durationMs,
        stats,
        anomalies,
        error: result.error,
      },
    });
  } catch (error) {
    // The engine itself failed. Record it rather than leaving the run stuck at "running".
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const message = error instanceof Error ? error.message : String(error);

    await db
      .update(executions)
      .set({
        status: 'failed',
        completedAt,
        durationMs,
        error: { message, code: 'engine_error' },
      })
      .where(eq(executions.id, executionId))
      .catch(() => undefined);

    await emit({
      type: 'workflow.failed',
      ts: completedAt.toISOString(),
      nodeId: null,
      payload: {
        status: 'failed',
        durationMs,
        stats: {
          nodeCount: workflow.definition.nodes.length,
          nodeExecutionCount: 0,
          successCount: 0,
          failureCount: 0,
          skippedCount: 0,
          totalRetries: 0,
          toolCalls: 0,
          maxBranchDepth: 0,
          peakParallelism: 0,
          repeatedNodes: {},
          totalDurationMs: durationMs,
        },
        anomalies: [],
        error: { message, code: 'engine_error' },
      },
    }).catch(() => undefined);
  }
}

async function persistNodeExecutions(executionId: string, records: NodeExecutionRecord[]) {
  if (records.length === 0) return;
  await db.insert(nodeExecutions).values(
    records.map((record) => ({
      id: record.id,
      executionId,
      nodeId: record.nodeId,
      nodeKind: record.nodeKind,
      label: record.label,
      status: record.status,
      attemptCount: record.attemptCount,
      maxAttempts: record.maxAttempts,
      attempts: record.attempts,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      durationMs: record.durationMs,
      input: record.input,
      output: record.output,
      error: record.error,
      parentNodeExecutionId: record.parentNodeExecutionId,
      branchDepth: record.branchDepth,
      activationIndex: record.activationIndex,
      toolCalls: record.toolCalls,
    })),
  );
}

/**
 * Builds the "what does normal look like" picture from this workflow's recent completed
 * runs. Everything the anomaly rules compare against comes from here.
 */
async function loadBaseline(workflowId: string, excludeExecutionId: string): Promise<Baseline> {
  const recent = await db
    .select({ id: executions.id, durationMs: executions.durationMs })
    .from(executions)
    .where(and(eq(executions.workflowId, workflowId), inArray(executions.status, ['success', 'failed'])))
    .orderBy(desc(executions.startedAt))
    .limit(20);

  const usable = recent.filter((r) => r.id !== excludeExecutionId && r.durationMs !== null);
  if (usable.length === 0) return EMPTY_BASELINE;

  const durations = await db
    .select({ nodeId: nodeExecutions.nodeId, durationMs: nodeExecutions.durationMs })
    .from(nodeExecutions)
    .where(inArray(nodeExecutions.executionId, usable.map((r) => r.id)));

  const byNode = new Map<string, number[]>();
  for (const row of durations) {
    if (row.durationMs === null) continue;
    const list = byNode.get(row.nodeId) ?? [];
    list.push(row.durationMs);
    byNode.set(row.nodeId, list);
  }

  const nodeMedianDurationMs: Record<string, number> = {};
  for (const [nodeId, values] of byNode) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    nodeMedianDurationMs[nodeId] =
      values.length % 2 === 0
        ? ((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2
        : (values[mid] ?? 0);
  }

  const total = usable.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);

  return {
    nodeMedianDurationMs,
    workflowAvgDurationMs: total / usable.length,
    sampleSize: usable.length,
  };
}

/** Stats for a run that never got to report its own -- honest zeroes, not guesses. */
function emptyStats(nodeCount: number, durationMs: number): ExecutionStats {
  return {
    nodeCount,
    nodeExecutionCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    totalRetries: 0,
    toolCalls: 0,
    maxBranchDepth: 0,
    peakParallelism: 0,
    repeatedNodes: {},
    totalDurationMs: durationMs,
  };
}

/**
 * Executions live in the API process, so a restart orphans anything mid-flight. Marking
 * them failed at boot keeps the history honest instead of showing a run that never ends.
 *
 * A terminal event is appended as well, because the whole UI derives its state from the
 * event log. Without it the run stays "Running" on screen forever even though the row
 * says failed, and the browser's EventSource reconnects every few seconds for a run that
 * will never produce another event.
 */
export async function reconcileInterruptedExecutions(): Promise<number> {
  const orphans = await db
    .select({
      id: executions.id,
      startedAt: executions.startedAt,
      definitionSnapshot: executions.definitionSnapshot,
    })
    .from(executions)
    .where(eq(executions.status, 'running'));

  if (orphans.length === 0) return 0;

  const completedAt = new Date();
  const error = { message: 'Execution was interrupted by an API restart', code: 'interrupted' };

  for (const orphan of orphans) {
    const durationMs = Math.max(0, completedAt.getTime() - orphan.startedAt.getTime());
    const stats = emptyStats(orphan.definitionSnapshot.nodes.length, durationMs);

    await db
      .update(executions)
      .set({ status: 'failed', completedAt, durationMs, error, stats })
      .where(eq(executions.id, orphan.id));

    const [last] = await db
      .select({ seq: executionEvents.seq })
      .from(executionEvents)
      .where(eq(executionEvents.executionId, orphan.id))
      .orderBy(desc(executionEvents.seq))
      .limit(1);

    const seq = (last?.seq ?? 0) + 1;
    const event: ExecutionEvent = {
      type: 'workflow.failed',
      executionId: orphan.id,
      seq,
      ts: completedAt.toISOString(),
      nodeId: null,
      payload: { status: 'failed', durationMs, stats, anomalies: [], error },
    };

    await db.insert(executionEvents).values({
      executionId: orphan.id,
      seq,
      nodeId: null,
      type: event.type,
      ts: completedAt,
      payload: event,
    });
  }

  return orphans.length;
}
