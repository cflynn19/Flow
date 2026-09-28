import type {
  Anomaly,
  Attempt,
  Execution,
  ExecutionEvent,
  ExecutionStats,
  NodeExecution,
  NodeKind,
  NodeStatus,
  Workflow,
} from '@flow/shared';
import type {
  ExecutionEventRow,
  ExecutionRow,
  NodeExecutionRow,
  WorkflowRow,
} from '../db/schema.ts';

/**
 * Row -> DTO conversions. Dates become ISO strings and enum-ish text columns are cast
 * back to their shared union types, so the wire format always matches `@flow/shared`.
 */

export function serializeWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    definition: row.definition,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeExecution(row: ExecutionRow, workflowName: string): Execution {
  return {
    id: row.id,
    seq: row.seq,
    workflowId: row.workflowId,
    workflowName,
    status: row.status as Execution['status'],
    triggerInput: row.triggerInput ?? null,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    error: row.error ?? null,
    stats: (row.stats as ExecutionStats | null) ?? null,
    anomalies: (row.anomalies as Anomaly[]) ?? [],
  };
}

export function serializeNodeExecution(row: NodeExecutionRow): NodeExecution {
  return {
    id: row.id,
    executionId: row.executionId,
    nodeId: row.nodeId,
    nodeKind: row.nodeKind as NodeKind,
    label: row.label,
    status: row.status as NodeStatus,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    attempts: (row.attempts as Attempt[]) ?? [],
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    input: row.input ?? null,
    output: row.output ?? null,
    error: row.error ?? null,
    parentNodeExecutionId: row.parentNodeExecutionId,
    branchDepth: row.branchDepth,
    activationIndex: row.activationIndex,
    toolCalls: row.toolCalls,
  };
}

/**
 * The whole event envelope is stored in the jsonb column; `type`, `node_id`, `seq` and
 * `ts` are also real columns purely so the table stays queryable and ordered. Replaying
 * therefore needs no reassembly -- what we persisted is exactly what we broadcast.
 */
export function serializeEvent(row: ExecutionEventRow): ExecutionEvent {
  return row.payload as ExecutionEvent;
}
