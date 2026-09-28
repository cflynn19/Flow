import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { executions, workflows, type ExecutionRow, type WorkflowRow } from '../db/schema.ts';
import { notFound } from '../lib/errors.ts';

export const idParamSchema = z.object({ id: z.uuid('Invalid id') });

/**
 * Ownership is enforced in the WHERE clause rather than with a check afterwards, and a
 * miss is reported as 404 so the API never confirms that someone else's id exists.
 */
export async function loadOwnedWorkflow(id: string, userId: string): Promise<WorkflowRow> {
  const [row] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Workflow');
  return row;
}

export async function loadOwnedExecution(
  id: string,
  userId: string,
): Promise<{ execution: ExecutionRow; workflowName: string }> {
  const [row] = await db
    .select({ execution: executions, workflowName: workflows.name })
    .from(executions)
    .innerJoin(workflows, eq(executions.workflowId, workflows.id))
    .where(and(eq(executions.id, id), eq(executions.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Execution');
  return row;
}
