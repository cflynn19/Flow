import { formatClockTime, formatDuration, formatRelativeTime } from '@flow/shared';
import { AlertTriangle, History, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { StatusDot } from '@/components/StatusDot';
import { Button } from '@/components/ui/button';
import { useExecutions, useWorkflows } from '@/lib/queries';
import { useNow } from '@/lib/useNow';

/** Every recorded run, newest first. Filterable to a single workflow. */
export function HistoryPage() {
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const workflowId = params.get('workflowId') ?? undefined;

  const { data: workflows } = useWorkflows();
  const { data, isLoading, isError, error, refetch } = useExecutions({
    ...(workflowId ? { workflowId } : {}),
    limit: 50,
  });

  const filteredName = workflows?.find((workflow) => workflow.id === workflowId)?.name;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <header className="mb-5">
          <h1 className="text-[19px] font-semibold tracking-tight text-text">Executions</h1>
          <div className="mt-1 flex items-center gap-2 text-[13px] text-text-muted">
            <span>
              {data ? `${data.total} execution${data.total === 1 ? '' : 's'}` : 'Loading…'}
            </span>
            {workflowId && (
              <button
                type="button"
                onClick={() => setParams({})}
                className="flex items-center gap-1 rounded-xs bg-surface-hover px-1.5 py-0.5 text-[12px] text-text transition-colors hover:bg-surface-raised"
              >
                {filteredName ?? 'Filtered'}
                <X className="size-3" />
              </button>
            )}
          </div>
        </header>

        {isLoading && <SkeletonRows rows={8} />}

        {isError && (
          <ErrorState
            title="Could not load executions"
            message={error instanceof Error ? error.message : undefined}
            onRetry={() => void refetch()}
          />
        )}

        {data?.executions.length === 0 && (
          <EmptyState
            icon={<History />}
            title="No executions yet"
            description="Run a workflow and its execution will appear here with every node result, timing and retry."
            action={
              <Button variant="primary" size="sm" asChild>
                <Link to="/app/workflows">Go to workflows</Link>
              </Button>
            }
          />
        )}

        {data && data.executions.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {/* The column header only makes sense once the grid layout kicks in. */}
            <div className="hidden grid-cols-[auto_5rem_minmax(0,1fr)_6rem_6rem_7rem] items-center gap-3 border-b border-border px-4 py-2 text-[11px] uppercase tracking-[0.06em] text-text-subtle sm:grid">
              <span className="w-4" />
              <span>Run</span>
              <span>Workflow</span>
              <span className="text-right">Duration</span>
              <span className="text-right">Nodes</span>
              <span className="text-right">Started</span>
            </div>

            <ul>
              {data.executions.map((execution) => (
                <li key={execution.id}>
                  <Link
                    to={`/app/workflows/${execution.workflowId}/runs/${execution.id}`}
                    /*
                     * Flex on small screens, grid from `sm` up. A six-column grid at
                     * 390px squeezes the workflow name to zero width, which is the one
                     * column you actually need to read.
                     */
                    className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-surface-hover sm:grid sm:grid-cols-[auto_5rem_minmax(0,1fr)_6rem_6rem_7rem]"
                  >
                    <StatusDot status={execution.status} />
                    <span className="shrink-0 font-mono text-[12.5px] text-text-muted tabular">
                      #{execution.seq}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] text-text">
                          {execution.workflowName}
                        </span>
                        {execution.anomalies.length > 0 && (
                          <span
                            className="flex shrink-0 items-center gap-0.5 text-[11px] text-warning"
                            title={`${execution.anomalies.length} anomalies`}
                          >
                            <AlertTriangle className="size-3" />
                            {execution.anomalies.length}
                          </span>
                        )}
                      </span>
                      {execution.error && (
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-danger">
                          {execution.error.message}
                        </span>
                      )}
                    </span>

                    <span className="shrink-0 text-right font-mono text-[12.5px] text-text-muted tabular">
                      {formatDuration(execution.durationMs)}
                    </span>
                    <span className="hidden text-right font-mono text-[12px] text-text-subtle tabular sm:block">
                      {execution.stats
                        ? `${execution.stats.successCount}/${execution.stats.nodeExecutionCount}`
                        : '—'}
                    </span>
                    <span
                      className="hidden text-right text-[12px] text-text-subtle sm:block"
                      title={formatClockTime(execution.startedAt)}
                    >
                      {formatRelativeTime(execution.startedAt, now)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
