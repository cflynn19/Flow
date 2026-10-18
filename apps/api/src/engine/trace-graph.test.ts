import { INGEST_START_NODE_ID } from '@flow/shared';
import { describe, expect, it } from 'vitest';
import { inferParents, layout, startNode, stepNode, traceEdge, type TimedActivation } from './trace-graph.ts';

const start: TimedActivation = { nodeId: INGEST_START_NODE_ID, startedAt: 0, completedAt: 0 };
const step = (nodeId: string, startedAt: number, completedAt: number | null): TimedActivation => ({
  nodeId,
  startedAt,
  completedAt,
});

describe('inferParents', () => {
  it('attaches the first step to Start', () => {
    expect(inferParents([start], 5)).toEqual([INGEST_START_NODE_ID]);
  });

  it('chains sequential steps', () => {
    const a = step('a', 0, 10);
    expect(inferParents([start, a], 10)).toEqual(['a']);
    expect(inferParents([start, a, step('b', 10, 20)], 25)).toEqual(['b']);
  });

  it('fans out: a sibling starting does not hide the shared parent', () => {
    const a = step('a', 0, 10);
    const b = step('b', 11, null); // still running
    expect(inferParents([start, a, b], 12)).toEqual(['a']);
  });

  it('fans in: a step after parallel branches depends on all of them', () => {
    const a = step('a', 0, 10);
    const b = step('b', 11, 30);
    const c = step('c', 11, 25);
    expect(inferParents([start, a, b, c], 31).sort()).toEqual(['b', 'c']);
  });

  it('ignores steps that finished after the new one started', () => {
    const a = step('a', 0, 10);
    const slow = step('slow', 11, 100);
    expect(inferParents([start, a, slow], 50)).toEqual(['a']);
  });
});

describe('layout', () => {
  it('places a chain left to right and parallel branches in one column', () => {
    const result = layout({
      nodes: [startNode(), stepNode('a', 'A'), stepNode('b', 'B'), stepNode('c', 'C'), stepNode('d', 'D')],
      edges: [
        traceEdge(INGEST_START_NODE_ID, 'a'),
        traceEdge('a', 'b'),
        traceEdge('a', 'c'),
        traceEdge('b', 'd'),
        traceEdge('c', 'd'),
      ],
    });
    const x = Object.fromEntries(result.nodes.map((n) => [n.id, n.position.x]));
    const y = Object.fromEntries(result.nodes.map((n) => [n.id, n.position.y]));

    expect(x.a).toBeGreaterThan(x[INGEST_START_NODE_ID]!);
    expect(x.b).toBe(x.c);
    expect(y.b).not.toBe(y.c);
    expect(x.d).toBeGreaterThan(x.b!);
  });

  it('still places every node when merged runs form a cycle', () => {
    const result = layout({
      nodes: [startNode(), stepNode('a', 'A'), stepNode('b', 'B')],
      edges: [traceEdge(INGEST_START_NODE_ID, 'a'), traceEdge('a', 'b'), traceEdge('b', 'a')],
    });
    expect(result.nodes).toHaveLength(3);
    for (const node of result.nodes) expect(Number.isFinite(node.position.x)).toBe(true);
  });
});
