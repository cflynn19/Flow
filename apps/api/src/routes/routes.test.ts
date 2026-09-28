import { and, eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.ts';
import { executionEvents, executions } from '../db/schema.ts';
import { reconcileInterruptedExecutions, waitForExecution } from '../engine/runner.ts';
import { definition, edge, node } from '../test/fixtures.ts';
import { createWorkflow, getApp, signUp, truncateAll } from '../test/helpers.ts';

beforeEach(truncateAll);

const simpleGraph = () =>
  definition(
    [
      node('trigger', 'trigger', { label: 'Signup' }),
      node('create', 'action', {
        label: 'Create User',
        config: { operation: 'createUser' },
        simulation: { minDurationMs: 1, maxDurationMs: 2 },
      }),
      node('done', 'end', { label: 'End' }),
    ],
    [edge('trigger', 'create'), edge('create', 'done')],
  );

describe('auth', () => {
  it('registers a user and issues a session cookie', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'Ada@Example.com', password: 'correct-horse', name: 'Ada' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe('ada@example.com');
    expect(String(response.headers['set-cookie'])).toContain('flow_session=');
  });

  it('rejects a duplicate email', async () => {
    const app = await getApp();
    const payload = { email: 'dupe@example.com', password: 'correct-horse', name: 'Dupe' };
    await app.inject({ method: 'POST', url: '/auth/register', payload });
    const second = await app.inject({ method: 'POST', url: '/auth/register', payload });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('conflict');
  });

  it('rejects a short password with field-level detail', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'short@example.com', password: 'abc', name: 'Short' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details[0].path).toBe('password');
  });

  it('rejects a wrong password and an unknown account identically', async () => {
    const app = await getApp();
    await signUp({ email: 'real@example.com', password: 'correct-horse' });

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'real@example.com', password: 'wrong-horse' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ghost@example.com', password: 'correct-horse' },
    });

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it('requires a session for /auth/me and clears it on logout', async () => {
    const app = await getApp();
    const client = await signUp();

    expect((await app.inject({ method: 'GET', url: '/auth/me' })).statusCode).toBe(401);

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: client.cookie } });
    expect(me.statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: client.cookie } });

    const after = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: client.cookie } });
    expect(after.statusCode).toBe(401);
  });
});

describe('workflows', () => {
  it('creates, reads, updates and deletes a workflow', async () => {
    const app = await getApp();
    const client = await signUp();
    const id = await createWorkflow(client, 'Signup Pipeline', simpleGraph());

    const read = await app.inject({ method: 'GET', url: `/workflows/${id}`, headers: { cookie: client.cookie } });
    expect(read.json().workflow.name).toBe('Signup Pipeline');
    expect(read.json().workflow.definition.nodes).toHaveLength(3);

    const updated = await app.inject({
      method: 'PUT',
      url: `/workflows/${id}`,
      headers: { cookie: client.cookie },
      payload: { name: 'Renamed' },
    });
    expect(updated.json().workflow.name).toBe('Renamed');
    expect(updated.json().workflow.definition.nodes).toHaveLength(3);

    const removed = await app.inject({ method: 'DELETE', url: `/workflows/${id}`, headers: { cookie: client.cookie } });
    expect(removed.statusCode).toBe(204);

    const gone = await app.inject({ method: 'GET', url: `/workflows/${id}`, headers: { cookie: client.cookie } });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects a definition whose edge points at a missing node', async () => {
    const app = await getApp();
    const client = await signUp();

    const response = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: { cookie: client.cookie },
      payload: {
        name: 'Broken',
        definition: definition([node('a', 'trigger')], [edge('a', 'ghost')]),
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details[0].message).toContain('does not exist');
  });

  it('hides another user\'s workflow behind a 404', async () => {
    const app = await getApp();
    const owner = await signUp();
    const intruder = await signUp();
    const id = await createWorkflow(owner, 'Private', simpleGraph());

    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/workflows/${id}`,
        headers: { cookie: intruder.cookie },
        payload: method === 'PUT' ? { name: 'Stolen' } : undefined,
      });
      expect(response.statusCode).toBe(404);
    }

    const list = await app.inject({ method: 'GET', url: '/workflows', headers: { cookie: intruder.cookie } });
    expect(list.json().workflows).toHaveLength(0);
  });

  it('summarises workflows with their execution counts', async () => {
    const app = await getApp();
    const client = await signUp();
    const id = await createWorkflow(client, 'Signup Pipeline', simpleGraph());

    const started = await app.inject({
      method: 'POST',
      url: `/workflows/${id}/execute`,
      headers: { cookie: client.cookie },
      payload: {},
    });
    await waitForExecution(started.json().execution.id);

    const list = await app.inject({ method: 'GET', url: '/workflows', headers: { cookie: client.cookie } });
    const summary = list.json().workflows[0];

    expect(summary.nodeCount).toBe(3);
    expect(summary.executionCount).toBe(1);
    expect(summary.lastExecution.status).toBe('success');
  });

  it('refuses to execute a workflow with no nodes', async () => {
    const app = await getApp();
    const client = await signUp();
    const id = await createWorkflow(client, 'Empty', definition([], []));

    const response = await app.inject({
      method: 'POST',
      url: `/workflows/${id}/execute`,
      headers: { cookie: client.cookie },
      payload: {},
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toContain('no nodes');
  });
});

describe('executions', () => {
  it('records the run, its node executions and its ordered event log', async () => {
    const app = await getApp();
    const client = await signUp();
    const workflowId = await createWorkflow(client, 'Signup Pipeline', simpleGraph());

    const started = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/execute`,
      headers: { cookie: client.cookie },
      payload: { input: { email: 'ada@example.com' }, seed: 7 },
    });
    expect(started.statusCode).toBe(202);

    const executionId = started.json().execution.id;
    await waitForExecution(executionId);

    const detail = await app.inject({
      method: 'GET',
      url: `/executions/${executionId}`,
      headers: { cookie: client.cookie },
    });
    const execution = detail.json().execution;

    expect(execution.status).toBe('success');
    expect(execution.durationMs).toBeGreaterThanOrEqual(0);
    expect(execution.nodeExecutions).toHaveLength(3);
    expect(execution.definitionSnapshot.nodes).toHaveLength(3);
    expect(execution.stats.nodeExecutionCount).toBe(3);

    const events = await app.inject({
      method: 'GET',
      url: `/executions/${executionId}/events`,
      headers: { cookie: client.cookie },
    });
    const log = events.json().events;

    expect(log[0].type).toBe('workflow.started');
    expect(log.at(-1).type).toBe('workflow.completed');
    expect(log.map((e: { seq: number }) => e.seq)).toEqual(
      log.map((_: unknown, i: number) => i + 1),
    );
  });

  it('keeps a past execution renderable after the workflow is edited', async () => {
    const app = await getApp();
    const client = await signUp();
    const workflowId = await createWorkflow(client, 'Signup Pipeline', simpleGraph());

    const started = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/execute`,
      headers: { cookie: client.cookie },
      payload: {},
    });
    const executionId = started.json().execution.id;
    await waitForExecution(executionId);

    await app.inject({
      method: 'PUT',
      url: `/workflows/${workflowId}`,
      headers: { cookie: client.cookie },
      payload: { definition: definition([node('only', 'trigger')], []) },
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/executions/${executionId}`,
      headers: { cookie: client.cookie },
    });

    // The snapshot preserves the graph as it was, not the graph as it now is.
    expect(detail.json().execution.definitionSnapshot.nodes).toHaveLength(3);
  });

  it('surfaces retries and failure propagation in the persisted run', async () => {
    const app = await getApp();
    const client = await signUp();
    const workflowId = await createWorkflow(
      client,
      'Flaky',
      definition(
        [
          node('trigger', 'trigger'),
          node('boom', 'action', {
            label: 'Send Email',
            config: { operation: 'sendEmail' },
            simulation: { failureProbability: 1, maxRetries: 2, retryBackoffMs: 0, minDurationMs: 1, maxDurationMs: 1 },
          }),
          node('after', 'action', { simulation: { minDurationMs: 1, maxDurationMs: 1 } }),
        ],
        [edge('trigger', 'boom'), edge('boom', 'after')],
      ),
    );

    const started = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/execute`,
      headers: { cookie: client.cookie },
      payload: {},
    });
    const executionId = started.json().execution.id;
    await waitForExecution(executionId);

    const detail = await app.inject({
      method: 'GET',
      url: `/executions/${executionId}`,
      headers: { cookie: client.cookie },
    });
    const execution = detail.json().execution;
    const nodes = execution.nodeExecutions as { nodeId: string; status: string; attempts: unknown[] }[];

    expect(execution.status).toBe('failed');
    expect(nodes.find((n) => n.nodeId === 'boom')?.attempts).toHaveLength(3);
    expect(nodes.find((n) => n.nodeId === 'after')?.status).toBe('skipped');
    expect(execution.anomalies.some((a: { rule: string }) => a.rule === 'retries-exhausted')).toBe(true);
  });

  it('hides another user\'s execution behind a 404', async () => {
    const app = await getApp();
    const owner = await signUp();
    const intruder = await signUp();
    const workflowId = await createWorkflow(owner, 'Private', simpleGraph());

    const started = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/execute`,
      headers: { cookie: owner.cookie },
      payload: {},
    });
    const executionId = started.json().execution.id;
    await waitForExecution(executionId);

    for (const url of [`/executions/${executionId}`, `/executions/${executionId}/events`]) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie: intruder.cookie } });
      expect(response.statusCode).toBe(404);
    }
  });

  it('closes out a run orphaned by a restart, with a terminal event', async () => {
    const app = await getApp();
    const client = await signUp();
    const workflowId = await createWorkflow(client, 'Orphaned', simpleGraph());

    const started = await app.inject({
      method: 'POST',
      url: `/workflows/${workflowId}/execute`,
      headers: { cookie: client.cookie },
      payload: {},
    });
    const executionId = started.json().execution.id;
    await waitForExecution(executionId);

    // Put the row back into the state a killed process would have left behind.
    await db
      .update(executions)
      .set({ status: 'running', completedAt: null, durationMs: null, error: null })
      .where(eq(executions.id, executionId));
    await db
      .delete(executionEvents)
      .where(
        and(
          eq(executionEvents.executionId, executionId),
          inArray(executionEvents.type, ['workflow.completed', 'workflow.failed']),
        ),
      );

    expect(await reconcileInterruptedExecutions()).toBe(1);

    const detail = await app.inject({
      method: 'GET',
      url: `/executions/${executionId}`,
      headers: { cookie: client.cookie },
    });
    expect(detail.json().execution.status).toBe('failed');
    expect(detail.json().execution.error.code).toBe('interrupted');
    expect(detail.json().execution.durationMs).toBeGreaterThanOrEqual(0);

    /*
     * The terminal event matters as much as the row: the UI derives its state from the
     * event log, so without it the run renders as "Running" forever and the browser
     * reconnects to a stream that will never produce anything.
     */
    const events = await app.inject({
      method: 'GET',
      url: `/executions/${executionId}/events`,
      headers: { cookie: client.cookie },
    });
    const log = events.json().events;
    expect(log.at(-1).type).toBe('workflow.failed');
    expect(log.at(-1).payload.error.code).toBe('interrupted');
    expect(log.map((e: { seq: number }) => e.seq)).toEqual(log.map((_: unknown, i: number) => i + 1));
  });

  it('reports dashboard statistics across runs', async () => {
    const app = await getApp();
    const client = await signUp();
    const workflowId = await createWorkflow(client, 'Signup Pipeline', simpleGraph());

    for (let i = 0; i < 2; i += 1) {
      const started = await app.inject({
        method: 'POST',
        url: `/workflows/${workflowId}/execute`,
        headers: { cookie: client.cookie },
        payload: {},
      });
      await waitForExecution(started.json().execution.id);
    }

    const response = await app.inject({ method: 'GET', url: '/stats', headers: { cookie: client.cookie } });
    const stats = response.json().stats;

    expect(stats.workflowCount).toBe(1);
    expect(stats.executionCount).toBe(2);
    expect(stats.successRate).toBe(1);
    expect(stats.activity).toHaveLength(14);
  });
});
