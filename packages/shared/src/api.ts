import { z } from 'zod';
import { executionSchema } from './execution.ts';
import { workflowDefinitionSchema } from './workflow.ts';

/* ---------------------------------------------------------------- auth ---- */

export const registerInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  name: z.string().trim().min(1).max(80),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(200)),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/* ----------------------------------------------------------- workflows ---- */

export const workflowSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  nodeCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  executionCount: z.number().int(),
  lastExecution: executionSchema.pick({ id: true, seq: true, status: true, startedAt: true, durationMs: true }).nullable(),
});
export type WorkflowSummary = z.infer<typeof workflowSummarySchema>;

export const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  definition: workflowDefinitionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Workflow = z.infer<typeof workflowSchema>;

export const createWorkflowInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).nullish(),
  definition: workflowDefinitionSchema.optional(),
});
export type CreateWorkflowInput = z.infer<typeof createWorkflowInputSchema>;

export const updateWorkflowInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullish(),
    definition: workflowDefinitionSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowInputSchema>;

export const executeWorkflowInputSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional(),
  /** Fixing the seed makes a run reproducible -- used by tests and the demo. */
  seed: z.number().int().optional(),
});
export type ExecuteWorkflowInput = z.infer<typeof executeWorkflowInputSchema>;

/* ---------------------------------------------------------- dashboard ---- */

export const dashboardStatsSchema = z.object({
  workflowCount: z.number().int(),
  executionCount: z.number().int(),
  successRate: z.number().min(0).max(1).nullable(),
  avgDurationMs: z.number().int().nullable(),
  failureCount: z.number().int(),
  /** Success/failure counts per day for the trailing fortnight, oldest first. */
  activity: z.array(
    z.object({ date: z.string(), success: z.number().int(), failed: z.number().int() }),
  ),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

/* ------------------------------------------------------------- errors ---- */

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
