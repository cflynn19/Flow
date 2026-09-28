import type { ExecutionEvent, FlowNode, NodeKind } from '@flow/shared';

/** An event as produced by the scheduler; the runner stamps on executionId and seq. */
export type DraftEvent = ExecutionEvent extends infer E
  ? E extends ExecutionEvent
    ? Omit<E, 'executionId' | 'seq'>
    : never
  : never;

export type Emit = (event: DraftEvent) => Promise<void>;

export interface NodeContext {
  node: FlowNode;
  /** Merged outputs of the parents that satisfied this activation. */
  input: Record<string, unknown>;
  attempt: number;
  /** Generator for synthesised output and error text. */
  rng: () => number;
  /** Separate generator for branch decisions, so failure rolls never shift them. */
  branchRng: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface NodeResult {
  output: Record<string, unknown>;
  /** Conditional nodes name the outgoing handle they took. */
  branch?: string;
  toolCalls?: number;
}

/**
 * A node type is defined entirely by this interface. Retries, timing, event emission and
 * graph traversal all live in the scheduler, so a handler only has to describe what the
 * node *does*.
 */
export interface NodeHandler {
  kind: NodeKind;
  /** Duration of one attempt, in ms. Defaults to the node's simulation range. */
  duration?(ctx: NodeContext): number;
  /** Error raised when the simulated failure roll fires. */
  failure?(ctx: NodeContext): { message: string; code: string };
  execute(ctx: NodeContext): NodeResult | Promise<NodeResult>;
}

export class NodeFailure extends Error {
  constructor(
    message: string,
    readonly code = 'node_failed',
  ) {
    super(message);
    this.name = 'NodeFailure';
  }
}
