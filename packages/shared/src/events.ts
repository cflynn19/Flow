import { z } from 'zod';
import {
  anomalySchema,
  executionStatsSchema,
  executionStatusSchema,
  nodeErrorSchema,
} from './execution.ts';
import { nodeKindSchema } from './workflow.ts';

/**
 * The live protocol. Every event is persisted with a per-execution `seq` before it is
 * broadcast, so a client that reconnects with `Last-Event-ID` replays exactly the stream
 * it would have seen had it never dropped. The same events also drive the historical
 * view -- one reducer, one rendering path.
 */

export const EXECUTION_EVENT_TYPES = [
  'workflow.started',
  'node.started',
  'node.completed',
  'node.failed',
  'node.retrying',
  'node.skipped',
  'workflow.completed',
  'workflow.failed',
] as const;
export const executionEventTypeSchema = z.enum(EXECUTION_EVENT_TYPES);
export type ExecutionEventType = z.infer<typeof executionEventTypeSchema>;

const envelope = {
  executionId: z.string(),
  seq: z.number().int().min(1),
  ts: z.string(),
};

const nodeEnvelope = {
  ...envelope,
  nodeId: z.string(),
  nodeExecutionId: z.string(),
  label: z.string(),
  nodeKind: nodeKindSchema,
};

export const workflowStartedEventSchema = z.object({
  ...envelope,
  type: z.literal('workflow.started'),
  nodeId: z.null(),
  payload: z.object({
    workflowId: z.string(),
    workflowName: z.string(),
    triggerInput: z.unknown().nullable(),
  }),
});

export const nodeStartedEventSchema = z.object({
  ...nodeEnvelope,
  type: z.literal('node.started'),
  payload: z.object({
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
    input: z.unknown(),
    branchDepth: z.number().int().min(0),
    activationIndex: z.number().int().min(0),
  }),
});

export const nodeCompletedEventSchema = z.object({
  ...nodeEnvelope,
  type: z.literal('node.completed'),
  payload: z.object({
    attempt: z.number().int().min(1),
    durationMs: z.number().int().min(0),
    output: z.unknown(),
    /** Set by conditional nodes: which outgoing handle was taken. */
    branch: z.string().nullish(),
  }),
});

export const nodeFailedEventSchema = z.object({
  ...nodeEnvelope,
  type: z.literal('node.failed'),
  payload: z.object({
    attempt: z.number().int().min(1),
    durationMs: z.number().int().min(0),
    error: nodeErrorSchema,
    retriesExhausted: z.boolean(),
  }),
});

export const nodeRetryingEventSchema = z.object({
  ...nodeEnvelope,
  type: z.literal('node.retrying'),
  payload: z.object({
    attempt: z.number().int().min(1),
    nextAttempt: z.number().int().min(2),
    maxAttempts: z.number().int().min(1),
    delayMs: z.number().int().min(0),
    error: nodeErrorSchema,
  }),
});

export const nodeSkippedEventSchema = z.object({
  ...nodeEnvelope,
  type: z.literal('node.skipped'),
  payload: z.object({
    reason: z.enum(['branch-not-taken', 'upstream-failed', 'upstream-skipped']),
  }),
});

const terminalPayload = z.object({
  status: executionStatusSchema,
  durationMs: z.number().int().min(0),
  stats: executionStatsSchema,
  anomalies: z.array(anomalySchema),
  error: nodeErrorSchema.nullable(),
});

export const workflowCompletedEventSchema = z.object({
  ...envelope,
  type: z.literal('workflow.completed'),
  nodeId: z.null(),
  payload: terminalPayload,
});

export const workflowFailedEventSchema = z.object({
  ...envelope,
  type: z.literal('workflow.failed'),
  nodeId: z.null(),
  payload: terminalPayload,
});

export const executionEventSchema = z.discriminatedUnion('type', [
  workflowStartedEventSchema,
  nodeStartedEventSchema,
  nodeCompletedEventSchema,
  nodeFailedEventSchema,
  nodeRetryingEventSchema,
  nodeSkippedEventSchema,
  workflowCompletedEventSchema,
  workflowFailedEventSchema,
]);
export type ExecutionEvent = z.infer<typeof executionEventSchema>;
export type NodeEvent = Extract<ExecutionEvent, { nodeId: string }>;

export function isTerminalEvent(event: ExecutionEvent): boolean {
  return event.type === 'workflow.completed' || event.type === 'workflow.failed';
}
