import type { ExecutionEvent } from '@flow/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { waitForExecution } from '../engine/runner.ts';
import { definition, edge, node } from '../test/fixtures.ts';
import { createWorkflow, getApp, signUp, truncateAll, type TestClient } from '../test/helpers.ts';

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = await getApp();
  // A real socket, because `inject` cannot exercise a streaming response.
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
});

beforeEach(truncateAll);

/** Reads an SSE body, invoking `onEvent` until it returns true or the stream ends. */
async function readStream(
  url: string,
  cookie: string,
  onEvent: (event: ExecutionEvent) => boolean | void,
  headers: Record<string, string> = {},
): Promise<ExecutionEvent[]> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { cookie, ...headers },
    signal: controller.signal,
  });

  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const received: ExecutionEvent[] = [];
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (!dataLine) continue;

        const event = JSON.parse(dataLine.slice(6)) as ExecutionEvent;
        received.push(event);
        if (onEvent(event) === true) {
          controller.abort();
          return received;
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }

  return received;
}

const graph = () =>
  definition(
    [
      node('trigger', 'trigger', { label: 'Signup' }),
      node('auth', 'action', { label: 'Authenticate', simulation: { minDurationMs: 20, maxDurationMs: 25 } }),
      node('left', 'action', { label: 'Send Email', simulation: { minDurationMs: 20, maxDurationMs: 25 } }),
      node('right', 'action', { label: 'Recommendations', simulation: { minDurationMs: 20, maxDurationMs: 25 } }),
      node('end', 'end', { label: 'End' }),
    ],
    [
      edge('trigger', 'auth'),
      edge('auth', 'left'),
      edge('auth', 'right'),
      edge('left', 'end'),
      edge('right', 'end'),
    ],
  );

async function startRun(client: TestClient): Promise<string> {
  const workflowId = await createWorkflow(client, 'Signup Pipeline', graph());
  const response = await app.inject({
    method: 'POST',
    url: `/workflows/${workflowId}/execute`,
    headers: { cookie: client.cookie },
    payload: {},
  });
  return response.json().execution.id;
}

describe('execution stream', () => {
  it('streams a run live from start to finish', async () => {
    const client = await signUp();
    const executionId = await startRun(client);

    const events = await readStream(
      `${baseUrl}/executions/${executionId}/stream`,
      client.cookie,
      (event) => event.type === 'workflow.completed' || event.type === 'workflow.failed',
    );

    expect(events[0]?.type).toBe('workflow.started');
    expect(events.at(-1)?.type).toBe('workflow.completed');
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.filter((e) => e.type === 'node.started')).toHaveLength(5);
  });

  it('replays a finished run for a client that connects late', async () => {
    const client = await signUp();
    const executionId = await startRun(client);
    await waitForExecution(executionId);

    const events = await readStream(
      `${baseUrl}/executions/${executionId}/stream`,
      client.cookie,
      (event) => event.type === 'workflow.completed',
    );

    expect(events[0]?.type).toBe('workflow.started');
    expect(events.at(-1)?.type).toBe('workflow.completed');
  });

  it('resumes from Last-Event-ID without gaps or duplicates', async () => {
    const client = await signUp();
    const executionId = await startRun(client);

    // Drop the connection partway through, exactly as a browser would on a flaky network.
    const first = await readStream(
      `${baseUrl}/executions/${executionId}/stream`,
      client.cookie,
      (event) => event.type === 'node.completed',
    );
    const lastSeq = first.at(-1)!.seq;

    const second = await readStream(
      `${baseUrl}/executions/${executionId}/stream`,
      client.cookie,
      (event) => event.type === 'workflow.completed' || event.type === 'workflow.failed',
      { 'last-event-id': String(lastSeq) },
    );

    expect(second[0]?.seq).toBe(lastSeq + 1);

    const combined = [...first, ...second].map((e) => e.seq);
    expect(combined).toEqual(combined.map((_, i) => i + 1));
    expect(new Set(combined).size).toBe(combined.length);
  });

  it('refuses to stream another user\'s execution', async () => {
    const owner = await signUp();
    const intruder = await signUp();
    const executionId = await startRun(owner);

    const response = await fetch(`${baseUrl}/executions/${executionId}/stream`, {
      headers: { cookie: intruder.cookie },
    });

    expect(response.status).toBe(404);
    await response.body?.cancel();
    await waitForExecution(executionId);
  });
});
