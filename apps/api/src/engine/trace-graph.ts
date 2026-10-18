import {
  INGEST_START_NODE_ID,
  actionConfigSchema,
  triggerConfigSchema,
  type FlowEdge,
  type FlowNode,
  type WorkflowDefinition,
} from '@flow/shared';

/**
 * Graph construction for reported runs. An external app only says when each step started
 * and finished; this file turns that into the same `WorkflowDefinition` the editor
 * produces, so a reported run renders on the same canvas as a simulated one.
 */

/** The node budget the shared definition schema allows. */
export const MAX_TRACE_NODES = 200;

const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 110;

export interface TimedActivation {
  nodeId: string;
  startedAt: number;
  /** Null while the step is still running. */
  completedAt: number | null;
}

/**
 * Which earlier steps a newly started step depends on, judged by timing alone.
 *
 * A step's parents are the steps that had finished before it started *and* were not
 * themselves followed by another finished step in the meantime. That single rule gives
 * the shapes code actually produces:
 *
 *   sequential   A done, B starts, B done, C starts         -> A -> B -> C
 *   fan-out      A done, then B and C start together        -> A -> B, A -> C
 *   fan-in       B and C both done, then D starts           -> B -> D, C -> D
 *
 * B starting does not hide A from C: A is only superseded by a step that has *finished*,
 * which is what lets two siblings both attach to A.
 */
export function inferParents(activations: TimedActivation[], startedAt: number): string[] {
  const finished = activations.filter(
    (a): a is TimedActivation & { completedAt: number } =>
      a.completedAt !== null && a.completedAt <= startedAt,
  );

  const frontier = finished.filter(
    (candidate) =>
      !finished.some(
        (other) => other !== candidate && other.startedAt >= candidate.completedAt,
      ),
  );

  const parents = [...new Set(frontier.map((a) => a.nodeId))];
  return parents.length > 0 ? parents : [INGEST_START_NODE_ID];
}

export function startNode(): FlowNode {
  return {
    id: INGEST_START_NODE_ID,
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: { label: 'Start', config: triggerConfigSchema.parse({ kind: 'trigger' }) },
  };
}

export function stepNode(id: string, label: string): FlowNode {
  return {
    id,
    type: 'action',
    position: { x: 0, y: 0 },
    data: { label, config: actionConfigSchema.parse({ kind: 'action', operation: id }) },
  };
}

export function traceEdge(source: string, target: string): FlowEdge {
  return { id: `${source}->${target}`, source, target };
}

/** Union of two graphs. Positions are not merged -- `layout` recomputes them. */
export function mergeDefinitions(
  base: WorkflowDefinition,
  extra: WorkflowDefinition,
): WorkflowDefinition {
  const nodes = new Map(base.nodes.map((n) => [n.id, n]));
  for (const node of extra.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node);

  const edges = new Map(base.edges.map((e) => [e.id, e]));
  for (const edge of extra.edges) if (!edges.has(edge.id)) edges.set(edge.id, edge);

  return { nodes: [...nodes.values()].slice(0, MAX_TRACE_NODES), edges: [...edges.values()] };
}

/**
 * Left-to-right layered layout: a node's column is the longest path to it from the
 * start, so a sequential chain reads as a line and parallel branches stack vertically.
 *
 * A single run always produces a DAG, but a workflow's graph is the union of every run
 * of it, and two runs that ordered the same steps differently create a cycle. Nodes the
 * topological pass cannot place are therefore put one column after their furthest placed
 * parent rather than being dropped.
 */
export function layout(definition: WorkflowDefinition): WorkflowDefinition {
  const ids = definition.nodes.map((n) => n.id);
  const known = new Set(ids);
  const edges = definition.edges.filter((e) => known.has(e.source) && known.has(e.target));

  const inDegree = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);

  const column = new Map<string, number>();
  const queue = ids.filter((id) => inDegree.get(id) === 0);
  for (const id of queue) column.set(id, 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== id) continue;
      column.set(edge.target, Math.max(column.get(edge.target) ?? 0, (column.get(id) ?? 0) + 1));
      const remaining = (inDegree.get(edge.target) ?? 0) - 1;
      inDegree.set(edge.target, remaining);
      if (remaining === 0) queue.push(edge.target);
    }
  }

  // Whatever is left sits on a cycle. Place it, in definition order, after its parents.
  for (const id of ids) {
    if (column.has(id)) continue;
    const parentColumns = edges
      .filter((e) => e.target === id && column.has(e.source))
      .map((e) => column.get(e.source)!);
    column.set(id, parentColumns.length > 0 ? Math.max(...parentColumns) + 1 : 0);
  }

  const byColumn = new Map<number, string[]>();
  for (const id of ids) {
    const c = column.get(id) ?? 0;
    byColumn.set(c, [...(byColumn.get(c) ?? []), id]);
  }

  const position = new Map<string, { x: number; y: number }>();
  for (const [c, members] of byColumn) {
    // Centre each column on the start node's row so branches fan out symmetrically.
    const offset = ((members.length - 1) * ROW_HEIGHT) / 2;
    members.forEach((id, row) => {
      position.set(id, { x: c * COLUMN_WIDTH, y: row * ROW_HEIGHT - offset });
    });
  }

  return {
    nodes: definition.nodes.map((n) => ({ ...n, position: position.get(n.id) ?? n.position })),
    edges,
  };
}
