import {
  formatDuration,
  formatPercent,
  formatRelativeTime,
  type DashboardStats,
} from '@flow/shared';
import { AlertTriangle, ArrowUpRight, GitBranch, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { StatusDot } from '@/components/StatusDot';
import { Button } from '@/components/ui/button';
import { useExecutions, useStats, useWorkflows } from '@/lib/queries';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const now = useNow();
  const stats = useStats();
  const workflows = useWorkflows();
  const executions = useExecutions({ limit: 12 });

  const failures = (executions.data?.executions ?? []).filter((e) => e.status === 'failed');

  if (stats.isError) {
    return (
      <Page>
        <ErrorState
          title="Could not load your dashboard"
          message={stats.error instanceof Error ? stats.error.message : undefined}
          onRetry={() => void stats.refetch()}
        />
      </Page>
    );
  }

  const isEmpty =
    !workflows.isLoading && (workflows.data?.length ?? 0) === 0;

  return (
    <Page>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-text">Overview</h1>
          <p className="mt-0.5 text-[13px] text-text-muted">
            Every run of every workflow you own.
          </p>
        </div>
        <Button variant="primary" size="sm" asChild>
          <Link to="/app/workflows/new">
            <Plus />
            New workflow
          </Link>
        </Button>
      </header>

      {isEmpty ? (
        <EmptyState
          icon={<GitBranch />}
          title="No workflows yet"
          description="Build a graph of trigger, action and conditional nodes, then run it and watch each node resolve in real time."
          action={
            <Button variant="primary" size="sm" asChild>
              <Link to="/app/workflows/new">Create your first workflow</Link>
            </Button>
          }
        />
      ) : (
        <>
          <StatGrid stats={stats.data} loading={stats.isLoading} />

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Panel
              title="Workflows"
              action={
                <Link
                  to="/app/workflows"
                  className="text-[12px] text-text-subtle transition-colors hover:text-text"
                >
                  All →
                </Link>
              }
            >
              {workflows.isLoading ? (
                <SkeletonRows rows={3} className="p-2" />
              ) : (
                <ul className="divide-y divide-border/60">
                  {workflows.data?.slice(0, 6).map((workflow) => (
                    <li key={workflow.id}>
                      <Link
                        to={`/app/workflows/${workflow.id}`}
                        className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-text">
                            {workflow.name}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-text-subtle">
                            {workflow.nodeCount} nodes · {workflow.executionCount} runs
                          </p>
                        </div>
                        {workflow.lastExecution && (
                          <StatusDot status={workflow.lastExecution.status} />
                        )}
                        <ArrowUpRight className="size-3.5 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Recent executions"
              action={
                <Link
                  to="/app/executions"
                  className="text-[12px] text-text-subtle transition-colors hover:text-text"
                >
                  All →
                </Link>
              }
            >
              {executions.isLoading ? (
                <SkeletonRows rows={5} className="p-2" />
              ) : (
                <ul className="divide-y divide-border/60">
                  {executions.data?.executions.slice(0, 8).map((execution) => (
                    <li key={execution.id}>
                      <Link
                        to={`/app/workflows/${execution.workflowId}/runs/${execution.id}`}
                        className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-hover"
                      >
                        <StatusDot status={execution.status} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                          {execution.workflowName}
                        </span>
                        {execution.anomalies.length > 0 && (
                          <AlertTriangle className="size-3 shrink-0 text-warning" />
                        )}
                        <span className="shrink-0 font-mono text-[12px] text-text-muted tabular">
                          {formatDuration(execution.durationMs)}
                        </span>
                        <span className="hidden w-20 shrink-0 text-right text-[11px] text-text-subtle sm:block">
                          {formatRelativeTime(execution.startedAt, now)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {failures.length > 0 && (
            <Panel title="Recent failures" className="mt-6">
              <ul className="divide-y divide-border/60">
                {failures.slice(0, 5).map((execution) => (
                  <li key={execution.id}>
                    <Link
                      to={`/app/workflows/${execution.workflowId}/runs/${execution.id}`}
                      className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <StatusDot status="failed" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2 text-[13px] text-text">
                          <span className="font-mono text-text-muted">#{execution.seq}</span>
                          {execution.workflowName}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[11.5px] text-danger">
                          {execution.error?.message ?? 'Execution failed'}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-text-subtle">
                        {formatRelativeTime(execution.startedAt, now)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
    </div>
  );
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('overflow-hidden rounded-lg border border-border bg-surface', className)}>
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-subtle">
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function StatGrid({ stats, loading }: { stats?: DashboardStats; loading: boolean }) {
  const items = [
    { label: 'Executions', value: stats ? String(stats.executionCount) : '—' },
    {
      label: 'Success rate',
      value: formatPercent(stats?.successRate),
      tone:
        stats?.successRate !== null && stats?.successRate !== undefined && stats.successRate < 0.8
          ? 'text-warning'
          : undefined,
    },
    { label: 'Avg duration', value: formatDuration(stats?.avgDurationMs) },
    {
      label: 'Failures',
      value: stats ? String(stats.failureCount) : '—',
      tone: stats && stats.failureCount > 0 ? 'text-danger' : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="bg-surface px-4 py-3.5">
          <p className="text-[11px] uppercase tracking-[0.06em] text-text-subtle">{item.label}</p>
          <p
            className={cn(
              'mt-1.5 font-mono text-[22px] font-medium leading-none tabular',
              loading ? 'text-text-subtle' : (item.tone ?? 'text-text'),
            )}
          >
            {loading ? '—' : item.value}
          </p>
        </div>
      ))}
      {stats && stats.activity.length > 0 && (
        <div className="col-span-2 bg-surface px-4 py-3.5 lg:col-span-4">
          <p className="mb-2 text-[11px] uppercase tracking-[0.06em] text-text-subtle">
            Last 14 days
          </p>
          <ActivityChart activity={stats.activity} />
        </div>
      )}
    </div>
  );
}

/** A compact stacked bar per day: success below, failures above. */
function ActivityChart({ activity }: { activity: DashboardStats['activity'] }) {
  const max = Math.max(1, ...activity.map((day) => day.success + day.failed));

  // `items-stretch` plus `h-full` on each column is what gives the bars a definite
  // parent height -- percentage heights inside an auto-height flex item collapse to zero.
  return (
    <div className="flex h-12 items-stretch gap-1">
      {activity.map((day) => {
        const total = day.success + day.failed;
        return (
          <div
            key={day.date}
            className="group relative flex h-full flex-1 flex-col justify-end gap-px"
            title={`${day.date}: ${day.success} succeeded, ${day.failed} failed`}
          >
            {day.failed > 0 && (
              <div
                className="rounded-t-[2px] bg-danger"
                style={{ height: `${(day.failed / max) * 100}%` }}
              />
            )}
            {day.success > 0 && (
              <div
                className={cn('bg-success', day.failed === 0 && 'rounded-t-[2px]')}
                style={{ height: `${(day.success / max) * 100}%` }}
              />
            )}
            {total === 0 && <div className="h-px bg-border/70" />}
          </div>
        );
      })}
    </div>
  );
}
