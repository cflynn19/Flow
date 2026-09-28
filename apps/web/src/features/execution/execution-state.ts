import type {
  Anomaly,
  Attempt,
  ExecutionEvent,
  ExecutionStats,
  ExecutionStatus,
  NodeError,
  NodeKind,
} from '@flow/shared';
import type { RunState } from '@/lib/status';

/**
 * Execution state is derived from the event log and nothing else. A live run and a run
 * from last Tuesday go through this same reducer, so the canvas, timeline and inspector
 * cannot drift between "watching" and "reviewing".
 */

export interface NodeActivation {
  /** Stable id for this one activation of the node; a looping node has several. */
  id: string;
  nodeId: string;
  label: string;
  kind: NodeKind;
  status: RunState;
  attempt: number;
  maxAttempts: number;
  attempts: Attempt[];
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  input: unknown;
  output: unknown;
  error: NodeError | null;
  branch: string | null;
  branchDepth: number;
  activationIndex: number;
  skipReason: string | null;
}

export interface ExecutionViewState {
  status: ExecutionStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: NodeError | null;
  stats: ExecutionStats | null;
  anomalies: Anomaly[];
  /** Every activation, in the order they started. Drives the timeline. */
  activations: NodeActivation[];
  /** Latest activation per node id. Drives the canvas. */
  byNodeId: Record<string, NodeActivation>;
  events: ExecutionEvent[];
  lastSeq: number;
}

export const initialExecutionState: ExecutionViewState = {
  status: 'pending',
  startedAt: null,
  completedAt: null,
  durationMs: null,
  error: null,
  stats: null,
  anomalies: [],
  activations: [],
  byNodeId: {},
  events: [],
  lastSeq: 0,
};

function upsert(
  state: ExecutionViewState,
  id: string,
  update: (current: NodeActivation) => NodeActivation,
  create: () => NodeActivation,
): ExecutionViewState {
  const index = state.activations.findIndex((a) => a.id === id);
  const next =
    index === -1
      ? [...state.activations, create()]
      : state.activations.map((a, i) => (i === index ? update(a) : a));

  // The canvas shows a node's most recent activation, which for a loop is the last one.
  const byNodeId: Record<string, NodeActivation> = {};
  for (const activation of next) byNodeId[activation.nodeId] = activation;

  return { ...state, activations: next, byNodeId };
}

/** Switching to a different execution must clear everything, not merge into it. */
export type ExecutionAction = ExecutionEvent | { type: 'reset' };

export function executionReducer(
  state: ExecutionViewState,
  action: ExecutionAction,
): ExecutionViewState {
  if (action.type === 'reset') return initialExecutionState;
  const event = action;

  // Replay and live delivery can overlap; anything already applied is ignored.
  if (event.seq <= state.lastSeq) return state;
  const base = { ...state, lastSeq: event.seq, events: [...state.events, event] };

  switch (event.type) {
    case 'workflow.started':
      return { ...base, status: 'running', startedAt: event.ts };

    case 'node.started': {
      const blank: NodeActivation = {
        id: event.nodeExecutionId,
        nodeId: event.nodeId,
        label: event.label,
        kind: event.nodeKind,
        status: 'running',
        attempt: event.payload.attempt,
        maxAttempts: event.payload.maxAttempts,
        attempts: [],
        startedAt: event.ts,
        completedAt: null,
        durationMs: null,
        input: event.payload.input,
        output: null,
        error: null,
        branch: null,
        branchDepth: event.payload.branchDepth,
        activationIndex: event.payload.activationIndex,
        skipReason: null,
      };

      return upsert(
        base,
        event.nodeExecutionId,
        (current) => ({
          ...current,
          status: 'running',
          attempt: event.payload.attempt,
          maxAttempts: event.payload.maxAttempts,
          // `startedAt` stays at the first attempt so the timeline bar spans the retries.
          startedAt: current.startedAt ?? event.ts,
        }),
        () => blank,
      );
    }

    case 'node.completed':
      return upsert(
        base,
        event.nodeExecutionId,
        (current) => ({
          ...current,
          status: 'success',
          // A retry that succeeds clears the node-level error; the failed attempts are
          // still on the record below, which is where that history belongs.
          error: null,
          output: event.payload.output,
          branch: event.payload.branch ?? null,
          completedAt: event.ts,
          durationMs: elapsed(current.startedAt, event.ts),
          attempts: [
            ...current.attempts,
            {
              attempt: event.payload.attempt,
              startedAt: shift(event.ts, -event.payload.durationMs),
              completedAt: event.ts,
              durationMs: event.payload.durationMs,
              status: 'success',
            },
          ],
        }),
        () => fallbackActivation(event.nodeExecutionId, event.nodeId, event.label, event.nodeKind, 'success'),
      );

    case 'node.failed':
      return upsert(
        base,
        event.nodeExecutionId,
        (current) => ({
          ...current,
          status: event.payload.retriesExhausted ? 'failed' : current.status,
          error: event.payload.error,
          completedAt: event.payload.retriesExhausted ? event.ts : current.completedAt,
          durationMs: event.payload.retriesExhausted
            ? elapsed(current.startedAt, event.ts)
            : current.durationMs,
          attempts: [
            ...current.attempts,
            {
              attempt: event.payload.attempt,
              startedAt: shift(event.ts, -event.payload.durationMs),
              completedAt: event.ts,
              durationMs: event.payload.durationMs,
              status: 'failed',
              error: event.payload.error,
            },
          ],
        }),
        () => fallbackActivation(event.nodeExecutionId, event.nodeId, event.label, event.nodeKind, 'failed'),
      );

    case 'node.retrying':
      return upsert(
        base,
        event.nodeExecutionId,
        (current) => ({ ...current, status: 'retrying', error: event.payload.error }),
        () => fallbackActivation(event.nodeExecutionId, event.nodeId, event.label, event.nodeKind, 'retrying'),
      );

    case 'node.skipped':
      return upsert(
        base,
        event.nodeExecutionId,
        (current) => ({ ...current, status: 'skipped', skipReason: event.payload.reason }),
        () => ({
          ...fallbackActivation(event.nodeExecutionId, event.nodeId, event.label, event.nodeKind, 'skipped'),
          skipReason: event.payload.reason,
        }),
      );

    case 'workflow.completed':
    case 'workflow.failed':
      return {
        ...base,
        status: event.payload.status,
        completedAt: event.ts,
        durationMs: event.payload.durationMs,
        stats: event.payload.stats,
        anomalies: event.payload.anomalies,
        error: event.payload.error,
      };
  }
}

export function reduceEvents(events: ExecutionEvent[]): ExecutionViewState {
  return events.reduce(executionReducer, initialExecutionState);
}

function elapsed(from: string | null, to: string): number | null {
  if (!from) return null;
  return Math.max(0, new Date(to).getTime() - new Date(from).getTime());
}

function shift(iso: string, deltaMs: number): string {
  return new Date(new Date(iso).getTime() + deltaMs).toISOString();
}

/** Guards against a stream that somehow starts mid-node (e.g. a truncated log). */
function fallbackActivation(
  id: string,
  nodeId: string,
  label: string,
  kind: NodeKind,
  status: RunState,
): NodeActivation {
  return {
    id,
    nodeId,
    label,
    kind,
    status,
    attempt: 1,
    maxAttempts: 1,
    attempts: [],
    startedAt: null,
    completedAt: null,
    durationMs: null,
    input: null,
    output: null,
    error: null,
    branch: null,
    branchDepth: 0,
    activationIndex: 0,
    skipReason: null,
  };
}
