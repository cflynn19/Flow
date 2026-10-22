import {
  INGEST_START_NODE_ID,
  type ExecutionDetail,
  type ExecutionEvent,
  type IngestEvent,
  type Workflow,
} from '@flow/shared';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.ts';
import { executions } from '../db/schema.ts';
import { executionBus } from '../engine/bus.ts';
import { expireIdleExternalRuns } from '../engine/ingest.ts';
import { reconcileInterruptedExecutions } from '../engine/runner.ts';
import { getApp, signUp, truncateAll, type TestClient } from '../test/helpers.ts';

beforeEach(truncateAll);

const T0 = Date.parse('2026-10-01T12:00:00.000Z');
/** Timestamp `ms` after the start of the test run, so timing-based inference is exact. */
const at = (ms: number) => new Date(T0 + ms).toISOString();

/** An ingest event with the run and workflow filled in by `report`. */
type Draft = IngestEvent extends infer E
  ? E extends IngestEvent
    ? Omit<E, 'runId' | 'workflow' | 'willRetry'> & { runId?: string; workflow?: string; willRetry?: boolean }
    : never
  : never;

async function issueKey(client: TestClient): Promise<string> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api-keys',
    headers: { cookie: client.cookie },
    payload: { name: 'Test app' },
  });
  expect(response.statusCode).toBe(201);
  return response.json().key;
}

async function report(key: string, events: Draft[], defaults = { runId: 'run-1', workflow: 'deleteAccount' }) {
  const app = await getApp();
  return app.inject({
    method: 'POST',
    url: '/ingest/events',
    headers: { authorization: `Bearer ${key}` },
    payload: { events: events.map((e) => ({ ...defaults, ...e })) },
  });
}

async function getExecution(client: TestClient, id: string): Promise<ExecutionDetail> {
  const app = await getApp();
  const response = await app.inject({ method: 'GET', url: `/executions/${id}`, headers: { cookie: client.cookie } });
  expect(response.statusCode).toBe(200);
  return response.json().execution;
}

async function getEvents(client: TestClient, id: string): Promise<ExecutionEvent[]> {
  const app = await getApp();
  const response = await app.inject({
    method: 'GET',
    url: `/executions/${id}/events`,
    headers: { cookie: client.cookie },
  });
  return response.json().events;
}

const edgesOf = (detail: ExecutionDetail) =>
  detail.definitionSnapshot.edges.map((e) => `${e.source}->${e.target}`).sort();

describe('ingest auth', () => {
  it('rejects requests without a valid API key', async () => {
    const app = await getApp();
    const client = await signUp();
    const payload = { events: [{ type: 'run.started', runId: 'r', workflow: 'w' }] };

    const none = await app.inject({ method: 'POST', url: '/ingest/events', payload });
    const bogus = await app.inject({
      method: 'POST',
      url: '/ingest/events',
      headers: { authorization: 'Bearer flow_not-a-real-key' },
      payload,
    });
    // A browser session is not an API key.
    const cookie = await app.inject({
      method: 'POST',
      url: '/ingest/events',
      headers: { cookie: client.cookie },
      payload,
    });

    expect(none.statusCode).toBe(401);
    expect(bogus.statusCode).toBe(401);
    expect(cookie.statusCode).toBe(401);
  });

  it('shows a key once, lists only its prefix, and stops accepting it once revoked', async () => {
    const app = await getApp();
    const client = await signUp();
    const key = await issueKey(client);
    expect(key).toMatch(/^flow_/);

    const list = await app.inject({ method: 'GET', url: '/api-keys', headers: { cookie: client.cookie } });
    const [listed] = list.json().apiKeys;
    expect(JSON.stringify(list.json())).not.toContain(key);
    expect(key.startsWith(listed.prefix)).toBe(true);

    expect((await report(key, [{ type: 'run.started' }])).statusCode).toBe(202);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api-keys/${listed.id}`,
      headers: { cookie: client.cookie },
    });
    expect(revoke.statusCode).toBe(204);
    expect((await report(key, [{ type: 'run.started' }])).statusCode).toBe(401);
  });

  it('validates the batch with field-level detail', async () => {
    const key = await issueKey(await signUp());
    const response = await report(key, [{ type: 'step.started' } as Draft]);
    expect(response.statusCode).toBe(422);
    expect(response.json().error.details[0].path).toContain('step');
  });
});

describe('reported runs', () => {
  it('turns a sequential run into an execution with a chained graph', async () => {
    const client = await signUp();
    const key = await issueKey(client);

    const response = await report(key, [
      { type: 'run.started', ts: at(0), input: { userId: 'u1' } },
      { type: 'step.started', step: 'fetch-user', label: 'Fetch user', ts: at(1) },
      { type: 'step.completed', step: 'fetch-user', ts: at(41), output: { friends: 3 } },
      { type: 'step.started', step: 'delete-user', ts: at(42) },
      { type: 'step.completed', step: 'delete-user', ts: at(142) },
      { type: 'run.completed', ts: at(150) },
    ]);

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({ accepted: 6, ignored: 0, runs: [{ runId: 'run-1', status: 'success' }] });

    const detail = await getExecution(client, body.runs[0].executionId);
    expect(detail).toMatchObject({ status: 'success', externalRunId: 'run-1', durationMs: 150 });
    expect(detail.triggerInput).toEqual({ userId: 'u1' });
    expect(edgesOf(detail)).toEqual([`${INGEST_START_NODE_ID}->fetch-user`, 'fetch-user->delete-user']);

    const fetch = detail.nodeExecutions.find((n) => n.nodeId === 'fetch-user')!;
    expect(fetch).toMatchObject({ label: 'Fetch user', status: 'success', durationMs: 40, output: { friends: 3 } });
    expect(detail.stats).toMatchObject({ successCount: 3, failureCount: 0, totalRetries: 0, peakParallelism: 1 });

    // The same gap-free event log the engine writes, so the UI replays it unchanged.
    const events = await getEvents(client, detail.id);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events[0]!.type).toBe('workflow.started');
    expect(events.at(-1)!.type).toBe('workflow.completed');

    const app = await getApp();
    const workflows = await app.inject({ method: 'GET', url: '/workflows', headers: { cookie: client.cookie } });
    expect(workflows.json().workflows).toMatchObject([{ name: 'deleteAccount', source: 'external', executionCount: 1 }]);
  });

  it('infers parallel branches and their join across separate requests', async () => {
    const client = await signUp();
    const key = await issueKey(client);

    await report(key, [
      { type: 'step.started', step: 'prefetch', ts: at(0) },
      { type: 'step.completed', step: 'prefetch', ts: at(10) },
    ]);
    await report(key, [
      { type: 'step.started', step: 'friends', ts: at(11) },
      { type: 'step.started', step: 'partner', ts: at(11) },
    ]);
    await report(key, [
      { type: 'step.completed', step: 'partner', ts: at(30) },
      { type: 'step.completed', step: 'friends', ts: at(50) },
      { type: 'step.started', step: 'delete-user', ts: at(51) },
    ]);
    const last = await report(key, [
      { type: 'step.completed', step: 'delete-user', ts: at(60) },
      { type: 'run.completed', ts: at(61) },
    ]);

    const detail = await getExecution(client, last.json().runs[0].executionId);
    expect(edgesOf(detail)).toEqual([
      `${INGEST_START_NODE_ID}->prefetch`,
      'friends->delete-user',
      'partner->delete-user',
      'prefetch->friends',
      'prefetch->partner',
    ]);
    expect(detail.stats?.peakParallelism).toBe(2);
  });

  it('uses explicit dependencies over inferred ones', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const response = await report(key, [
      { type: 'step.started', step: 'a', ts: at(0) },
      { type: 'step.completed', step: 'a', ts: at(5) },
      { type: 'step.started', step: 'b', ts: at(6) },
      { type: 'step.completed', step: 'b', ts: at(9) },
      // Timing alone would hang this off b.
      { type: 'step.started', step: 'c', ts: at(10), after: ['a'] },
      { type: 'step.completed', step: 'c', ts: at(12) },
      { type: 'run.completed', ts: at(13) },
    ]);
    const detail = await getExecution(client, response.json().runs[0].executionId);
    expect(edgesOf(detail)).toContain('a->c');
    expect(edgesOf(detail)).not.toContain('b->c');
  });

  it('records retries as attempts of one activation', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const timeout = { message: 'ISBNdb timed out', code: 'ETIMEDOUT' };

    const response = await report(key, [
      { type: 'step.started', step: 'lookup', ts: at(0), maxAttempts: 3 },
      { type: 'step.failed', step: 'lookup', ts: at(100), error: timeout, willRetry: true, retryInMs: 50 },
      { type: 'step.started', step: 'lookup', ts: at(150) },
      { type: 'step.failed', step: 'lookup', ts: at(250), error: timeout, willRetry: true },
      { type: 'step.started', step: 'lookup', ts: at(300) },
      { type: 'step.completed', step: 'lookup', ts: at(320) },
      { type: 'run.completed', ts: at(321) },
    ]);

    const detail = await getExecution(client, response.json().runs[0].executionId);
    const lookup = detail.nodeExecutions.filter((n) => n.nodeId === 'lookup');
    expect(lookup).toHaveLength(1);
    expect(lookup[0]).toMatchObject({ status: 'success', attemptCount: 3, maxAttempts: 3, error: null });
    expect(lookup[0]!.attempts.map((a) => [a.status, a.durationMs])).toEqual([
      ['failed', 100],
      ['failed', 100],
      ['success', 20],
    ]);
    expect(detail.stats?.totalRetries).toBe(2);

    const types = (await getEvents(client, detail.id)).map((e) => e.type);
    expect(types.filter((t) => t === 'node.retrying')).toHaveLength(2);
  });

  it('fails the run with the step error when retries are exhausted, and flags it', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const declined = { message: 'Storage delete denied', code: 'storage/unauthorized' };

    const response = await report(key, [
      { type: 'step.started', step: 'sweep-storage', ts: at(0), maxAttempts: 2 },
      { type: 'step.failed', step: 'sweep-storage', ts: at(10), error: declined, willRetry: true },
      { type: 'step.started', step: 'sweep-storage', ts: at(20) },
      { type: 'step.failed', step: 'sweep-storage', ts: at(30), error: declined },
      { type: 'run.failed', ts: at(31) },
    ]);

    const detail = await getExecution(client, response.json().runs[0].executionId);
    expect(detail.status).toBe('failed');
    expect(detail.error).toEqual(declined);
    expect(detail.anomalies.map((a) => a.rule)).toContain('retries-exhausted');
  });

  it('marks a step that never reported back as unfinished, and ignores events after the end', async () => {
    const client = await signUp();
    const key = await issueKey(client);

    const response = await report(key, [
      { type: 'step.started', step: 'hangs', ts: at(0) },
      { type: 'run.completed', ts: at(500) },
      { type: 'step.completed', step: 'hangs', ts: at(600) },
    ]);
    expect(response.json()).toMatchObject({ accepted: 2, ignored: 1 });

    const later = await report(key, [{ type: 'step.started', step: 'late', ts: at(700) }]);
    expect(later.json()).toMatchObject({ accepted: 0, ignored: 1 });

    const detail = await getExecution(client, response.json().runs[0].executionId);
    const hangs = detail.nodeExecutions.find((n) => n.nodeId === 'hangs')!;
    expect(hangs).toMatchObject({ status: 'failed', error: { code: 'step_unfinished' } });
    expect(detail.nodeExecutions.some((n) => n.nodeId === 'late')).toBe(false);
  });

  it('reuses the workflow across runs and grows its graph to cover every path seen', async () => {
    const client = await signUp();
    const key = await issueKey(client);

    await report(key, [
      { type: 'step.started', step: 'a', ts: at(0) },
      { type: 'step.completed', step: 'a', ts: at(1) },
      { type: 'run.completed', ts: at(2) },
    ], { runId: 'first', workflow: 'deleteAccount' });
    await report(key, [
      { type: 'step.started', step: 'b', ts: at(0) },
      { type: 'step.completed', step: 'b', ts: at(1) },
      { type: 'run.completed', ts: at(2) },
    ], { runId: 'second', workflow: 'deleteAccount' });

    const app = await getApp();
    const list = await app.inject({ method: 'GET', url: '/workflows', headers: { cookie: client.cookie } });
    expect(list.json().workflows).toHaveLength(1);

    const workflow: Workflow = (
      await app.inject({ method: 'GET', url: `/workflows/${list.json().workflows[0].id}`, headers: { cookie: client.cookie } })
    ).json().workflow;
    expect(workflow.definition.nodes.map((n) => n.id).sort()).toEqual([INGEST_START_NODE_ID, 'a', 'b'].sort());
  });

  it('keeps runs with the same id separate per account', async () => {
    const alice = await signUp();
    const bob = await signUp();
    const a = await report(await issueKey(alice), [{ type: 'run.started' }]);
    const b = await report(await issueKey(bob), [{ type: 'run.started' }]);

    const aliceRun = a.json().runs[0].executionId;
    expect(aliceRun).not.toBe(b.json().runs[0].executionId);

    const app = await getApp();
    const peek = await app.inject({ method: 'GET', url: `/executions/${aliceRun}`, headers: { cookie: bob.cookie } });
    expect(peek.statusCode).toBe(404);
  });

  it('refuses to run or restructure a reported workflow from Flow itself', async () => {
    const client = await signUp();
    await report(await issueKey(client), [{ type: 'run.started' }]);

    const app = await getApp();
    const list = await app.inject({ method: 'GET', url: '/workflows', headers: { cookie: client.cookie } });
    const id = list.json().workflows[0].id;

    const run = await app.inject({ method: 'POST', url: `/workflows/${id}/execute`, headers: { cookie: client.cookie } });
    const rename = await app.inject({
      method: 'PUT',
      url: `/workflows/${id}`,
      headers: { cookie: client.cookie },
      payload: { name: 'Renamed' },
    });
    const describe = await app.inject({
      method: 'PUT',
      url: `/workflows/${id}`,
      headers: { cookie: client.cookie },
      payload: { description: 'Alexandria account deletion' },
    });

    expect(run.statusCode).toBe(422);
    expect(rename.statusCode).toBe(422);
    expect(describe.statusCode).toBe(200);
  });

  it('broadcasts each batch to live subscribers, continuing the sequence', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const opened = await report(key, [{ type: 'run.started', ts: at(0) }]);
    const executionId = opened.json().runs[0].executionId;

    const received: ExecutionEvent[] = [];
    const unsubscribe = executionBus.subscribe(executionId, (event) => received.push(event));
    await report(key, [
      { type: 'step.started', step: 'a', ts: at(1) },
      { type: 'step.completed', step: 'a', ts: at(2) },
    ]);
    unsubscribe();

    const before = (await getEvents(client, executionId)).length - received.length;
    expect(received.map((e) => e.type)).toEqual(['node.started', 'node.completed']);
    expect(received.map((e) => e.seq)).toEqual([before + 1, before + 2]);
  });
});

describe('delivery edge cases', () => {
  it('skips events whose id was already received, so a resent batch is harmless', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const start: Draft[] = [{ id: 'e1', type: 'step.started', step: 'a', ts: at(0) }];

    await report(key, start);
    const resent = await report(key, start); // the client timed out and tried again
    expect(resent.json()).toMatchObject({ accepted: 0, duplicates: 1 });

    const done = await report(key, [
      { id: 'e2', type: 'step.completed', step: 'a', ts: at(5) },
      { id: 'e2', type: 'step.completed', step: 'a', ts: at(5) },
      { id: 'e3', type: 'run.completed', ts: at(6) },
    ]);
    expect(done.json()).toMatchObject({ accepted: 2, duplicates: 1 });

    const detail = await getExecution(client, done.json().runs[0].executionId);
    expect(detail.status).toBe('success');
    expect(detail.nodeExecutions.filter((n) => n.nodeId === 'a')).toMatchObject([{ status: 'success' }]);
  });

  it('treats the same run id under different workflows as different runs', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const response = await report(key, [
      { type: 'step.started', runId: 'evt-1', workflow: 'deleteAccount', step: 'a', ts: at(0) },
      { type: 'step.started', runId: 'evt-1', workflow: 'addBookByIsbn', step: 'b', ts: at(0) },
    ]);

    const [first, second] = response.json().runs;
    expect(first.executionId).not.toBe(second.executionId);
    const deleteRun = await getExecution(client, first.executionId);
    expect(deleteRun.workflowName).toBe('deleteAccount');
    expect(deleteRun.nodeExecutions.map((n) => n.nodeId)).not.toContain('b');
  });

  it('settles a step left awaiting a retry when the run ends, in the event log too', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const response = await report(key, [
      { type: 'step.started', step: 'x', ts: at(0) },
      { type: 'step.failed', step: 'x', ts: at(10), error: { message: 'boom' }, willRetry: true },
      { type: 'run.failed', ts: at(20) },
    ]);
    const id = response.json().runs[0].executionId;

    // The UI is rebuilt from events, so the last word on the node must be final.
    const last = (await getEvents(client, id)).filter((e) => e.nodeId === 'x').at(-1)!;
    expect(last).toMatchObject({ type: 'node.failed', payload: { attempt: 1, retriesExhausted: true } });

    const x = (await getExecution(client, id)).nodeExecutions.find((n) => n.nodeId === 'x')!;
    expect(x).toMatchObject({ status: 'failed', attemptCount: 1, durationMs: 10 });
    expect(x.attempts).toHaveLength(1);
  });

  it('stops recording new steps at the per-run limit and flags it', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const loop = (from: number): Draft[] =>
      Array.from({ length: 200 }, (_, i) => {
        const t = (from + i) * 2;
        return [
          { type: 'step.started' as const, step: 'item', ts: at(t) },
          { type: 'step.completed' as const, step: 'item', ts: at(t + 1) },
        ];
      }).flat();

    for (let batch = 0; batch < 6; batch += 1) await report(key, loop(batch * 200));
    const done = await report(key, [{ type: 'run.completed', ts: at(10_000) }]);

    const detail = await getExecution(client, done.json().runs[0].executionId);
    // 1000 activations: Start plus 999 of the loop.
    expect(detail.nodeExecutions).toHaveLength(1000);
    expect(detail.anomalies.map((a) => a.rule)).toContain('execution-cap-reached');
  });
});

describe('out-of-order delivery', () => {
  it('fixes the graph when a step result arrives after a later step started', async () => {
    const client = await signUp();
    const key = await issueKey(client);

    // Reported concurrently: b's start overtakes a's completion on the way in.
    await report(key, [{ type: 'step.started', step: 'a', ts: at(0) }]);
    await report(key, [{ type: 'step.started', step: 'b', ts: at(20) }]);
    await report(key, [{ type: 'step.completed', step: 'a', ts: at(10) }]);
    const done = await report(key, [
      { type: 'step.completed', step: 'b', ts: at(30) },
      { type: 'run.completed', ts: at(31) },
    ]);

    const detail = await getExecution(client, done.json().runs[0].executionId);
    expect(edgesOf(detail)).toEqual([`${INGEST_START_NODE_ID}->a`, 'a->b']);
    const a = detail.nodeExecutions.find((n) => n.nodeId === 'a')!;
    const b = detail.nodeExecutions.find((n) => n.nodeId === 'b')!;
    expect(b).toMatchObject({ parentNodeExecutionId: a.id, branchDepth: a.branchDepth + 1 });

    // The edge guessed before a's result arrived never reached the workflow's graph.
    const app = await getApp();
    const workflow: Workflow = (
      await app.inject({ method: 'GET', url: `/workflows/${detail.workflowId}`, headers: { cookie: client.cookie } })
    ).json().workflow;
    const workflowEdges = workflow.definition.edges.map((e) => `${e.source}->${e.target}`).sort();
    expect(workflowEdges).toEqual([`${INGEST_START_NODE_ID}->a`, 'a->b']);
  });

  it('applies a batch in timestamp order when every event has one', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const response = await report(key, [
      { type: 'step.completed', step: 'b', ts: at(30) },
      { type: 'run.completed', ts: at(31) },
      { type: 'step.started', step: 'a', ts: at(0) },
      { type: 'step.started', step: 'b', ts: at(20) },
      { type: 'step.completed', step: 'a', ts: at(10) },
    ]);
    expect(response.json()).toMatchObject({ accepted: 5, ignored: 0, runs: [{ status: 'success' }] });

    const detail = await getExecution(client, response.json().runs[0].executionId);
    expect(edgesOf(detail)).toEqual([`${INGEST_START_NODE_ID}->a`, 'a->b']);
    expect(detail.nodeExecutions.filter((n) => n.nodeId !== INGEST_START_NODE_ID)).toHaveLength(2);
  });

  it('keeps send order for events without timestamps', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    // All four land at the same instant, so only their order says a and b overlapped.
    const response = await report(key, [
      { type: 'step.started', step: 'a' },
      { type: 'step.started', step: 'b' },
      { type: 'step.completed', step: 'a' },
      { type: 'step.completed', step: 'b' },
      { type: 'run.completed' },
    ]);
    const detail = await getExecution(client, response.json().runs[0].executionId);
    expect(edgesOf(detail)).toEqual([`${INGEST_START_NODE_ID}->a`, `${INGEST_START_NODE_ID}->b`]);
  });

  it('leaves declared dependencies alone when correcting the graph', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    await report(key, [
      { type: 'step.started', step: 'a', ts: at(0) },
      { type: 'step.completed', step: 'a', ts: at(5) },
      { type: 'step.started', step: 'b', ts: at(6) },
      { type: 'step.started', step: 'c', ts: at(20), after: ['a'] },
    ]);
    // b finished before c started, but c said it depends on a alone.
    const done = await report(key, [
      { type: 'step.completed', step: 'b', ts: at(10) },
      { type: 'step.completed', step: 'c', ts: at(30) },
      { type: 'run.completed', ts: at(31) },
    ]);
    const detail = await getExecution(client, done.json().runs[0].executionId);
    expect(edgesOf(detail)).toContain('a->c');
    expect(edgesOf(detail)).not.toContain('b->c');
  });
});

describe('failing delivery', () => {
  /** Makes Postgres reject creating the run "boom", the way a real database fault would. */
  async function withRejectedRun(test: () => Promise<void>) {
    await db.execute(sql`
      create or replace function test_reject_boom() returns trigger as $$
      begin
        if new.external_id = 'boom' then raise exception 'simulated database fault'; end if;
        return new;
      end $$ language plpgsql`);
    await db.execute(sql`
      create trigger test_reject_boom before insert on executions
      for each row execute function test_reject_boom()`);
    try {
      await test();
    } finally {
      await db.execute(sql`drop trigger if exists test_reject_boom on executions`);
      await db.execute(sql`drop function if exists test_reject_boom()`);
    }
  }

  it('records the other runs in a batch when one cannot be recorded', async () => {
    const client = await signUp();
    const key = await issueKey(client);

    await withRejectedRun(async () => {
      const response = await report(key, [
        { type: 'run.started', runId: 'ok' },
        { type: 'step.started', runId: 'boom', step: 'a' },
        { type: 'step.completed', runId: 'boom', step: 'a' },
        { type: 'run.completed', runId: 'ok' },
      ]);

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        accepted: 2,
        runs: [{ runId: 'ok', status: 'success' }],
        errors: [{ runId: 'boom', workflow: 'deleteAccount', events: 2 }],
      });
      // Internal details stay in the server log.
      expect(JSON.stringify(response.json())).not.toContain('simulated database fault');

      // Nothing was recorded, so the batch is a failure the client should retry.
      const alone = await report(key, [{ type: 'run.started', runId: 'boom' }]);
      expect(alone.statusCode).toBe(500);
    });

    const app = await getApp();
    const runs = await app.inject({ method: 'GET', url: '/executions', headers: { cookie: client.cookie } });
    expect(runs.json().executions.map((e: { externalRunId: string }) => e.externalRunId)).toEqual(['ok']);
  });

  it('stores NUL characters as the replacement character instead of failing', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const response = await report(key, [
      { type: 'step.started', step: 'a', label: 'Parse\u0000file' },
      { type: 'step.failed', step: 'a', error: { message: 'bad byte \u0000 at 4' } },
      // An escaped backslash before "u0000" is ordinary text, not a NUL.
      { type: 'run.failed', error: { message: 'literal \\u0000 text' } },
    ]);
    expect(response.statusCode).toBe(202);

    const detail = await getExecution(client, response.json().runs[0].executionId);
    const a = detail.nodeExecutions.find((n) => n.nodeId === 'a')!;
    expect(a.label).toBe('Parse�file');
    expect(a.error?.message).toBe('bad byte � at 4');
    expect(detail.error?.message).toBe('literal \\u0000 text');

    // Not just ingest: any JSON body.
    const app = await getApp();
    const created = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { cookie: client.cookie },
      payload: { name: 'Nul\u0000name', description: null, definition: { nodes: [], edges: [] } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().workflow.name).toBe('Nul�name');
  });
});

describe('idle reported runs', () => {
  it('fails a run that stops reporting, and only that one', async () => {
    const client = await signUp();
    const key = await issueKey(client);
    const quiet = await report(key, [{ type: 'step.started', step: 'a', ts: at(0) }], {
      runId: 'quiet',
      workflow: 'deleteAccount',
    });
    const id = quiet.json().runs[0].executionId;

    // A restart must not touch it: the app, not this process, is running it.
    await reconcileInterruptedExecutions();
    expect((await getExecution(client, id)).status).toBe('running');

    expect(await expireIdleExternalRuns(60_000, new Date(Date.now() + 30_000))).toBe(0);
    expect(await expireIdleExternalRuns(60_000, new Date(Date.now() + 120_000))).toBe(1);

    const detail = await getExecution(client, id);
    expect(detail).toMatchObject({ status: 'failed', error: { code: 'timed_out' } });
    const [row] = await db.select().from(executions).where(eq(executions.id, id));
    expect(row?.completedAt).not.toBeNull();
  });
});
