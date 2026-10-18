import { z } from 'zod';
import { nodeErrorSchema } from './execution.ts';

/**
 * The ingest protocol: how an app that runs its own workflows reports them to Flow.
 *
 * It is deliberately smaller than the engine's event protocol. A caller only says what
 * happened -- "this step started", "that one failed and will be retried" -- and Flow
 * translates that into the full execution event stream, so the canvas, timeline,
 * inspector and anomaly rules work on reported runs exactly as they do on simulated ones.
 *
 * The caller never has to describe the graph up front. Each step becomes a node, and its
 * parents are inferred from timing (see `inferParents` in the API) unless `after` names
 * them explicitly.
 */

/** Reserved for the synthetic node every reported run starts from. */
export const INGEST_START_NODE_ID = '__start';

const stepIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((id) => id !== INGEST_START_NODE_ID, { message: `"${INGEST_START_NODE_ID}" is reserved` });

const envelope = {
  /**
   * The caller's own id for this run. Events sharing a runId belong to one execution, so
   * a run can be reported across as many requests as is convenient.
   */
  runId: z.string().trim().min(1).max(200),
  /** Workflow name. A workflow is created the first time a name is seen. */
  workflow: z.string().trim().min(1).max(120),
  /** When it happened, on the caller's clock. Defaults to the time Flow received it. */
  ts: z.iso.datetime({ offset: true }).optional(),
};

export const ingestRunStartedSchema = z.object({
  ...envelope,
  type: z.literal('run.started'),
  input: z.unknown().optional(),
});

export const ingestStepStartedSchema = z.object({
  ...envelope,
  type: z.literal('step.started'),
  step: stepIdSchema,
  /** Display name. Defaults to the step id. */
  label: z.string().trim().min(1).max(80).optional(),
  input: z.unknown().optional(),
  /** Steps this one depends on. When omitted, they are inferred from timing. */
  after: z.array(stepIdSchema).max(20).optional(),
  /** The caller's retry budget, so "exhausted all attempts" can be detected. */
  maxAttempts: z.number().int().min(1).max(100).optional(),
});

export const ingestStepCompletedSchema = z.object({
  ...envelope,
  type: z.literal('step.completed'),
  step: stepIdSchema,
  output: z.unknown().optional(),
});

export const ingestStepFailedSchema = z.object({
  ...envelope,
  type: z.literal('step.failed'),
  step: stepIdSchema,
  error: nodeErrorSchema,
  /** True when the caller is about to try this step again. */
  willRetry: z.boolean().default(false),
  retryInMs: z.number().int().min(0).max(3_600_000).optional(),
});

export const ingestRunCompletedSchema = z.object({
  ...envelope,
  type: z.literal('run.completed'),
});

export const ingestRunFailedSchema = z.object({
  ...envelope,
  type: z.literal('run.failed'),
  error: nodeErrorSchema.optional(),
});

export const ingestEventSchema = z.discriminatedUnion('type', [
  ingestRunStartedSchema,
  ingestStepStartedSchema,
  ingestStepCompletedSchema,
  ingestStepFailedSchema,
  ingestRunCompletedSchema,
  ingestRunFailedSchema,
]);
export type IngestEvent = z.infer<typeof ingestEventSchema>;

export const ingestBatchSchema = z.object({
  events: z.array(ingestEventSchema).min(1).max(500),
});
export type IngestBatch = z.infer<typeof ingestBatchSchema>;

export const ingestResultSchema = z.object({
  accepted: z.number().int(),
  /** Events that could not be applied, e.g. anything arriving after its run finished. */
  ignored: z.number().int(),
  runs: z.array(z.object({ runId: z.string(), executionId: z.string(), status: z.string() })),
  warnings: z.array(z.string()),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

/* ------------------------------------------------------------ api keys ---- */

export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The first characters of the key, so a user can tell their keys apart. */
  prefix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;
