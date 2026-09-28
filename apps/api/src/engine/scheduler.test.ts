import type { ExecutionEvent } from '@flow/shared';
import { describe, expect, it } from 'vitest';
import { definition, edge, instantSleep, node, scriptedRng } from '../test/fixtures.ts';
import { runGraph, type RunGraphOptions } from './scheduler.ts';
import type { DraftEvent } from './types.ts';

type Captured = DraftEvent;

async function run(options: Omit<RunGraphOptions, 'emit' | 'seed'> & { seed?: number }) {
  const events: Captured[] = [];
  const result = await runGraph({
    seed: 1,
    sleep: instantSleep,
    ...options,
    emit: async (event) => {
      events.push(event);
    },
  });
  return { result, events };
}

const typesFor = (events: Captured[], type: ExecutionEvent['type']) =>
  events.filter((e) => e.type === type);

const nodeIdsFor = (events: Captured[], type: ExecutionEvent['type']) =>
  typesFor(events, type).map((e) => e.nodeId);

const statusOf = (result: Awaited<ReturnType<typeof run>>['result'], nodeId: string) =>
  result.records.find((r) => r.nodeId === nodeId)?.status;

describe('sequential execution', () => {
  it('runs a chain in order and reports success', async () => {
    const def = definition(
      [node('trigger', 'trigger'), node('a', 'action'), node('b', 'action'), node('end', 'end')],
      [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'end')],
    );

    const { result, events } = await run({ definition: def, triggerInput: { email: 'x@y.z' } });

    expect(result.status).toBe('success');
    expect(nodeIdsFor(events, 'node.completed')).toEqual(['trigger', 'a', 'b', 'end']);
    expect(result.records).toHaveLength(4);
    expect(result.stats.successCount).toBe(4);
  });

  it('threads each node output into the next node input', async () => {
    const def = definition(
      [node('trigger', 'trigger'), node('createUser', 'action', { config: { operation: 'createUser' } }), node('sendEmail', 'action', { config: { operation: 'sendEmail' } })],
      [edge('trigger', 'createUser'), edge('createUser', 'sendEmail')],
    );

    const { result } = await run({ definition: def, triggerInput: { email: 'ada@example.com' } });

    const email = result.records.find((r) => r.nodeId === 'sendEmail');
    expect(email?.input).toMatchObject({ email: 'ada@example.com' });
    expect(email?.input).toHaveProperty('userId');
  });
});

describe('parallel execution', () => {
  it('overlaps sibling branches in wall-clock time', async () => {
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('fanout', 'parallel'),
        node('left', 'action', { simulation: { minDurationMs: 60, maxDurationMs: 60 } }),
        node('right', 'action', { simulation: { minDurationMs: 60, maxDurationMs: 60 } }),
        node('join', 'end'),
      ],
      [
        edge('trigger', 'fanout'),
        edge('fanout', 'left'),
        edge('fanout', 'right'),
        edge('left', 'join'),
        edge('right', 'join'),
      ],
    );

    // Real timers here: the whole point is that the two branches genuinely overlap.
    const { result, events } = await run({ definition: def, triggerInput: null, sleep: undefined });

    const at = (type: ExecutionEvent['type'], nodeId: string) =>
      new Date(events.find((e) => e.type === type && e.nodeId === nodeId)!.ts).getTime();

    expect(at('node.started', 'right')).toBeLessThan(at('node.completed', 'left'));
    expect(at('node.started', 'left')).toBeLessThan(at('node.completed', 'right'));
    expect(result.stats.peakParallelism).toBeGreaterThanOrEqual(2);
    expect(result.status).toBe('success');
  });

  it('waits for every branch before running the join', async () => {
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('left', 'action'),
        node('right', 'action'),
        node('join', 'end'),
      ],
      [edge('trigger', 'left'), edge('trigger', 'right'), edge('left', 'join'), edge('right', 'join')],
    );

    const { events } = await run({ definition: def, triggerInput: null });
    const completed = nodeIdsFor(events, 'node.completed');

    expect(completed.indexOf('join')).toBeGreaterThan(completed.indexOf('left'));
    expect(completed.indexOf('join')).toBeGreaterThan(completed.indexOf('right'));
    expect(completed.filter((id) => id === 'join')).toHaveLength(1);
  });

  it('records branch depth for fanned-out nodes', async () => {
    const def = definition(
      [node('trigger', 'trigger'), node('left', 'action'), node('right', 'action')],
      [edge('trigger', 'left'), edge('trigger', 'right')],
    );

    const { result } = await run({ definition: def, triggerInput: null });
    expect(result.stats.maxBranchDepth).toBe(1);
  });
});

describe('conditional branching', () => {
  const conditionalGraph = () =>
    definition(
      [
        node('trigger', 'trigger'),
        node('check', 'conditional', { config: { mode: 'probability', probability: 0.5 } }),
        node('yes', 'action'),
        node('no', 'action'),
        node('join', 'end'),
      ],
      [
        edge('trigger', 'check'),
        edge('check', 'yes', 'true'),
        edge('check', 'no', 'false'),
        edge('yes', 'join'),
        edge('no', 'join'),
      ],
    );

  it('runs the taken branch and skips the other', async () => {
    const { result, events } = await run({
      definition: conditionalGraph(),
      triggerInput: null,
      rngs: { branch: scriptedRng([0.1]) },
    });

    expect(statusOf(result, 'yes')).toBe('success');
    expect(statusOf(result, 'no')).toBe('skipped');
    expect(nodeIdsFor(events, 'node.skipped')).toEqual(['no']);
    expect(result.status).toBe('success');
  });

  it('takes the false branch when the condition fails', async () => {
    const { result } = await run({
      definition: conditionalGraph(),
      triggerInput: null,
      rngs: { branch: scriptedRng([0.9]) },
    });

    expect(statusOf(result, 'yes')).toBe('skipped');
    expect(statusOf(result, 'no')).toBe('success');
  });

  it('still runs a join whose other parent was pruned', async () => {
    const { result } = await run({
      definition: conditionalGraph(),
      triggerInput: null,
      rngs: { branch: scriptedRng([0.1]) },
    });

    // The join has one satisfied parent and one pruned parent -- it must survive.
    expect(statusOf(result, 'join')).toBe('success');
  });

  it('evaluates expression mode against the incoming payload', async () => {
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('check', 'conditional', {
          config: { mode: 'expression', path: 'plan', operator: 'eq', value: 'pro' },
        }),
        node('yes', 'action'),
        node('no', 'action'),
      ],
      [edge('trigger', 'check'), edge('check', 'yes', 'true'), edge('check', 'no', 'false')],
    );

    const { result } = await run({ definition: def, triggerInput: { plan: 'pro' } });
    expect(statusOf(result, 'yes')).toBe('success');
    expect(statusOf(result, 'no')).toBe('skipped');
  });
});

describe('retries', () => {
  it('retries a failing node and succeeds on a later attempt', async () => {
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('flaky', 'action', {
          label: 'Send Email',
          config: { operation: 'sendEmail' },
          simulation: { failureProbability: 0.5, maxRetries: 3, retryBackoffMs: 0 },
        }),
        node('after', 'action'),
      ],
      [edge('trigger', 'flaky'), edge('flaky', 'after')],
    );

    // trigger attempt, then flaky: fail, fail, succeed.
    const { result, events } = await run({
      definition: def,
      triggerInput: null,
      rngs: { failure: scriptedRng([0.9, 0.1, 0.1, 0.9]) },
    });

    const flaky = result.records.find((r) => r.nodeId === 'flaky');
    expect(flaky?.status).toBe('success');
    expect(flaky?.attemptCount).toBe(3);
    expect(flaky?.attempts.map((a) => a.status)).toEqual(['failed', 'failed', 'success']);
    expect(typesFor(events, 'node.retrying')).toHaveLength(2);
    expect(result.stats.totalRetries).toBe(2);
    expect(statusOf(result, 'after')).toBe('success');
  });

  it('marks retries exhausted after the final attempt fails', async () => {
    const def = definition(
      [node('trigger', 'trigger'), node('doomed', 'action', { simulation: { failureProbability: 1, maxRetries: 2, retryBackoffMs: 0 } })],
      [edge('trigger', 'doomed')],
    );

    const { result, events } = await run({ definition: def, triggerInput: null });

    const doomed = result.records.find((r) => r.nodeId === 'doomed');
    expect(doomed?.status).toBe('failed');
    expect(doomed?.attemptCount).toBe(3);
    expect(typesFor(events, 'node.failed')).toHaveLength(3);

    const last = typesFor(events, 'node.failed').at(-1);
    expect(last?.type === 'node.failed' && last.payload.retriesExhausted).toBe(true);
    expect(result.status).toBe('failed');
  });
});

describe('failure propagation', () => {
  it('skips everything downstream of a terminal failure', async () => {
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('boom', 'action', { simulation: { failureProbability: 1 } }),
        node('next', 'action'),
        node('last', 'end'),
      ],
      [edge('trigger', 'boom'), edge('boom', 'next'), edge('next', 'last')],
    );

    const { result, events } = await run({ definition: def, triggerInput: null });

    expect(result.status).toBe('failed');
    expect(statusOf(result, 'next')).toBe('skipped');
    expect(statusOf(result, 'last')).toBe('skipped');

    const skipped = typesFor(events, 'node.skipped');
    expect(skipped[0]?.type === 'node.skipped' && skipped[0].payload.reason).toBe('upstream-failed');
    expect(result.error?.message).toContain('boom');
  });

  it('leaves a sibling branch untouched when one branch fails', async () => {
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('boom', 'action', { simulation: { failureProbability: 1 } }),
        node('safe', 'action'),
      ],
      [edge('trigger', 'boom'), edge('trigger', 'safe')],
    );

    const { result } = await run({ definition: def, triggerInput: null });

    expect(statusOf(result, 'safe')).toBe('success');
    expect(result.status).toBe('failed');
  });

  it('keeps the workflow green when the node opts into continueOnError', async () => {
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('optional', 'action', { simulation: { failureProbability: 1, continueOnError: true } }),
        node('next', 'action'),
      ],
      [edge('trigger', 'optional'), edge('optional', 'next')],
    );

    const { result } = await run({ definition: def, triggerInput: null });

    expect(statusOf(result, 'optional')).toBe('failed');
    expect(statusOf(result, 'next')).toBe('success');
    expect(result.status).toBe('success');
  });
});

describe('safety', () => {
  it('stops a cyclic graph at the activation cap instead of hanging', async () => {
    // `a` joins on "any" so the back edge from `b` can actually re-enter it -- which is
    // exactly the runaway-loop shape the anomaly rules are meant to catch.
    const def = definition(
      [node('trigger', 'trigger'), node('a', 'action', { config: { joinMode: 'any' } }), node('b', 'action')],
      [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'a')],
    );

    const { result } = await run({
      definition: def,
      triggerInput: null,
      maxActivations: 20,
      maxActivationsPerNode: 6,
    });

    expect(result.capReached).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.stats.repeatedNodes.a).toBeGreaterThan(1);
    expect(result.records.length).toBeLessThanOrEqual(20);
  });

  it('reports a deadlocked join rather than reporting success', async () => {
    // `a` waits for all inputs, but its second input can only come from its own
    // descendant -- so it can never fire.
    const def = definition(
      [node('trigger', 'trigger'), node('a', 'action'), node('b', 'action')],
      [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'a')],
    );

    const { result } = await run({ definition: def, triggerInput: null });

    expect(result.status).toBe('failed');
    expect(result.deadlockedNodes).toEqual(['a']);
    expect(result.error?.code).toBe('graph_deadlock');
    expect(statusOf(result, 'a')).toBe('skipped');
  });

  it('does not count skipped activations as repeat executions', async () => {
    // A loop whose exit branch is pruned on every pass but the last: `end` is activated
    // three times but only ever *runs* once, so it is not a repeat.
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('work', 'action', { config: { joinMode: 'any' } }),
        node('verdict', 'conditional', { config: { mode: 'probability', probability: 0.5 } }),
        node('end', 'end'),
      ],
      [
        edge('trigger', 'work'),
        edge('work', 'verdict'),
        edge('verdict', 'end', 'true'),
        edge('verdict', 'work', 'false'),
      ],
    );

    // Loop twice (false, false) then exit (true).
    const { result } = await run({
      definition: def,
      triggerInput: null,
      rngs: { branch: scriptedRng([0.9, 0.9, 0.1]) },
    });

    const endRecords = result.records.filter((r) => r.nodeId === 'end');
    expect(endRecords.map((r) => r.status)).toEqual(['skipped', 'skipped', 'success']);

    // `work` genuinely ran three times; `end` ran once and must not be flagged.
    expect(result.stats.repeatedNodes.work).toBe(3);
    expect(result.stats.repeatedNodes.end).toBeUndefined();
  });

  it('counts tool calls for agent-style nodes', async () => {
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('researcher', 'action', { config: { operation: 'research', toolCalls: 3 } }),
        node('coder', 'action', { config: { operation: 'code', toolCalls: 2 } }),
      ],
      [edge('trigger', 'researcher'), edge('trigger', 'coder')],
    );

    const { result } = await run({ definition: def, triggerInput: null });
    expect(result.stats.toolCalls).toBe(5);
  });
});

describe('determinism', () => {
  it('produces identical results for the same seed', async () => {
    const def = definition(
      [
        node('trigger', 'trigger'),
        node('flaky', 'action', { simulation: { failureProbability: 0.4, maxRetries: 2, retryBackoffMs: 0 } }),
        node('branch', 'conditional'),
        node('yes', 'action'),
        node('no', 'action'),
      ],
      [
        edge('trigger', 'flaky'),
        edge('flaky', 'branch'),
        edge('branch', 'yes', 'true'),
        edge('branch', 'no', 'false'),
      ],
    );

    const first = await run({ definition: def, triggerInput: null, seed: 4242 });
    const second = await run({ definition: def, triggerInput: null, seed: 4242 });

    const shape = (r: Awaited<ReturnType<typeof run>>) =>
      r.result.records.map((rec) => `${rec.nodeId}:${rec.status}:${rec.attemptCount}`);

    expect(shape(first)).toEqual(shape(second));
    expect(first.result.status).toBe(second.result.status);
  });
});
