import type { Anomaly, ExecutionStats, WorkflowDefinition } from '@flow/shared';
import type { NodeExecutionRecord } from './scheduler.ts';

/**
 * Deterministic rules only -- no model, no heuristics that need tuning. The point of v1
 * is that the *data* needed for smarter analysis is being captured; these rules just
 * prove it is there and surface the obvious cases.
 */

export interface Baseline {
  /** Median duration per nodeId across recent runs of the same workflow. */
  nodeMedianDurationMs: Record<string, number>;
  workflowAvgDurationMs: number | null;
  /** How many past executions the baseline is drawn from. */
  sampleSize: number;
}

export const EMPTY_BASELINE: Baseline = {
  nodeMedianDurationMs: {},
  workflowAvgDurationMs: null,
  sampleSize: 0,
};

/** Below this we do not trust the baseline enough to call anything slow. */
const MIN_BASELINE_SAMPLES = 3;
const REPEATED_EXECUTION_THRESHOLD = 3;
const RETRY_STORM_THRESHOLD = 5;
const SLOW_NODE_FACTOR = 3;
const SLOW_WORKFLOW_FACTOR = 2;
const SKIP_RATIO_THRESHOLD = 0.4;

export interface AnomalyInput {
  definition: WorkflowDefinition;
  records: NodeExecutionRecord[];
  stats: ExecutionStats;
  totalDurationMs: number;
  capReached: boolean;
  deadlockedNodes: string[];
  baseline: Baseline;
}

export function detectAnomalies(input: AnomalyInput): Anomaly[] {
  const { records, stats, totalDurationMs, capReached, deadlockedNodes, baseline } = input;
  const anomalies: Anomaly[] = [];
  const labelFor = (nodeId: string) =>
    records.find((r) => r.nodeId === nodeId)?.label ?? nodeId;

  if (capReached) {
    anomalies.push({
      rule: 'execution-cap-reached',
      severity: 'critical',
      nodeId: null,
      title: 'Execution stopped at the activation cap',
      detail:
        'The engine refused to schedule further node activations. This almost always means the graph has a cycle with no exit condition.',
      observed: `${stats.nodeExecutionCount} node executions`,
      expected: 'A run that terminates on its own',
      causes: ['cycle without a termination condition', 'conditional that always re-enters a loop'],
    });
  }

  for (const nodeId of deadlockedNodes) {
    anomalies.push({
      rule: 'deadlocked-node',
      severity: 'critical',
      nodeId,
      title: `${labelFor(nodeId)} never received all of its inputs`,
      detail:
        'The node waits for every incoming branch, but at least one branch never produced a result. Set it to "any incoming branch" if it is meant to be a loop entry point.',
      observed: 'Waited indefinitely',
      expected: 'Every incoming branch resolves',
      causes: ['cycle feeding a node that waits for all branches', 'unreachable join', 'edge left connected to a removed path'],
    });
  }

  for (const [nodeId, count] of Object.entries(stats.repeatedNodes)) {
    if (count < REPEATED_EXECUTION_THRESHOLD) continue;
    anomalies.push({
      rule: 'repeated-node-execution',
      severity: count >= REPEATED_EXECUTION_THRESHOLD * 2 ? 'critical' : 'warning',
      nodeId,
      title: `${labelFor(nodeId)} executed ${count} times`,
      detail: `A node that runs repeatedly inside a single execution is usually a loop that is not converging.`,
      observed: `${count} executions`,
      expected: '1-2 executions',
      causes: ['retry loop', 'unexpected branch', 'missing termination condition'],
    });
  }

  for (const record of records) {
    if (record.status !== 'failed' || record.maxAttempts <= 1) continue;
    if (record.attemptCount < record.maxAttempts) continue;
    anomalies.push({
      rule: 'retries-exhausted',
      severity: 'critical',
      nodeId: record.nodeId,
      title: `${record.label} exhausted all ${record.maxAttempts} attempts`,
      detail: record.error?.message ?? 'The node failed on every attempt.',
      observed: `${record.attemptCount} failed attempts`,
      expected: 'Success within the retry budget',
      causes: ['persistently failing dependency', 'retry budget too small', 'non-transient error being retried'],
    });
  }

  if (stats.totalRetries >= RETRY_STORM_THRESHOLD) {
    anomalies.push({
      rule: 'retry-storm',
      severity: 'warning',
      nodeId: null,
      title: `${stats.totalRetries} retries in a single execution`,
      detail: 'Widespread retrying suggests a shared dependency is degraded rather than one node being flaky.',
      observed: `${stats.totalRetries} retries`,
      expected: `Fewer than ${RETRY_STORM_THRESHOLD} retries`,
      causes: ['degraded downstream dependency', 'failure probability configured too high'],
    });
  }

  if (baseline.sampleSize >= MIN_BASELINE_SAMPLES) {
    for (const record of records) {
      const median = baseline.nodeMedianDurationMs[record.nodeId];
      if (!median || median <= 0 || record.durationMs === null) continue;
      if (record.durationMs < median * SLOW_NODE_FACTOR) continue;
      anomalies.push({
        rule: 'slow-node',
        severity: 'warning',
        nodeId: record.nodeId,
        title: `${record.label} took ${Math.round(record.durationMs / median)}x longer than usual`,
        detail: `Typical duration for this node is around ${Math.round(median)}ms.`,
        observed: `${record.durationMs}ms`,
        expected: `~${Math.round(median)}ms`,
        causes: ['slow dependency', 'retry backoff inflating total time', 'larger than usual payload'],
      });
    }

    const avg = baseline.workflowAvgDurationMs;
    if (avg && totalDurationMs > avg * SLOW_WORKFLOW_FACTOR) {
      anomalies.push({
        rule: 'slow-workflow',
        severity: 'info',
        nodeId: null,
        title: 'Execution took much longer than usual',
        detail: `Recent runs of this workflow average ${Math.round(avg)}ms.`,
        observed: `${totalDurationMs}ms`,
        expected: `~${Math.round(avg)}ms`,
        causes: ['a slow node', 'extra retries', 'a longer branch being taken'],
      });
    }
  }

  const skipRatio =
    stats.nodeExecutionCount > 0 ? stats.skippedCount / stats.nodeExecutionCount : 0;
  if (stats.skippedCount >= 2 && skipRatio >= SKIP_RATIO_THRESHOLD) {
    anomalies.push({
      rule: 'high-skip-ratio',
      severity: 'info',
      nodeId: null,
      title: `${stats.skippedCount} of ${stats.nodeExecutionCount} nodes were skipped`,
      detail: 'Most of the graph did not run. Either a branch pruned it or an early failure cut it short.',
      observed: `${Math.round(skipRatio * 100)}% skipped`,
      expected: `Under ${Math.round(SKIP_RATIO_THRESHOLD * 100)}% skipped`,
      causes: ['early node failure', 'conditional pruning a large branch'],
    });
  }

  return anomalies;
}
