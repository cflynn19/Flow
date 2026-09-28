import type { ExecutionEvent } from '@flow/shared';
import { describe, expect, it } from 'vitest';
import { executionReducer, reduceEvents } from './execution-state';

let seq = 0;
const next = () => (seq += 1);

const started = (): ExecutionEvent => ({
  type: 'workflow.started',
  executionId: 'exec-1',
  seq: next(),
  ts: '2026-01-01T10:00:00.000Z',
  nodeId: null,
  payload: { workflowId: 'wf-1', workflowName: 'Signup Pipeline', triggerInput: null },
});

const nodeStarted = (attempt = 1, ts = '2026-01-01T10:00:00.100Z'): ExecutionEvent => ({
  type: 'node.started',
  executionId: 'exec-1',
  seq: next(),
  ts,
  nodeId: 'sendEmail',
  nodeExecutionId: 'ne-1',
  label: 'Send Email',
  nodeKind: 'action',
  payload: { attempt, maxAttempts: 3, input: { email: 'ada@example.com' }, branchDepth: 1, activationIndex: 0 },
});

const nodeFailed = (attempt: number, retriesExhausted: boolean, ts: string): ExecutionEvent => ({
  type: 'node.failed',
  executionId: 'exec-1',
  seq: next(),
  ts,
  nodeId: 'sendEmail',
  nodeExecutionId: 'ne-1',
  label: 'Send Email',
  nodeKind: 'action',
  payload: { attempt, durationMs: 504, error: { message: 'SMTP timeout' }, retriesExhausted },
});

const nodeRetrying = (attempt: number, ts: string): ExecutionEvent => ({
  type: 'node.retrying',
  executionId: 'exec-1',
  seq: next(),
  ts,
  nodeId: 'sendEmail',
  nodeExecutionId: 'ne-1',
  label: 'Send Email',
  nodeKind: 'action',
  payload: {
    attempt,
    nextAttempt: attempt + 1,
    maxAttempts: 3,
    delayMs: 150,
    error: { message: 'SMTP timeout' },
  },
});

const nodeCompleted = (attempt: number, ts: string): ExecutionEvent => ({
  type: 'node.completed',
  executionId: 'exec-1',
  seq: next(),
  ts,
  nodeId: 'sendEmail',
  nodeExecutionId: 'ne-1',
  label: 'Send Email',
  nodeKind: 'action',
  payload: { attempt, durationMs: 231, output: { messageId: 'abc123' }, branch: null },
});

describe('executionReducer', () => {
  it('walks a node through running -> failed -> retrying -> success', () => {
    seq = 0;
    const state = reduceEvents([
      started(),
      nodeStarted(1),
      nodeFailed(1, false, '2026-01-01T10:00:00.604Z'),
      nodeRetrying(1, '2026-01-01T10:00:00.605Z'),
      nodeStarted(2, '2026-01-01T10:00:00.755Z'),
      nodeCompleted(2, '2026-01-01T10:00:00.986Z'),
    ]);

    const node = state.byNodeId.sendEmail!;
    expect(node.status).toBe('success');
    expect(node.attempt).toBe(2);
    expect(node.attempts.map((a) => a.status)).toEqual(['failed', 'success']);
    expect(node.output).toEqual({ messageId: 'abc123' });
    // The bar spans both attempts, not just the successful one.
    expect(node.durationMs).toBe(886);
  });

  it('clears the node error once a retry succeeds', () => {
    seq = 0;
    const state = reduceEvents([
      started(),
      nodeStarted(1),
      nodeFailed(1, false, '2026-01-01T10:00:00.604Z'),
      nodeRetrying(1, '2026-01-01T10:00:00.605Z'),
      nodeStarted(2, '2026-01-01T10:00:00.755Z'),
      nodeCompleted(2, '2026-01-01T10:00:00.986Z'),
    ]);

    const node = state.byNodeId.sendEmail!;
    // The node succeeded, so it must not still be labelled with an error -- the failed
    // attempt lives on in the attempt history instead.
    expect(node.error).toBeNull();
    expect(node.attempts[0]?.error?.message).toBe('SMTP timeout');
  });

  it('marks a node failed only once its retries are exhausted', () => {
    seq = 0;
    const midway = reduceEvents([
      started(),
      nodeStarted(1),
      nodeFailed(1, false, '2026-01-01T10:00:00.604Z'),
    ]);
    expect(midway.byNodeId.sendEmail!.status).toBe('running');

    seq = 0;
    const exhausted = reduceEvents([
      started(),
      nodeStarted(1),
      nodeFailed(1, true, '2026-01-01T10:00:00.604Z'),
    ]);
    expect(exhausted.byNodeId.sendEmail!.status).toBe('failed');
    expect(exhausted.byNodeId.sendEmail!.error?.message).toBe('SMTP timeout');
  });

  it('ignores events it has already applied', () => {
    seq = 0;
    const events = [started(), nodeStarted(1)];
    const state = reduceEvents([...events, ...events]);

    expect(state.events).toHaveLength(2);
    expect(state.activations).toHaveLength(1);
  });

  it('keeps every activation of a looping node but shows the latest on the canvas', () => {
    seq = 0;
    const activation = (id: string, index: number, ts: string): ExecutionEvent[] => [
      {
        type: 'node.started',
        executionId: 'exec-1',
        seq: next(),
        ts,
        nodeId: 'coder',
        nodeExecutionId: id,
        label: 'Code Agent',
        nodeKind: 'action',
        payload: { attempt: 1, maxAttempts: 1, input: {}, branchDepth: 1, activationIndex: index },
      },
      {
        type: 'node.completed',
        executionId: 'exec-1',
        seq: next(),
        ts,
        nodeId: 'coder',
        nodeExecutionId: id,
        label: 'Code Agent',
        nodeKind: 'action',
        payload: { attempt: 1, durationMs: 400, output: { pass: index }, branch: null },
      },
    ];

    const state = reduceEvents([
      started(),
      ...activation('ne-a', 0, '2026-01-01T10:00:01.000Z'),
      ...activation('ne-b', 1, '2026-01-01T10:00:02.000Z'),
    ]);

    expect(state.activations.filter((a) => a.nodeId === 'coder')).toHaveLength(2);
    expect(state.byNodeId.coder!.output).toEqual({ pass: 1 });
  });

  it('keeps object identity for activations an event did not touch', () => {
    /*
     * The execution canvas caches a React Flow node per id and rebuilds it only when its
     * activation object changes. That optimisation is what took node renders from ~7,500
     * to ~170 on a 51-node run, and it depends entirely on this reducer not cloning
     * activations it had no reason to touch.
     */
    seq = 0;
    const before = reduceEvents([started(), nodeStarted(1)]);
    const untouched = before.byNodeId.sendEmail!;

    const after = executionReducer(before, {
      type: 'node.started',
      executionId: 'exec-1',
      seq: next(),
      ts: '2026-01-01T10:00:02.000Z',
      nodeId: 'other',
      nodeExecutionId: 'ne-other',
      label: 'Other Node',
      nodeKind: 'action',
      payload: { attempt: 1, maxAttempts: 1, input: {}, branchDepth: 0, activationIndex: 0 },
    });

    expect(after.byNodeId.sendEmail).toBe(untouched);
    expect(after.byNodeId.other).toBeDefined();
  });

  it('records the terminal summary of a run', () => {
    seq = 0;
    const state = reduceEvents([
      started(),
      {
        type: 'workflow.failed',
        executionId: 'exec-1',
        seq: next(),
        ts: '2026-01-01T10:00:04.210Z',
        nodeId: null,
        payload: {
          status: 'failed',
          durationMs: 4210,
          error: { message: 'Charge Card: Gateway timeout after 30s' },
          anomalies: [
            {
              rule: 'retries-exhausted',
              severity: 'critical',
              nodeId: 'chargeCard',
              title: 'Charge Card exhausted all 2 attempts',
              detail: 'Gateway timeout after 30s',
              observed: '2 failed attempts',
              expected: 'Success within the retry budget',
              causes: [],
            },
          ],
          stats: {
            nodeCount: 8,
            nodeExecutionCount: 8,
            successCount: 3,
            failureCount: 1,
            skippedCount: 4,
            totalRetries: 1,
            toolCalls: 0,
            maxBranchDepth: 1,
            peakParallelism: 2,
            repeatedNodes: {},
            totalDurationMs: 4210,
          },
        },
      },
    ]);

    expect(state.status).toBe('failed');
    expect(state.durationMs).toBe(4210);
    expect(state.anomalies).toHaveLength(1);
    expect(state.stats?.skippedCount).toBe(4);
  });
});
