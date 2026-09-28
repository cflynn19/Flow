import { randomUUID } from 'node:crypto';
import type {
  Attempt,
  ExecutionStats,
  FlowEdge,
  FlowNode,
  NodeError,
  NodeKind,
  NodeStatus,
  WorkflowDefinition,
} from '@flow/shared';
import { handlerFor } from './nodes/index.ts';
import { createRng, randomInt } from './rng.ts';
import { NodeFailure, type Emit, type NodeContext } from './types.ts';

/** What the runner needs in order to persist a node_executions row. */
export interface NodeExecutionRecord {
  id: string;
  nodeId: string;
  nodeKind: NodeKind;
  label: string;
  status: NodeStatus;
  attemptCount: number;
  maxAttempts: number;
  attempts: Attempt[];
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: NodeError | null;
  parentNodeExecutionId: string | null;
  branchDepth: number;
  activationIndex: number;
  toolCalls: number;
}

export interface RunGraphOptions {
  definition: WorkflowDefinition;
  triggerInput: Record<string, unknown> | null;
  seed: number;
  emit: Emit;
  /** Overridden in tests to make simulated durations instantaneous. */
  sleep?: (ms: number) => Promise<void>;
  maxActivations?: number;
  maxActivationsPerNode?: number;
  /**
   * Test hook. Each generator is consumed in a well-defined order -- `failure` exactly
   * once per attempt, `branch` once per conditional -- so a scripted sequence controls
   * exactly one kind of decision without disturbing the others.
   */
  rngs?: Partial<Record<'failure' | 'branch' | 'content', () => number>>;
}

export interface RunGraphResult {
  status: 'success' | 'failed';
  error: NodeError | null;
  output: Record<string, unknown>;
  stats: ExecutionStats;
  records: NodeExecutionRecord[];
  capReached: boolean;
  /** Nodes whose inbound tokens never completed -- a cycle or unreachable join. */
  deadlockedNodes: string[];
}

const DEFAULT_MAX_ACTIVATIONS = 500;
const DEFAULT_MAX_ACTIVATIONS_PER_NODE = 25;

const realSleep = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));

type PruneReason = 'branch-not-taken' | 'upstream-failed' | 'upstream-skipped';

/**
 * A token sits on an edge once its source node has resolved. A node fires when every one
 * of its inbound edges holds a token; the tokens are then consumed, which is what lets a
 * join wait for all of its branches and lets a loop re-arm.
 */
type Token =
  | { kind: 'satisfied'; from: { nodeExecutionId: string; depth: number }; output: Record<string, unknown> }
  | { kind: 'pruned'; reason: PruneReason };

type Pending =
  | { type: 'run'; nodeId: string; input: Record<string, unknown>; parentId: string | null; depth: number }
  | { type: 'skip'; nodeId: string; reason: PruneReason };

function toNodeError(error: unknown): NodeError {
  if (error instanceof NodeFailure) return { message: error.message, code: error.code };
  if (error instanceof Error) return { message: error.message, code: 'node_error' };
  return { message: String(error), code: 'node_error' };
}

/**
 * Executes a workflow graph. Ready nodes are launched together and awaited as a group, so
 * sibling branches genuinely overlap in wall-clock time rather than being interleaved by a
 * topological sort.
 */
export async function runGraph(options: RunGraphOptions): Promise<RunGraphResult> {
  const { definition, triggerInput, seed, emit } = options;
  const sleep = options.sleep ?? realSleep;
  const maxActivations = options.maxActivations ?? DEFAULT_MAX_ACTIVATIONS;
  const maxPerNode = options.maxActivationsPerNode ?? DEFAULT_MAX_ACTIVATIONS_PER_NODE;

  const rngs = {
    failure: options.rngs?.failure ?? createRng(seed),
    branch: options.rngs?.branch ?? createRng((seed ^ 0x9e3779b9) >>> 0),
    content: options.rngs?.content ?? createRng((seed ^ 0x85ebca6b) >>> 0),
  };
  const nodeById = new Map<string, FlowNode>(definition.nodes.map((n) => [n.id, n]));
  const inbound = new Map<string, FlowEdge[]>(definition.nodes.map((n) => [n.id, []]));
  const outbound = new Map<string, FlowEdge[]>(definition.nodes.map((n) => [n.id, []]));
  for (const edge of definition.edges) {
    inbound.get(edge.target)?.push(edge);
    outbound.get(edge.source)?.push(edge);
  }

  const tokens = new Map<string, Token>();
  const records: NodeExecutionRecord[] = [];
  const activationCounts = new Map<string, number>();
  const queue: Pending[] = [];

  let totalActivations = 0;
  let capReached = false;
  let running = 0;
  let peakParallelism = 0;
  let terminalError: NodeError | null = null;
  let totalRetries = 0;
  let toolCalls = 0;
  let maxBranchDepth = 0;
  const finalOutputs: Record<string, unknown>[] = [];

  type Outcome =
    | {
        kind: 'satisfied';
        nodeExecutionId: string;
        depth: number;
        output: Record<string, unknown>;
        branch?: string | undefined;
      }
    | { kind: 'pruned'; reason: PruneReason };

  /** Places tokens on a node's outgoing edges, then queues whatever that made ready. */
  function propagate(nodeId: string, outcome: Outcome) {
    const edges = outbound.get(nodeId) ?? [];

    if (outcome.kind === 'pruned') {
      for (const edge of edges) tokens.set(edge.id, { kind: 'pruned', reason: outcome.reason });
      drainReady();
      return;
    }

    const taken = new Set(
      edges
        .filter((e) => outcome.branch === undefined || (e.sourceHandle ?? 'true') === outcome.branch)
        .map((e) => e.id),
    );
    // Fanning out to more than one branch deepens every child by one.
    const childDepth = taken.size > 1 ? outcome.depth + 1 : outcome.depth;

    for (const edge of edges) {
      tokens.set(
        edge.id,
        taken.has(edge.id)
          ? {
              kind: 'satisfied',
              from: { nodeExecutionId: outcome.nodeExecutionId, depth: childDepth },
              output: outcome.output,
            }
          : { kind: 'pruned', reason: 'branch-not-taken' },
      );
    }
    drainReady();
  }

  /** Consumes complete token sets and turns them into queued activations or skips. */
  function drainReady() {
    for (const node of definition.nodes) {
      const edges = inbound.get(node.id) ?? [];
      if (edges.length === 0) continue;

      if (node.data.config.joinMode === 'any') {
        // Fire once per arriving branch. This is what lets a graph contain a loop --
        // the node does not sit waiting for a back edge that has not been produced yet.
        for (const e of edges) {
          const token = tokens.get(e.id);
          if (!token) continue;
          tokens.delete(e.id);
          if (token.kind !== 'satisfied') continue;
          queue.push({
            type: 'run',
            nodeId: node.id,
            input: token.output,
            parentId: token.from.nodeExecutionId,
            depth: token.from.depth,
          });
        }
        continue;
      }

      if (!edges.every((e) => tokens.has(e.id))) continue;

      const held = edges.map((e) => tokens.get(e.id) as Token);
      for (const e of edges) tokens.delete(e.id);

      const satisfying = held.filter(
        (t): t is Extract<Token, { kind: 'satisfied' }> => t.kind === 'satisfied',
      );

      if (satisfying.length === 0) {
        const pruned = held.filter(
          (t): t is Extract<Token, { kind: 'pruned' }> => t.kind === 'pruned',
        );
        queue.push({
          type: 'skip',
          nodeId: node.id,
          reason: pruned[0]?.reason ?? 'upstream-skipped',
        });
        continue;
      }

      // A join merges its parents' outputs; later parents win on key collisions.
      const input = satisfying.reduce<Record<string, unknown>>(
        (acc, t) => ({ ...acc, ...t.output }),
        {},
      );
      const deepest = satisfying.reduce((a, b) => (a.from.depth >= b.from.depth ? a : b));
      queue.push({
        type: 'run',
        nodeId: node.id,
        input,
        parentId: deepest.from.nodeExecutionId,
        depth: deepest.from.depth,
      });
    }
  }

  function skip(nodeId: string, reason: PruneReason) {
    const node = nodeById.get(nodeId);
    if (!node) return;
    const activationIndex = activationCounts.get(nodeId) ?? 0;
    activationCounts.set(nodeId, activationIndex + 1);

    const record: NodeExecutionRecord = {
      id: randomUUID(),
      nodeId,
      nodeKind: node.type,
      label: node.data.label,
      status: 'skipped',
      attemptCount: 0,
      maxAttempts: node.data.config.simulation.maxRetries + 1,
      attempts: [],
      startedAt: null,
      completedAt: null,
      durationMs: null,
      input: null,
      output: null,
      error: null,
      parentNodeExecutionId: null,
      branchDepth: 0,
      activationIndex,
      toolCalls: 0,
    };
    records.push(record);

    return emit({
      type: 'node.skipped',
      ts: new Date().toISOString(),
      nodeId,
      nodeExecutionId: record.id,
      label: node.data.label,
      nodeKind: node.type,
      payload: { reason },
    }).then(() => {
      propagate(nodeId, { kind: 'pruned', reason: 'upstream-skipped' });
    });
  }

  async function activate(pending: Extract<Pending, { type: 'run' }>) {
    const node = nodeById.get(pending.nodeId);
    if (!node) return;

    const handler = handlerFor(node.type);
    const sim = node.data.config.simulation;
    const maxAttempts = sim.maxRetries + 1;
    const activationIndex = activationCounts.get(node.id) ?? 0;
    activationCounts.set(node.id, activationIndex + 1);
    maxBranchDepth = Math.max(maxBranchDepth, pending.depth);

    const record: NodeExecutionRecord = {
      id: randomUUID(),
      nodeId: node.id,
      nodeKind: node.type,
      label: node.data.label,
      status: 'running',
      attemptCount: 0,
      maxAttempts,
      attempts: [],
      startedAt: new Date(),
      completedAt: null,
      durationMs: null,
      input: pending.input,
      output: null,
      error: null,
      parentNodeExecutionId: pending.parentId,
      branchDepth: pending.depth,
      activationIndex,
      toolCalls: 0,
    };
    records.push(record);

    running += 1;
    peakParallelism = Math.max(peakParallelism, running);

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const ctx: NodeContext = {
          node,
          input: pending.input,
          attempt,
          rng: rngs.content,
          branchRng: rngs.branch,
          sleep,
        };
        record.attemptCount = attempt;

        await emit({
          type: 'node.started',
          ts: new Date().toISOString(),
          nodeId: node.id,
          nodeExecutionId: record.id,
          label: node.data.label,
          nodeKind: node.type,
          payload: {
            attempt,
            maxAttempts,
            input: pending.input,
            branchDepth: pending.depth,
            activationIndex,
          },
        });

        const attemptStartedAt = new Date();
        const duration = Math.max(
          0,
          handler.duration?.(ctx) ?? randomInt(rngs.content, sim.minDurationMs, sim.maxDurationMs),
        );
        await sleep(duration);

        // Rolled once per attempt, always, so the sequence stays predictable.
        const roll = rngs.failure();
        const failed = sim.failureProbability > 0 && roll < sim.failureProbability;
        const completedAt = new Date();
        const attemptRecord: Attempt = {
          attempt,
          startedAt: attemptStartedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs: duration,
          status: failed ? 'failed' : 'success',
        };

        if (!failed) {
          const result = await handler.execute(ctx);
          record.attempts.push(attemptRecord);
          record.status = 'success';
          record.output = result.output;
          record.completedAt = completedAt;
          record.durationMs = record.completedAt.getTime() - (record.startedAt?.getTime() ?? 0);
          record.toolCalls = result.toolCalls ?? 0;
          toolCalls += record.toolCalls;
          if ((outbound.get(node.id) ?? []).length === 0) finalOutputs.push(result.output);

          await emit({
            type: 'node.completed',
            ts: completedAt.toISOString(),
            nodeId: node.id,
            nodeExecutionId: record.id,
            label: node.data.label,
            nodeKind: node.type,
            payload: {
              attempt,
              durationMs: duration,
              output: result.output,
              branch: result.branch ?? null,
            },
          });

          propagate(node.id, {
            kind: 'satisfied',
            nodeExecutionId: record.id,
            depth: pending.depth,
            output: result.output,
            branch: result.branch,
          });
          return;
        }

        const error = handler.failure?.(ctx) ?? {
          message: `${node.data.label} failed`,
          code: 'simulated_failure',
        };
        attemptRecord.error = error;
        record.attempts.push(attemptRecord);

        const retriesExhausted = attempt >= maxAttempts;
        await emit({
          type: 'node.failed',
          ts: completedAt.toISOString(),
          nodeId: node.id,
          nodeExecutionId: record.id,
          label: node.data.label,
          nodeKind: node.type,
          payload: { attempt, durationMs: duration, error, retriesExhausted },
        });

        if (!retriesExhausted) {
          const delayMs = sim.retryBackoffMs * 2 ** (attempt - 1);
          totalRetries += 1;
          await emit({
            type: 'node.retrying',
            ts: new Date().toISOString(),
            nodeId: node.id,
            nodeExecutionId: record.id,
            label: node.data.label,
            nodeKind: node.type,
            payload: { attempt, nextAttempt: attempt + 1, maxAttempts, delayMs, error },
          });
          await sleep(delayMs);
          continue;
        }

        record.status = 'failed';
        record.error = error;
        record.completedAt = completedAt;
        record.durationMs = completedAt.getTime() - (record.startedAt?.getTime() ?? 0);

        if (sim.continueOnError) {
          // The branch survives: downstream still runs, but with no new output.
          propagate(node.id, {
            kind: 'satisfied',
            nodeExecutionId: record.id,
            depth: pending.depth,
            output: pending.input,
          });
        } else {
          terminalError ??= { ...error, message: `${node.data.label}: ${error.message}` };
          propagate(node.id, { kind: 'pruned', reason: 'upstream-failed' });
        }
        return;
      }
    } catch (error) {
      // An unexpected handler bug -- recorded like any other terminal node failure.
      const nodeError = toNodeError(error);
      record.status = 'failed';
      record.error = nodeError;
      record.completedAt = new Date();
      record.durationMs = record.completedAt.getTime() - (record.startedAt?.getTime() ?? 0);
      terminalError ??= nodeError;
      await emit({
        type: 'node.failed',
        ts: new Date().toISOString(),
        nodeId: node.id,
        nodeExecutionId: record.id,
        label: node.data.label,
        nodeKind: node.type,
        payload: {
          attempt: record.attemptCount || 1,
          durationMs: record.durationMs ?? 0,
          error: nodeError,
          retriesExhausted: true,
        },
      });
      propagate(node.id, { kind: 'pruned', reason: 'upstream-failed' });
    } finally {
      running -= 1;
    }
  }

  // Seed: every node without inbound edges starts the run.
  for (const node of definition.nodes) {
    if ((inbound.get(node.id) ?? []).length === 0) {
      queue.push({ type: 'run', nodeId: node.id, input: triggerInput ?? {}, parentId: null, depth: 0 });
    }
  }

  const inFlight = new Set<Promise<void>>();

  while (queue.length > 0 || inFlight.size > 0) {
    while (queue.length > 0) {
      const pending = queue.shift() as Pending;

      if (pending.type === 'skip') {
        const promise = Promise.resolve(skip(pending.nodeId, pending.reason)).then(() => undefined);
        inFlight.add(promise);
        void promise.finally(() => inFlight.delete(promise));
        continue;
      }

      const perNode = activationCounts.get(pending.nodeId) ?? 0;
      if (totalActivations >= maxActivations || perNode >= maxPerNode) {
        // Hitting the cap ends the run deliberately rather than hanging the process; the
        // anomaly rules surface it as a probable retry loop or missing termination.
        capReached = true;
        continue;
      }
      totalActivations += 1;

      const promise = activate(pending);
      inFlight.add(promise);
      void promise.finally(() => inFlight.delete(promise));
    }

    if (inFlight.size > 0) await Promise.race(inFlight);
  }

  /**
   * Tokens still sitting on edges mean some join never received all of its inputs -- a
   * cycle whose node waits for every branch, or a graph that simply cannot complete.
   * Reporting it beats finishing "successfully" with half the workflow never run.
   */
  const deadlocked = [...new Set(
    definition.edges.filter((e) => tokens.has(e.id)).map((e) => e.target),
  )];

  if (deadlocked.length > 0) {
    for (const nodeId of deadlocked) {
      if (records.some((r) => r.nodeId === nodeId)) continue;
      const node = nodeById.get(nodeId);
      if (!node) continue;
      records.push({
        id: randomUUID(),
        nodeId,
        nodeKind: node.type,
        label: node.data.label,
        status: 'skipped',
        attemptCount: 0,
        maxAttempts: node.data.config.simulation.maxRetries + 1,
        attempts: [],
        startedAt: null,
        completedAt: null,
        durationMs: null,
        input: null,
        output: null,
        error: null,
        parentNodeExecutionId: null,
        branchDepth: 0,
        activationIndex: 0,
        toolCalls: 0,
      });
    }

    const labels = deadlocked.map((id) => nodeById.get(id)?.data.label ?? id);
    terminalError ??= {
      message: `Never received all inputs: ${labels.join(', ')}. The graph has a cycle or an unreachable join.`,
      code: 'graph_deadlock',
    };
  }

  if (capReached) {
    terminalError ??= {
      message: 'Execution stopped after reaching the node activation cap',
      code: 'activation_cap_reached',
    };
  }

  /*
   * Only nodes that actually *ran* count as repeats. A node downstream of a loop is
   * activated once per pass but skipped on the passes where its branch was pruned --
   * counting those would report "End executed 3 times" for a node that ran once.
   */
  const executionCounts = new Map<string, number>();
  for (const record of records) {
    if (record.status === 'skipped') continue;
    executionCounts.set(record.nodeId, (executionCounts.get(record.nodeId) ?? 0) + 1);
  }

  const repeatedNodes: Record<string, number> = {};
  for (const [nodeId, count] of executionCounts) {
    if (count > 1) repeatedNodes[nodeId] = count;
  }

  const stats: ExecutionStats = {
    nodeCount: definition.nodes.length,
    nodeExecutionCount: records.length,
    successCount: records.filter((r) => r.status === 'success').length,
    failureCount: records.filter((r) => r.status === 'failed').length,
    skippedCount: records.filter((r) => r.status === 'skipped').length,
    totalRetries,
    toolCalls,
    maxBranchDepth,
    peakParallelism,
    repeatedNodes,
    totalDurationMs: 0, // stamped by the runner, which owns the wall clock
  };

  const output = finalOutputs.reduce<Record<string, unknown>>((acc, o) => ({ ...acc, ...o }), {});

  return {
    status: terminalError ? 'failed' : 'success',
    error: terminalError,
    output,
    stats,
    records,
    capReached,
    deadlockedNodes: deadlocked,
  };
}
