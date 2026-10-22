import { randomUUID } from 'node:crypto';
import {
  INGEST_START_NODE_ID,
  type ExecutionEvent,
  type ExecutionStats,
  type IngestEvent,
  type IngestResult,
  type NodeError,
  type WorkflowDefinition,
} from '@flow/shared';
import { and, eq, inArray, isNotNull, lt, max, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  executionEvents,
  executions,
  ingestEventIds,
  nodeExecutions,
  workflows,
  type ExecutionRow,
  type NodeExecutionRow,
} from '../db/schema.ts';
import { detectAnomalies } from './anomalies.ts';
import { executionBus } from './bus.ts';
import { loadBaseline } from './runner.ts';
import type { NodeExecutionRecord } from './scheduler.ts';
import {
  MAX_ACTIVATIONS_PER_RUN,
  MAX_TRACE_NODES,
  inferParents,
  layout,
  mergeDefinitions,
  startNode,
  stepNode,
  traceEdge,
} from './trace-graph.ts';
import type { DraftEvent } from './types.ts';

/**
 * Turns reported events into a real execution: rows in `executions` and
 * `node_executions`, and the same `execution_events` log the engine writes. Everything
 * downstream -- the SSE stream, the reducer, history, anomalies -- therefore cannot tell
 * a reported run from a simulated one.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Each run is processed one batch at a time. Two requests for the same run could
 * otherwise both read seq N and race to write N+1, or publish out of order -- and an SSE
 * subscriber drops anything at or below the highest seq it has seen, so a late publish is
 * lost until the browser reconnects. The row lock covers the multi-process case; this
 * chain keeps publishes in order within one process.
 */
const chains = new Map<string, Promise<unknown>>();

function serialised<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).then(task);
  const tail = next.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return next;
}

export interface IngestOptions {
  receivedAt?: Date;
  /** Told about each run that could not be recorded, with the underlying error. */
  onRunError?: (error: unknown, run: { runId: string; workflow: string }) => void;
}

/**
 * Applies a batch, one run at a time. Each run commits on its own, so one that cannot be
 * recorded is reported in `errors` without undoing the others. If none could be
 * recorded, the first error is thrown instead -- nothing was saved, and the caller
 * should see a failure it can retry rather than a 202.
 */
export async function ingestEvents(
  userId: string,
  events: IngestEvent[],
  { receivedAt = new Date(), onRunError }: IngestOptions = {},
): Promise<IngestResult> {
  // Order is preserved within a run; runs in one batch are independent of each other.
  // A run is identified by workflow *and* runId, since an app may reuse ids across them.
  const byRun = new Map<string, { workflow: string; runId: string; events: IngestEvent[] }>();
  for (const event of events) {
    const key = runKey(userId, event.workflow, event.runId);
    const group = byRun.get(key) ?? { workflow: event.workflow, runId: event.runId, events: [] };
    group.events.push(event);
    byRun.set(key, group);
  }

  const result: IngestResult = {
    accepted: 0,
    ignored: 0,
    duplicates: 0,
    runs: [],
    errors: [],
    warnings: [],
  };
  const failures: { error: unknown; runId: string; workflow: string }[] = [];
  for (const [key, { workflow, runId, events: runEvents }] of byRun) {
    let outcome: RunOutcome;
    try {
      outcome = await serialised(key, () => applyRunEvents(userId, workflow, runId, runEvents, receivedAt));
    } catch (error) {
      failures.push({ error, runId, workflow });
      result.errors.push({
        runId,
        workflow,
        events: runEvents.length,
        message: 'This run could not be recorded. None of its events in this batch were saved; resend them.',
      });
      continue;
    }
    result.accepted += outcome.accepted;
    result.ignored += outcome.ignored;
    result.duplicates += outcome.duplicates;
    result.warnings.push(...outcome.warnings);
    result.runs.push({ runId, workflow, executionId: outcome.executionId, status: outcome.status });
  }
  if (failures.length > 0 && result.runs.length === 0) throw failures[0]!.error;
  for (const { error, ...run } of failures) onRunError?.(error, run);
  return result;
}

interface RunOutcome {
  executionId: string;
  status: string;
  accepted: number;
  ignored: number;
  duplicates: number;
  warnings: string[];
}

async function applyRunEvents(
  userId: string,
  workflowName: string,
  runId: string,
  events: IngestEvent[],
  receivedAt: Date,
): Promise<RunOutcome> {
  events = inTimeOrder(events);
  const { session, outcome } = await db.transaction(async (tx) => {
    const workflowId = await ensureWorkflow(tx, userId, workflowName);
    let execution = await lockExecution(tx, workflowId, runId);
    let created = false;

    if (!execution) {
      const first = events[0]!;
      const runStarted = events.find((e) => e.type === 'run.started');
      const startedAt = timeOf(runStarted ?? first, receivedAt);

      await tx
        .insert(executions)
        .values({
          workflowId,
          userId,
          status: 'running',
          triggerInput: runStarted?.input ?? null,
          definitionSnapshot: layout({ nodes: [startNode()], edges: [] }),
          startedAt,
          externalId: runId,
          lastEventAt: receivedAt,
        })
        .onConflictDoNothing();
      execution = await lockExecution(tx, workflowId, runId);
      if (!execution) throw new Error(`Could not create execution for run "${runId}"`);
      created = true;
    }

    const fresh = created ? events : await withoutSeenEvents(tx, execution.id, events);
    const unique = dedupeWithinBatch(fresh);

    const session = await RunSession.load(tx, execution, workflowName);
    if (created) session.start();

    let accepted = 0;
    let ignored = 0;
    for (const event of unique) {
      if (session.apply(event, timeOf(event, receivedAt))) accepted += 1;
      else ignored += 1;
    }

    await session.persist(receivedAt);
    await recordEventIds(tx, execution.id, unique);
    return {
      session,
      outcome: {
        executionId: execution.id,
        status: session.status,
        accepted,
        ignored,
        duplicates: events.length - unique.length,
        warnings: session.warnings,
      },
    };
  });

  // Broadcast only once the events are durable, so a replaying client never sees more
  // than the database holds.
  session.publish();
  return outcome;
}

/**
 * Fails reported runs that have gone quiet. An app that crashes mid-run never sends
 * `run.failed`, and without this its run would sit at "running" forever.
 */
export async function expireIdleExternalRuns(idleMs: number, now = new Date()): Promise<number> {
  const stale = await db
    .select({
      userId: executions.userId,
      workflowId: executions.workflowId,
      workflowName: workflows.name,
      externalId: executions.externalId,
    })
    .from(executions)
    .innerJoin(workflows, eq(executions.workflowId, workflows.id))
    .where(
      and(
        eq(executions.status, 'running'),
        isNotNull(executions.externalId),
        lt(executions.lastEventAt, new Date(now.getTime() - idleMs)),
      ),
    );

  const minutes = Math.round(idleMs / 60_000);
  let expired = 0;
  for (const row of stale) {
    const runId = row.externalId!;
    const didExpire = await serialised(runKey(row.userId, row.workflowName, runId), async () => {
      const session = await db.transaction(async (tx) => {
        const execution = await lockExecution(tx, row.workflowId, runId);
        // Re-checked under the lock: an event may have arrived since the scan.
        if (!execution || execution.status !== 'running') return null;
        if (execution.lastEventAt && execution.lastEventAt.getTime() >= now.getTime() - idleMs) {
          return null;
        }
        const session = await RunSession.load(tx, execution, null);
        await session.finish(
          'failed',
          {
            message: `The app stopped reporting this run -- no events for ${minutes} minute${minutes === 1 ? '' : 's'}`,
            code: 'timed_out',
          },
          now,
        );
        await session.persist(execution.lastEventAt ?? now);
        return session;
      });
      session?.publish();
      return session !== null;
    });
    if (didExpire) expired += 1;
  }
  return expired;
}

/* ---------------------------------------------------------------- session ---- */

/**
 * One batch of work against one execution, inside one transaction. It holds the run's
 * node activations in memory, applies events to them, and writes back what changed.
 */
class RunSession {
  status: string;
  readonly warnings: string[] = [];
  private seq: number;
  private definition: WorkflowDefinition;
  private graphChanged = false;
  private capWarned = false;
  private readonly dirty = new Set<string>();
  private readonly pending: ExecutionEvent[] = [];
  private finished: {
    status: 'success' | 'failed';
    completedAt: Date;
    durationMs: number;
    error: NodeError | null;
    stats: ExecutionStats;
    anomalies: ReturnType<typeof detectAnomalies>;
  } | null = null;

  private constructor(
    private readonly tx: Tx,
    private readonly execution: ExecutionRow,
    private readonly workflowName: string,
    private readonly activations: NodeExecutionRow[],
    lastSeq: number,
  ) {
    this.status = execution.status;
    this.seq = lastSeq;
    this.definition = execution.definitionSnapshot;
  }

  static async load(tx: Tx, execution: ExecutionRow, fallbackName: string | null) {
    // Sequential: a transaction is one connection, which runs one query at a time.
    const rows = await tx.select().from(nodeExecutions).where(eq(nodeExecutions.executionId, execution.id));
    const [seqRow] = await tx
      .select({ value: max(executionEvents.seq) })
      .from(executionEvents)
      .where(eq(executionEvents.executionId, execution.id));
    const [workflow] = await tx
      .select({ name: workflows.name })
      .from(workflows)
      .where(eq(workflows.id, execution.workflowId))
      .limit(1);
    rows.sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0));
    return new RunSession(
      tx,
      execution,
      workflow?.name ?? fallbackName ?? 'Reported workflow',
      rows,
      seqRow?.value ?? 0,
    );
  }

  /** The opening events every run gets: `workflow.started`, and the Start node. */
  start() {
    const at = this.execution.startedAt;
    const input = this.execution.triggerInput ?? null;

    this.emit({
      type: 'workflow.started',
      ts: at.toISOString(),
      nodeId: null,
      payload: { workflowId: this.execution.workflowId, workflowName: this.workflowName, triggerInput: input },
    });

    const activation = this.newActivation(INGEST_START_NODE_ID, 'trigger', 'Start', at, input, 0, null);
    activation.status = 'success';
    activation.completedAt = at;
    activation.durationMs = 0;
    activation.output = input;
    activation.attempts = [
      { attempt: 1, startedAt: at.toISOString(), completedAt: at.toISOString(), durationMs: 0, status: 'success' },
    ];
    this.emitStarted(activation, at);
    this.emitNode(activation, at, {
      type: 'node.completed',
      payload: { attempt: 1, durationMs: 0, output: input },
    });
  }

  /** Returns false when the event could not be applied. */
  apply(event: IngestEvent, at: Date): boolean {
    if (this.status !== 'running') return false;

    switch (event.type) {
      case 'run.started':
        // The execution already exists by now -- created by this event or an earlier one.
        return true;
      case 'step.started':
        return this.stepStarted(event.step, event.label ?? event.step, at, {
          input: event.input,
          after: event.after,
          maxAttempts: event.maxAttempts,
        }) !== null;
      case 'step.completed':
        return this.stepCompleted(event.step, at, event.output);
      case 'step.failed':
        return this.stepFailed(event.step, at, event.error, event.willRetry, event.retryInMs);
      case 'run.completed':
        this.queueFinish('success', null, at);
        return true;
      case 'run.failed':
        this.queueFinish('failed', event.error ?? null, at);
        return true;
    }
  }

  private stepStarted(
    step: string,
    label: string,
    at: Date,
    options: { input?: unknown; after?: string[] | undefined; maxAttempts?: number | undefined },
  ): NodeExecutionRow | null {
    const latest = this.latestActivation(step);

    // A start right after "failed, will retry" is the next attempt of the same activation.
    if (latest && awaitingRetry(latest)) {
      latest.attemptCount += 1;
      latest.attemptStartedAt = at;
      latest.maxAttempts = Math.max(latest.maxAttempts, options.maxAttempts ?? 0, latest.attemptCount);
      this.dirty.add(latest.id);
      this.emitStarted(latest, at);
      return latest;
    }

    if (this.activations.length >= MAX_ACTIVATIONS_PER_RUN) {
      if (!this.capWarned) {
        this.warnings.push(
          `Run "${this.execution.externalId}": stopped recording new steps at the ${MAX_ACTIVATIONS_PER_RUN}-step limit`,
        );
        this.capWarned = true;
      }
      return null;
    }

    if (!this.ensureNode(step, label, at, options.after)) return null;

    const parent = this.parentActivationFor(step);
    const activation = this.newActivation(
      step,
      'action',
      label,
      at,
      options.input ?? null,
      (parent?.branchDepth ?? 0) + 1,
      parent?.id ?? null,
    );
    activation.maxAttempts = Math.max(1, options.maxAttempts ?? 1);
    activation.declaredAfter = options.after?.length ? options.after : null;
    this.emitStarted(activation, at);
    return activation;
  }

  private stepCompleted(step: string, at: Date, output: unknown): boolean {
    const activation = this.openActivation(step) ?? this.stepStarted(step, step, at, {});
    if (!activation) return false;

    const durationMs = this.closeAttempt(activation, at, 'success');
    activation.status = 'success';
    activation.completedAt = at;
    activation.durationMs = elapsed(activation.startedAt, at);
    activation.output = output ?? null;
    activation.error = null;

    this.emitNode(activation, at, {
      type: 'node.completed',
      payload: { attempt: activation.attemptCount, durationMs, output: output ?? null },
    });
    this.reinferAfterLateFinish(activation, at);
    return true;
  }

  private stepFailed(
    step: string,
    at: Date,
    error: NodeError,
    willRetry: boolean,
    retryInMs: number | undefined,
  ): boolean {
    const activation = this.openActivation(step) ?? this.stepStarted(step, step, at, {});
    if (!activation) return false;

    const durationMs = this.closeAttempt(activation, at, 'failed', error);
    activation.error = error;

    if (willRetry) {
      activation.maxAttempts = Math.max(activation.maxAttempts, activation.attemptCount + 1);
    } else {
      activation.status = 'failed';
      activation.completedAt = at;
      activation.durationMs = elapsed(activation.startedAt, at);
    }

    this.emitNode(activation, at, {
      type: 'node.failed',
      payload: { attempt: activation.attemptCount, durationMs, error, retriesExhausted: !willRetry },
    });
    if (!willRetry) this.reinferAfterLateFinish(activation, at);
    if (willRetry) {
      this.emitNode(activation, at, {
        type: 'node.retrying',
        payload: {
          attempt: activation.attemptCount,
          nextAttempt: activation.attemptCount + 1,
          maxAttempts: activation.maxAttempts,
          delayMs: retryInMs ?? 0,
          error,
        },
      });
    }
    return true;
  }

  /**
   * Run-level terminal events are finished in `persist`, because computing anomalies
   * needs the database. Anything after them in the same batch is ignored, just as it
   * would be in a later batch.
   */
  private finishRequest: { status: 'success' | 'failed'; error: NodeError | null; at: Date } | null = null;

  private queueFinish(status: 'success' | 'failed', error: NodeError | null, at: Date) {
    this.finishRequest = { status, error, at };
    this.status = status;
  }

  async finish(status: 'success' | 'failed', error: NodeError | null, at: Date) {
    // A step still running when its run ends never reported back -- that is worth seeing.
    for (const activation of this.activations) {
      if (activation.status !== 'running' || awaitingRetry(activation)) continue;
      const unfinished: NodeError = {
        message: 'The run ended before this step reported a result',
        code: 'step_unfinished',
      };
      const durationMs = this.closeAttempt(activation, at, 'failed', unfinished);
      activation.status = 'failed';
      activation.error = unfinished;
      activation.completedAt = at;
      activation.durationMs = elapsed(activation.startedAt, at);
      this.emitNode(activation, at, {
        type: 'node.failed',
        payload: { attempt: activation.attemptCount, durationMs, error: unfinished, retriesExhausted: true },
      });
    }

    /*
     * "Will retry" followed by the end of the run means that failure was the last one.
     * The event re-reports that attempt as final -- the UI is driven by events, so
     * without it the node would show "retrying" forever. It carries the attempt's own
     * time and number, so the reducer replaces the attempt rather than adding one.
     */
    for (const activation of this.activations) {
      if (!awaitingRetry(activation)) continue;
      const last = activation.attempts.at(-1)!;
      const endedAt = new Date(last.completedAt);
      activation.status = 'failed';
      activation.completedAt = endedAt;
      activation.durationMs = elapsed(activation.startedAt, endedAt);
      activation.maxAttempts = activation.attemptCount;
      this.dirty.add(activation.id);
      this.emitNode(activation, endedAt, {
        type: 'node.failed',
        payload: {
          attempt: last.attempt,
          durationMs: last.durationMs,
          error: last.error ?? activation.error ?? { message: 'Step failed' },
          retriesExhausted: true,
        },
      });
    }

    const terminalError =
      status === 'failed'
        ? (error ??
          this.activations.find((a) => a.status === 'failed')?.error ?? {
            message: 'The app reported that this run failed',
            code: 'run_failed',
          })
        : null;

    const completedAt = at.getTime() < this.execution.startedAt.getTime() ? this.execution.startedAt : at;
    const durationMs = elapsed(this.execution.startedAt, completedAt);
    const stats = this.stats(durationMs);
    const records = this.activations.map(toRecord);
    const anomalies = detectAnomalies({
      definition: this.definition,
      records,
      stats,
      totalDurationMs: durationMs,
      capReached: this.activations.length >= MAX_ACTIVATIONS_PER_RUN,
      deadlockedNodes: [],
      baseline: await loadBaseline(this.execution.workflowId, this.execution.id),
    });

    this.status = status;
    this.finished = { status, completedAt, durationMs, error: terminalError, stats, anomalies };
    this.emit({
      type: status === 'success' ? 'workflow.completed' : 'workflow.failed',
      ts: completedAt.toISOString(),
      nodeId: null,
      payload: { status, durationMs, stats, anomalies, error: terminalError },
    });
  }

  async persist(lastEventAt: Date) {
    if (this.finishRequest && !this.finished) {
      const { status, error, at } = this.finishRequest;
      await this.finish(status, error, at);
    }

    const tx = this.tx;
    const changed = this.activations.filter((a) => this.dirty.has(a.id));
    if (changed.length > 0) {
      await tx
        .insert(nodeExecutions)
        .values(changed)
        .onConflictDoUpdate({
          target: nodeExecutions.id,
          set: {
            status: sqlExcluded('status'),
            attemptCount: sqlExcluded('attempt_count'),
            maxAttempts: sqlExcluded('max_attempts'),
            attempts: sqlExcluded('attempts'),
            completedAt: sqlExcluded('completed_at'),
            durationMs: sqlExcluded('duration_ms'),
            output: sqlExcluded('output'),
            error: sqlExcluded('error'),
            attemptStartedAt: sqlExcluded('attempt_started_at'),
            parentNodeExecutionId: sqlExcluded('parent_node_execution_id'),
            branchDepth: sqlExcluded('branch_depth'),
          },
        });
    }

    if (this.pending.length > 0) {
      await tx.insert(executionEvents).values(
        this.pending.map((event) => ({
          executionId: this.execution.id,
          seq: event.seq,
          nodeId: event.nodeId,
          type: event.type,
          ts: new Date(event.ts),
          payload: event,
        })),
      );
    }

    if (this.graphChanged) this.definition = layout(this.definition);
    // Only a finished run's graph is final: until then a late event can still move an
    // edge, and an edge merged into the workflow early would stay there for good.
    if (this.finished) await this.mergeIntoWorkflow();

    await tx
      .update(executions)
      .set({
        lastEventAt,
        ...(this.graphChanged ? { definitionSnapshot: this.definition } : {}),
        ...(this.finished
          ? {
              status: this.finished.status,
              completedAt: this.finished.completedAt,
              durationMs: this.finished.durationMs,
              error: this.finished.error,
              stats: this.finished.stats,
              anomalies: this.finished.anomalies,
            }
          : {}),
      })
      .where(eq(executions.id, this.execution.id));
  }

  publish() {
    for (const event of this.pending) executionBus.publish(this.execution.id, event);
  }

  /* --------------------------------------------------------------- graph ---- */

  private ensureNode(step: string, label: string, at: Date, after: string[] | undefined): boolean {
    // Edges are only drawn when a step first appears. A later activation of the same
    // step is a loop or a repeat, and re-inferring would add an edge back to itself.
    if (this.definition.nodes.some((n) => n.id === step)) return true;

    if (this.definition.nodes.length >= MAX_TRACE_NODES) {
      this.warnings.push(
        `Run "${this.execution.externalId}": step "${step}" ignored -- a workflow can have at most ${MAX_TRACE_NODES} steps`,
      );
      return false;
    }

    const known = new Set(this.definition.nodes.map((n) => n.id));
    const explicit = (after ?? []).filter((id) => known.has(id));
    const parents =
      explicit.length > 0
        ? explicit
        : inferParents(this.timeline(), at.getTime());

    this.definition = {
      nodes: [...this.definition.nodes, stepNode(step, label)],
      edges: [...this.definition.edges, ...parents.map((parent) => traceEdge(parent, step))],
    };
    this.graphChanged = true;
    return true;
  }

  /**
   * Corrects the graph when a step's result arrives after a step that started later.
   *
   * Parents are inferred when a step first appears, from what is known then. If the app
   * reports concurrently, B's start can arrive before A's finish even though A finished
   * first, and B gets hung off the wrong parent. Once A's finish arrives, every step that
   * started after it is inferred again with the full picture. Events that arrive in
   * order never get here: no step can have started after a finish that is still news.
   */
  private reinferAfterLateFinish(finished: NodeExecutionRow, at: Date) {
    const finishedAt = at.getTime();
    const firstStarts = new Map<string, NodeExecutionRow>();
    for (const activation of this.activations) {
      if (!firstStarts.has(activation.nodeId)) firstStarts.set(activation.nodeId, activation);
    }

    const later = [...firstStarts.values()]
      .filter(
        (a) =>
          a.nodeId !== finished.nodeId &&
          a.nodeId !== INGEST_START_NODE_ID &&
          (a.startedAt?.getTime() ?? 0) > finishedAt,
      )
      .sort((a, b) => a.startedAt!.getTime() - b.startedAt!.getTime());
    if (later.length === 0) return;

    const nodeIds = new Set(this.definition.nodes.map((n) => n.id));
    const timeline = this.timeline();
    for (const first of later) {
      const step = first.nodeId;
      if (!nodeIds.has(step)) continue;
      // Dependencies the app declared do not depend on timing.
      if ((first.declaredAfter ?? []).some((id) => id !== step && nodeIds.has(id))) continue;

      const current = this.definition.edges.filter((e) => e.target === step).map((e) => e.source);
      const parents = inferParents(timeline, first.startedAt!.getTime(), new Set(current));
      if (parents.length === current.length && parents.every((p) => current.includes(p))) continue;

      this.definition = {
        nodes: this.definition.nodes,
        edges: [
          ...this.definition.edges.filter((e) => e.target !== step),
          ...parents.map((parent) => traceEdge(parent, step)),
        ],
      };
      this.graphChanged = true;

      const parent = this.latestActivation(parents[0]!);
      first.parentNodeExecutionId = parent?.id ?? null;
      first.branchDepth = (parent?.branchDepth ?? 0) + 1;
      this.dirty.add(first.id);
    }
  }

  /** Every activation's span, as inference sees it: a running step has not finished. */
  private timeline() {
    return this.activations.map((a) => ({
      nodeId: a.nodeId,
      startedAt: a.startedAt?.getTime() ?? 0,
      completedAt: a.status === 'running' ? null : (a.completedAt?.getTime() ?? null),
    }));
  }

  /**
   * The workflow's own graph is the union of every finished run of it, so the editor
   * shows each path the app has taken. Locked, because concurrent runs extend it at once.
   */
  private async mergeIntoWorkflow() {
    const [workflow] = await this.tx
      .select({ definition: workflows.definition })
      .from(workflows)
      .where(eq(workflows.id, this.execution.workflowId))
      .for('update');
    if (!workflow) return;

    await this.tx
      .update(workflows)
      .set({ definition: layout(mergeDefinitions(workflow.definition, this.definition)), updatedAt: new Date() })
      .where(eq(workflows.id, this.execution.workflowId));
  }

  /* --------------------------------------------------------- activations ---- */

  private latestActivation(step: string): NodeExecutionRow | undefined {
    return this.activations.findLast((a) => a.nodeId === step);
  }

  /** Oldest activation of the step still awaiting a result -- results match FIFO. */
  private openActivation(step: string): NodeExecutionRow | undefined {
    return this.activations.find((a) => a.nodeId === step && a.status === 'running' && !awaitingRetry(a));
  }

  private parentActivationFor(step: string): NodeExecutionRow | undefined {
    const parentId = this.definition.edges.find((e) => e.target === step)?.source;
    return parentId ? this.latestActivation(parentId) : undefined;
  }

  private newActivation(
    nodeId: string,
    nodeKind: 'trigger' | 'action',
    label: string,
    at: Date,
    input: unknown,
    branchDepth: number,
    parentNodeExecutionId: string | null,
  ): NodeExecutionRow {
    const activation: NodeExecutionRow = {
      id: randomUUID(),
      executionId: this.execution.id,
      nodeId,
      nodeKind,
      label,
      status: 'running',
      attemptCount: 1,
      maxAttempts: 1,
      attempts: [],
      startedAt: at,
      completedAt: null,
      durationMs: null,
      input,
      output: null,
      error: null,
      parentNodeExecutionId,
      branchDepth,
      activationIndex: this.activations.filter((a) => a.nodeId === nodeId).length,
      toolCalls: 0,
      attemptStartedAt: at,
      declaredAfter: null,
    };
    this.activations.push(activation);
    this.dirty.add(activation.id);
    return activation;
  }

  /** Records the attempt in flight as finished and returns how long it took. */
  private closeAttempt(
    activation: NodeExecutionRow,
    at: Date,
    status: 'success' | 'failed',
    error?: NodeError,
  ): number {
    const startedAt = activation.attemptStartedAt ?? activation.startedAt ?? at;
    const durationMs = elapsed(startedAt, at);
    activation.attempts = [
      ...activation.attempts,
      {
        attempt: activation.attemptCount,
        startedAt: startedAt.toISOString(),
        completedAt: at.toISOString(),
        durationMs,
        status,
        ...(error ? { error } : {}),
      },
    ];
    this.dirty.add(activation.id);
    return durationMs;
  }

  private stats(totalDurationMs: number): ExecutionStats {
    const ran = this.activations.filter((a) => a.status !== 'skipped');
    const counts = new Map<string, number>();
    for (const a of ran) counts.set(a.nodeId, (counts.get(a.nodeId) ?? 0) + 1);

    return {
      nodeCount: this.definition.nodes.length,
      nodeExecutionCount: this.activations.length,
      successCount: this.activations.filter((a) => a.status === 'success').length,
      failureCount: this.activations.filter((a) => a.status === 'failed').length,
      skippedCount: this.activations.filter((a) => a.status === 'skipped').length,
      totalRetries: this.activations.reduce((sum, a) => sum + Math.max(0, a.attemptCount - 1), 0),
      toolCalls: 0,
      maxBranchDepth: Math.max(0, ...this.activations.map((a) => a.branchDepth)),
      peakParallelism: peakParallelism(this.activations),
      repeatedNodes: Object.fromEntries([...counts].filter(([, count]) => count > 1)),
      totalDurationMs,
    };
  }

  /* -------------------------------------------------------------- events ---- */

  private emit(draft: DraftEvent) {
    this.seq += 1;
    this.pending.push({ ...draft, executionId: this.execution.id, seq: this.seq } as ExecutionEvent);
  }

  private emitStarted(activation: NodeExecutionRow, at: Date) {
    this.emitNode(activation, at, {
      type: 'node.started',
      payload: {
        attempt: activation.attemptCount,
        maxAttempts: activation.maxAttempts,
        input: activation.input,
        branchDepth: activation.branchDepth,
        activationIndex: activation.activationIndex,
      },
    });
  }

  private emitNode(
    activation: NodeExecutionRow,
    at: Date,
    event: Pick<Extract<DraftEvent, { nodeExecutionId: string }>, 'type' | 'payload'>,
  ) {
    this.emit({
      ...event,
      ts: at.toISOString(),
      nodeId: activation.nodeId,
      nodeExecutionId: activation.id,
      label: activation.label,
      nodeKind: activation.nodeKind as 'trigger' | 'action',
    } as DraftEvent);
  }
}

/* ---------------------------------------------------------------- helpers ---- */

/** Per-run serialisation key. Workflow names are unique per user for reported runs. */
function runKey(userId: string, workflow: string, runId: string): string {
  return JSON.stringify([userId, workflow, runId]);
}

async function lockExecution(tx: Tx, workflowId: string, runId: string): Promise<ExecutionRow | null> {
  const [row] = await tx
    .select()
    .from(executions)
    .where(and(eq(executions.workflowId, workflowId), eq(executions.externalId, runId)))
    .for('update');
  return row ?? null;
}

/** Drops events whose `id` this run has already applied -- a resent batch. */
async function withoutSeenEvents(tx: Tx, executionId: string, events: IngestEvent[]): Promise<IngestEvent[]> {
  const ids = events.flatMap((e) => (e.id ? [e.id] : []));
  if (ids.length === 0) return events;
  const seen = await tx
    .select({ eventId: ingestEventIds.eventId })
    .from(ingestEventIds)
    .where(and(eq(ingestEventIds.executionId, executionId), inArray(ingestEventIds.eventId, ids)));
  const seenIds = new Set(seen.map((row) => row.eventId));
  return events.filter((e) => !e.id || !seenIds.has(e.id));
}

/** The same id twice in one batch is the same event, however it got there. */
function dedupeWithinBatch(events: IngestEvent[]): IngestEvent[] {
  const ids = new Set<string>();
  return events.filter((e) => {
    if (!e.id) return true;
    if (ids.has(e.id)) return false;
    ids.add(e.id);
    return true;
  });
}

/**
 * Remembered even when an event was ignored (say, it arrived after the run ended): a
 * resend of it should still count as a duplicate, not as a fresh event to reject again.
 */
async function recordEventIds(tx: Tx, executionId: string, events: IngestEvent[]) {
  const rows = events.flatMap((e) => (e.id ? [{ executionId, eventId: e.id }] : []));
  if (rows.length > 0) await tx.insert(ingestEventIds).values(rows).onConflictDoNothing();
}

async function ensureWorkflow(tx: Tx, userId: string, name: string): Promise<string> {
  await tx
    .insert(workflows)
    .values({
      userId,
      name,
      source: 'external',
      description: 'Reported by an external app',
      definition: layout({ nodes: [startNode()], edges: [] }),
    })
    .onConflictDoNothing();

  const [row] = await tx
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(eq(workflows.userId, userId), eq(workflows.name, name), eq(workflows.source, 'external')))
    .limit(1);
  if (!row) throw new Error(`Could not create workflow "${name}"`);
  return row.id;
}

/** The incoming value in an upsert's `do update`. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

/**
 * A batch whose events all carry a timestamp is applied in timestamp order, so a client
 * that queued events out of order still gets the graph its timings describe. Ties keep
 * the order they were sent in. Without timestamps the send order is all there is.
 */
function inTimeOrder(events: IngestEvent[]): IngestEvent[] {
  if (!events.every((e) => e.ts)) return events;
  return events
    .map((event, index) => ({ event, index, time: Date.parse(event.ts!) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ event }) => event);
}

function timeOf(event: IngestEvent, fallback: Date): Date {
  return event.ts ? new Date(event.ts) : fallback;
}

function elapsed(from: Date | null, to: Date): number {
  if (!from) return 0;
  return Math.max(0, Math.round(to.getTime() - from.getTime()));
}

/** Failed, and the app said it would try again, but the next attempt has not started. */
function awaitingRetry(activation: NodeExecutionRow): boolean {
  const last = activation.attempts.at(-1);
  return (
    activation.status === 'running' &&
    activation.attempts.length === activation.attemptCount &&
    last?.status === 'failed'
  );
}

/** Highest number of attempts that overlapped at one instant; Start is not work. */
function peakParallelism(activations: NodeExecutionRow[]): number {
  const edges: [number, number][] = [];
  for (const a of activations) {
    if (a.nodeId === INGEST_START_NODE_ID) continue;
    for (const attempt of a.attempts) {
      edges.push([new Date(attempt.startedAt).getTime(), 1], [new Date(attempt.completedAt).getTime(), -1]);
    }
  }
  // Ends sort before starts at the same instant: back-to-back steps are not concurrent.
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of edges) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

function toRecord(row: NodeExecutionRow): NodeExecutionRecord {
  return {
    ...row,
    nodeKind: row.nodeKind as NodeExecutionRecord['nodeKind'],
    status: row.status as NodeExecutionRecord['status'],
    input: (row.input as Record<string, unknown> | null) ?? null,
    output: (row.output as Record<string, unknown> | null) ?? null,
  };
}
