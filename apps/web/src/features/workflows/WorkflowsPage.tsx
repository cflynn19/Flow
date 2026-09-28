import { formatDuration, formatRelativeTime } from '@flow/shared';
import { GitBranch, MoreHorizontal, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/States';
import { StatusDot } from '@/components/StatusDot';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiRequestError } from '@/lib/api';
import { useDeleteWorkflow, useRunWorkflow, useWorkflows } from '@/lib/queries';
import { useNow } from '@/lib/useNow';

export function WorkflowsPage() {
  const now = useNow();
  const { data: workflows, isLoading, isError, error, refetch } = useWorkflows();
  const runWorkflow = useRunWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const navigate = useNavigate();
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const run = async (id: string) => {
    try {
      const execution = await runWorkflow.mutateAsync({ id });
      navigate(`/app/workflows/${id}/runs/${execution.id}`);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : 'Could not start the run');
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <header className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[19px] font-semibold tracking-tight text-text">Workflows</h1>
            <p className="mt-0.5 text-[13px] text-text-muted">
              {workflows?.length ?? 0} workflow{workflows?.length === 1 ? '' : 's'}
            </p>
          </div>
          <Button variant="primary" size="sm" asChild>
            <Link to="/app/workflows/new">
              <Plus />
              New workflow
            </Link>
          </Button>
        </header>

        {isLoading && <SkeletonRows rows={4} />}

        {isError && (
          <ErrorState
            title="Could not load workflows"
            message={error instanceof Error ? error.message : undefined}
            onRetry={() => void refetch()}
          />
        )}

        {workflows?.length === 0 && (
          <EmptyState
            icon={<GitBranch />}
            title="No workflows yet"
            description="A workflow is a graph of nodes. Create one, connect a few actions, and run it to see what happens."
            action={
              <Button variant="primary" size="sm" asChild>
                <Link to="/app/workflows/new">Create a workflow</Link>
              </Button>
            }
          />
        )}

        {workflows && workflows.length > 0 && (
          <ul className="overflow-hidden rounded-lg border border-border bg-surface">
            {workflows.map((workflow) => (
              <li
                key={workflow.id}
                className="group flex items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-hover"
              >
                <Link to={`/app/workflows/${workflow.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-text">{workflow.name}</p>
                  <p className="mt-0.5 truncate text-[12px] text-text-muted">
                    {workflow.description || 'No description'}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-text-subtle">
                    {workflow.nodeCount} nodes · {workflow.executionCount} runs · updated{' '}
                    {formatRelativeTime(workflow.updatedAt, now)}
                  </p>
                </Link>

                {workflow.lastExecution && (
                  <Link
                    to={`/app/workflows/${workflow.id}/runs/${workflow.lastExecution.id}`}
                    className="hidden shrink-0 items-center gap-2 rounded-sm px-2 py-1 text-[12px] hover:bg-surface-raised sm:flex"
                  >
                    <StatusDot status={workflow.lastExecution.status} />
                    <span className="font-mono text-text-muted tabular">
                      {formatDuration(workflow.lastExecution.durationMs)}
                    </span>
                    <span className="text-text-subtle">
                      {formatRelativeTime(workflow.lastExecution.startedAt, now)}
                    </span>
                  </Link>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void run(workflow.id)}
                  disabled={runWorkflow.isPending || workflow.nodeCount === 0}
                >
                  <Play />
                  Run
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${workflow.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link to={`/app/workflows/${workflow.id}`}>Open editor</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to={`/app/executions?workflowId=${workflow.id}`}>View history</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      destructive
                      onSelect={() => setPendingDelete({ id: workflow.id, name: workflow.name })}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{pendingDelete?.name}”?</DialogTitle>
            <DialogDescription>
              This also deletes every execution recorded for it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleteWorkflow.isPending}
              onClick={async () => {
                if (!pendingDelete) return;
                try {
                  await deleteWorkflow.mutateAsync(pendingDelete.id);
                  toast.success(`Deleted “${pendingDelete.name}”`);
                } catch (err) {
                  toast.error(err instanceof ApiRequestError ? err.message : 'Could not delete');
                } finally {
                  setPendingDelete(null);
                }
              }}
            >
              Delete workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
