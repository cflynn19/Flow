import { defaultConfigFor, type WorkflowDefinition } from '@flow/shared';
import { describe, expect, it } from 'vitest';
import type { WorkflowNodeType } from './WorkflowNode';
import {
  createNode,
  definitionsEqual,
  nextFreePosition,
  toCanvasEdges,
  toCanvasNodes,
  toDefinition,
} from './graph';

const definition: WorkflowDefinition = {
  nodes: [
    {
      id: 'trigger',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { label: 'Start', config: defaultConfigFor('trigger') },
    },
    {
      id: 'check',
      type: 'conditional',
      position: { x: 260, y: 0 },
      data: { label: 'Approved?', config: defaultConfigFor('conditional') },
    },
  ],
  edges: [
    { id: 'trigger__check', source: 'trigger', target: 'check', sourceHandle: null, targetHandle: null },
  ],
};

describe('canvas <-> definition', () => {
  it('round-trips a definition without losing anything', () => {
    const restored = toDefinition(toCanvasNodes(definition), toCanvasEdges(definition));
    expect(restored).toEqual(definition);
  });

  it('keeps the branch handle on a conditional edge', () => {
    const branched: WorkflowDefinition = {
      ...definition,
      edges: [{ ...definition.edges[0]!, sourceHandle: 'false' }],
    };
    const restored = toDefinition(toCanvasNodes(branched), toCanvasEdges(branched));
    expect(restored.edges[0]?.sourceHandle).toBe('false');
  });
});

/** Rebuilds an object with its keys in reverse order, as jsonb round-tripping can. */
function shuffleKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(shuffleKeys) as unknown as T;
  if (value === null || typeof value !== 'object') return value;

  const entries = Object.entries(value as Record<string, unknown>).reverse();
  return Object.fromEntries(entries.map(([k, v]) => [k, shuffleKeys(v)])) as T;
}

describe('definitionsEqual', () => {
  it('ignores key order, which Postgres jsonb does not preserve', () => {
    const reordered = shuffleKeys(definition);

    // Sanity check: the naive comparison this replaced would have failed here.
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(definition));
    expect(definitionsEqual(definition, reordered)).toBe(true);
  });

  it('still notices a real change', () => {
    const renamed = structuredClone(definition);
    renamed.nodes[0]!.data.label = 'Begin';
    expect(definitionsEqual(definition, renamed)).toBe(false);
  });

  it('treats a null handle and an absent handle as the same thing', () => {
    // How the API stores an edge written without handle fields.
    const stored = structuredClone(definition) as unknown as {
      edges: Record<string, unknown>[];
    };
    delete stored.edges[0]!.sourceHandle;
    delete stored.edges[0]!.targetHandle;

    // How the canvas always renders it back out.
    expect(definition.edges[0]?.sourceHandle).toBeNull();
    expect(definitionsEqual(definition, stored as unknown as WorkflowDefinition)).toBe(true);
  });

  it('treats an explicit undefined as absent', () => {
    const withUndefined = structuredClone(definition);
    withUndefined.nodes[0]!.data.description = undefined;
    expect(definitionsEqual(definition, withUndefined)).toBe(true);
  });
});

describe('nextFreePosition', () => {
  const at = (x: number, y: number): WorkflowNodeType =>
    ({ ...createNode('action', { x, y }) }) as WorkflowNodeType;

  it('uses the fallback on an empty canvas', () => {
    expect(nextFreePosition([], { x: 40, y: 80 })).toEqual({ x: 40, y: 80 });
  });

  it('places a new node clear of the rightmost one', () => {
    const position = nextFreePosition([at(0, 0)], { x: 0, y: 0 });
    expect(position.x).toBeGreaterThan(188);
    expect(position.y).toBe(0);
  });

  it('slides down rather than landing on an existing node', () => {
    // A node already sits exactly where the next one would go.
    const nodes = [at(0, 0), at(260, 0)];
    const position = nextFreePosition(nodes, { x: 0, y: 0 });

    const collides = nodes.some(
      (node) => Math.abs(node.position.x - position.x) < 188 && Math.abs(node.position.y - position.y) < 56,
    );
    expect(collides).toBe(false);
  });
});
