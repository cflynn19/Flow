import type { WorkflowDefinition } from '@flow/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { db } from '../db/client.ts';

let app: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) app = await buildApp();
  return app;
}

/** Specs share one database, so each one starts from a clean slate. */
export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`truncate table execution_events, node_executions, executions, workflows, sessions, users restart identity cascade`,
  );
}

export interface TestClient {
  cookie: string;
  userId: string;
  email: string;
}

let userCounter = 0;

/** Registers a user and returns the session cookie to send on subsequent requests. */
export async function signUp(overrides: { email?: string; password?: string } = {}): Promise<TestClient> {
  userCounter += 1;
  const email = overrides.email ?? `user${userCounter}-${Date.now()}@example.com`;
  const password = overrides.password ?? 'correct-horse-battery';

  const instance = await getApp();
  const response = await instance.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password, name: `User ${userCounter}` },
  });

  if (response.statusCode !== 201) {
    throw new Error(`signUp failed: ${response.statusCode} ${response.body}`);
  }

  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = String(raw).split(';')[0] ?? '';

  return { cookie, userId: response.json().user.id, email };
}

export async function createWorkflow(
  client: TestClient,
  name: string,
  definition: WorkflowDefinition,
): Promise<string> {
  const instance = await getApp();
  const response = await instance.inject({
    method: 'POST',
    url: '/workflows',
    headers: { cookie: client.cookie },
    payload: { name, definition },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createWorkflow failed: ${response.statusCode} ${response.body}`);
  }
  return response.json().workflow.id;
}
