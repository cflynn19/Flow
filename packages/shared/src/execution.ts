import { z } from 'zod';
import { nodeKindSchema, workflowDefinitionSchema } from './workflow.ts';

export const NODE_STATUSES = ['pending', 'running', 'success', 'failed', 'skipped'] as const;
export const nodeStatusSchema = z.enum(NODE_STATUSES);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export const EXECUTION_STATUSES = ['pending', 'running', 'success', 'failed', 'canceled'] as const;
export const executionStatusSchema = z.enum(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

export const nodeErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
});
export type NodeError = z.infer<typeof nodeErrorSchema>;

/** One try of a single node. The inspector's attempt timeline renders straight off these. */
export const attemptSchema = z.object({
  attempt: z.number().int().min(1),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().int().min(0),
  status: z.enum(['success', 'failed']),
  error: nodeErrorSchema.optional(),
});
export type Attempt = z.infer<typeof attemptSchema>;

export const nodeExecutionSchema = z.object({
  id: z.string(),
  executionId: z.string(),
  nodeId: z.string(),
  nodeKind: nodeKindSchema,
  label: z.string(),
  status: nodeStatusSchema,
  attemptCount: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  attempts: z.array(attemptSchema),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: nodeErrorSchema.nullable(),
  /** Which node activation scheduled this one -- gives the execution a real call tree. */
  parentNodeExecutionId: z.string().nullable(),
  branchDepth: z.number().int().min(0),
  /** Nth time this nodeId ran within the execution (0-based). Feeds loop detection. */
  activationIndex: z.number().int().min(0),
  toolCalls: z.number().int().min(0),
});
export type NodeExecution = z.infer<typeof nodeExecutionSchema>;

/**
 * Aggregate signals captured for every run. Nothing here is interpreted at write time --
 * it is the raw material for the anomaly rules, and later for anything smarter.
 */
export const executionStatsSchema = z.object({
  nodeCount: z.number().int().min(0),
  nodeExecutionCount: z.number().int().min(0),
  successCount: z.number().int().min(0),
  failureCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  totalRetries: z.number().int().min(0),
  toolCalls: z.number().int().min(0),
  maxBranchDepth: z.number().int().min(0),
  /** Highest number of nodes that were in-flight at the same instant. */
  peakParallelism: z.number().int().min(0),
  /** nodeId -> activation count, only for nodes that ran more than once. */
  repeatedNodes: z.record(z.string(), z.number().int()),
  totalDurationMs: z.number().int().min(0),
});
export type ExecutionStats = z.infer<typeof executionStatsSchema>;

export const ANOMALY_RULES = [
  'repeated-node-execution',
  'retries-exhausted',
  'retry-storm',
  'slow-node',
  'slow-workflow',
  'high-skip-ratio',
  'execution-cap-reached',
  'deadlocked-node',
] as const;
export const anomalyRuleSchema = z.enum(ANOMALY_RULES);
export type AnomalyRule = z.infer<typeof anomalyRuleSchema>;

export const anomalySchema = z.object({
  rule: anomalyRuleSchema,
  severity: z.enum(['info', 'warning', 'critical']),
  nodeId: z.string().nullable(),
  title: z.string(),
  detail: z.string(),
  observed: z.string(),
  expected: z.string(),
  causes: z.array(z.string()),
});
export type Anomaly = z.infer<typeof anomalySchema>;

export const executionSchema = z.object({
  id: z.string(),
  /** Short monotonic label shown in the UI, e.g. #1842. */
  seq: z.number().int(),
  workflowId: z.string(),
  workflowName: z.string(),
  status: executionStatusSchema,
  triggerInput: z.unknown().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  error: nodeErrorSchema.nullable(),
  stats: executionStatsSchema.nullable(),
  anomalies: z.array(anomalySchema),
});
export type Execution = z.infer<typeof executionSchema>;

/** Full detail for the execution view: the graph as it was, plus every node result. */
export const executionDetailSchema = executionSchema.extend({
  definitionSnapshot: workflowDefinitionSchema,
  nodeExecutions: z.array(nodeExecutionSchema),
});
export type ExecutionDetail = z.infer<typeof executionDetailSchema>;
