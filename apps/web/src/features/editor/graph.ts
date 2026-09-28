import {
  defaultConfigFor,
  type FlowEdge,
  type FlowNode,
  type NodeKind,
  type WorkflowDefinition,
} from '@flow/shared';
import type { Edge } from '@xyflow/react';
import type { WorkflowNodeType } from './WorkflowNode';
import { NODE_KIND_META } from './node-registry';

/**
 * React Flow's node shape and ours are deliberately the same, so converting between the
 * canvas and a saved definition is a straight mapping rather than a translation layer.
 */

export function toCanvasNodes(definition: WorkflowDefinition): WorkflowNodeType[] {
  return definition.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: { ...node.data },
  }));
}

export function toCanvasEdges(definition: WorkflowDefinition): Edge[] {
  return definition.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    label: edge.label,
    type: 'smoothstep',
    labelStyle: { fill: 'var(--color-text-subtle)', fontSize: 10 },
    labelBgStyle: { fill: 'var(--color-surface)' },
    labelBgPadding: [4, 2] as [number, number],
  }));
}

export function toDefinition(nodes: WorkflowNodeType[], edges: Edge[]): WorkflowDefinition {
  return {
    nodes: nodes.map<FlowNode>((node) => ({
      id: node.id,
      type: (node.type ?? 'action') as NodeKind,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      data: { label: node.data.label, description: node.data.description, config: node.data.config },
    })),
    edges: edges.map<FlowEdge>((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      ...(typeof edge.label === 'string' ? { label: edge.label } : {}),
    })),
  };
}

/**
 * Key-order-insensitive comparison for the unsaved-changes indicator.
 *
 * A plain JSON.stringify would not do: Postgres `jsonb` normalises key order on write,
 * so a freshly saved definition never string-matches the one on the canvas and the editor
 * would claim unsaved changes forever.
 */
export function definitionsEqual(a: WorkflowDefinition, b: WorkflowDefinition): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    /*
     * Absent and null mean the same thing throughout a workflow definition -- the schema
     * declares optional fields with `.nullish()`, so a definition written without
     * `sourceHandle` stores no key at all, while the canvas always produces an explicit
     * `null`. Treating those as different made an untouched workflow load permanently
     * dirty. `undefined` is dropped for the same reason: it does not survive JSON.
     */
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);

  return `{${entries.join(',')}}`;
}

let idCounter = 0;

export function createNode(kind: NodeKind, position: { x: number; y: number }): WorkflowNodeType {
  idCounter += 1;
  const id = `${kind}-${Date.now().toString(36)}-${idCounter}`;
  return {
    id,
    type: kind,
    position,
    data: { label: NODE_KIND_META[kind].label, config: defaultConfigFor(kind) },
  };
}

export function edgeId(source: string, target: string, handle?: string | null): string {
  return `${source}__${target}${handle ? `__${handle}` : ''}`;
}

const NODE_WIDTH = 188;
const NODE_HEIGHT = 56;
const GAP_X = 72;
const GAP_Y = 32;

/**
 * Where a click-to-add node should land. Dropping it at the centre of the viewport would
 * stack it on whatever is already there -- covering the existing node's handles, so the
 * next connection drag grabs the wrong one. Instead it goes to the right of the graph,
 * then slides down until the slot is genuinely free.
 */
export function nextFreePosition(
  nodes: WorkflowNodeType[],
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (nodes.length === 0) return fallback;

  const rightmost = nodes.reduce((a, b) => (a.position.x >= b.position.x ? a : b));
  const candidate = {
    x: rightmost.position.x + NODE_WIDTH + GAP_X,
    y: rightmost.position.y,
  };

  const overlaps = (point: { x: number; y: number }) =>
    nodes.some(
      (node) =>
        Math.abs(node.position.x - point.x) < NODE_WIDTH &&
        Math.abs(node.position.y - point.y) < NODE_HEIGHT,
    );

  while (overlaps(candidate)) candidate.y += NODE_HEIGHT + GAP_Y;
  return candidate;
}
