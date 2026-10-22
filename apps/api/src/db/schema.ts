import type {
  Anomaly,
  Attempt,
  ExecutionStats,
  NodeError,
  WorkflowDefinition,
  WorkflowSource,
} from '@flow/shared';
import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** The opaque token handed to the browser in an httpOnly cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** `external` workflows are reported through the ingest API rather than drawn. */
    source: text('source').$type<WorkflowSource>().notNull().default('editor'),
    definition: jsonb('definition').$type<WorkflowDefinition>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('workflows_user_id_idx').on(t.userId, t.updatedAt.desc()),
    // Reported workflows are addressed by name, so a name must map to exactly one.
    uniqueIndex('workflows_external_name_unique')
      .on(t.userId, t.name)
      .where(sql`${t.source} = 'external'`),
  ],
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Short human-facing run number (#1842) -- stable and sortable. */
    seq: serial('seq').notNull(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    triggerInput: jsonb('trigger_input'),
    /**
     * The graph exactly as it was when this run started. Without it, editing a workflow
     * would retroactively corrupt the rendering of every past execution.
     */
    definitionSnapshot: jsonb('definition_snapshot').$type<WorkflowDefinition>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    error: jsonb('error').$type<NodeError>(),
    stats: jsonb('stats').$type<ExecutionStats>(),
    anomalies: jsonb('anomalies').$type<Anomaly[]>().notNull().default(sql`'[]'::jsonb`),
    /** The reporting app's run id. Null for runs Flow's own engine executed. */
    externalId: text('external_id'),
    /** Last time a reported run heard from its app; drives the idle timeout. */
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
  },
  (t) => [
    index('executions_workflow_idx').on(t.workflowId, t.startedAt.desc()),
    index('executions_user_idx').on(t.userId, t.startedAt.desc()),
    // A run id names one run *of one workflow*: an app may reuse ids across functions.
    uniqueIndex('executions_workflow_external_id_unique').on(t.workflowId, t.externalId),
  ],
);

export const nodeExecutions = pgTable(
  'node_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    nodeKind: text('node_kind').notNull(),
    label: text('label').notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(1),
    /** One record per try -- drives the inspector's attempt timeline. */
    attempts: jsonb('attempts').$type<Attempt[]>().notNull().default(sql`'[]'::jsonb`),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    input: jsonb('input'),
    output: jsonb('output'),
    error: jsonb('error').$type<NodeError>(),
    parentNodeExecutionId: uuid('parent_node_execution_id'),
    branchDepth: integer('branch_depth').notNull().default(0),
    /** Nth activation of this nodeId inside the run. Feeds repeated-execution detection. */
    activationIndex: integer('activation_index').notNull().default(0),
    toolCalls: integer('tool_calls').notNull().default(0),
    /**
     * Start of the attempt in flight. Only reported runs need it: their attempts arrive
     * across separate requests, while the engine times an attempt within one call.
     */
    attemptStartedAt: timestamp('attempt_started_at', { withTimezone: true }),
    /**
     * The parents a reported step named with `after`. Kept so that correcting a graph
     * built from out-of-order events leaves dependencies the app declared alone.
     */
    declaredAfter: jsonb('declared_after').$type<string[]>(),
  },
  (t) => [
    index('node_executions_execution_idx').on(t.executionId),
    index('node_executions_node_idx').on(t.executionId, t.nodeId),
  ],
);

export const executionEvents = pgTable(
  'execution_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    /** Monotonic within an execution; the SSE event id used for Last-Event-ID replay. */
    seq: integer('seq').notNull(),
    nodeId: text('node_id'),
    type: text('type').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [uniqueIndex('execution_events_seq_unique').on(t.executionId, t.seq)],
);

/**
 * Ids of reported events already applied to a run. A client that times out and resends a
 * batch would otherwise record every step in it twice -- and the duplicate start, never
 * completed, would end the run as a spurious "step_unfinished" failure.
 */
export const ingestEventIds = pgTable(
  'ingest_event_ids',
  {
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.executionId, t.eventId] })],
);

/**
 * Credentials for apps that report runs. Only a SHA-256 of the key is stored: the key is
 * random and high-entropy, so a slow hash like bcrypt would add latency to every ingest
 * request without adding any protection.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    prefix: text('prefix').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('api_keys_token_hash_unique').on(t.tokenHash),
    index('api_keys_user_id_idx').on(t.userId),
  ],
);

/* ------------------------------------------------------------ relations ---- */

export const usersRelations = relations(users, ({ many }) => ({
  workflows: many(workflows),
  executions: many(executions),
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  user: one(users, { fields: [workflows.userId], references: [users.id] }),
  executions: many(executions),
}));

export const executionsRelations = relations(executions, ({ one, many }) => ({
  workflow: one(workflows, { fields: [executions.workflowId], references: [workflows.id] }),
  user: one(users, { fields: [executions.userId], references: [users.id] }),
  nodeExecutions: many(nodeExecutions),
  events: many(executionEvents),
}));

export const nodeExecutionsRelations = relations(nodeExecutions, ({ one }) => ({
  execution: one(executions, {
    fields: [nodeExecutions.executionId],
    references: [executions.id],
  }),
}));

export const executionEventsRelations = relations(executionEvents, ({ one }) => ({
  execution: one(executions, {
    fields: [executionEvents.executionId],
    references: [executions.id],
  }),
}));

export type UserRow = typeof users.$inferSelect;
export type WorkflowRow = typeof workflows.$inferSelect;
export type ExecutionRow = typeof executions.$inferSelect;
export type NodeExecutionRow = typeof nodeExecutions.$inferSelect;
export type ExecutionEventRow = typeof executionEvents.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
