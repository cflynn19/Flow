import { formatDuration, type FlowNodeData } from '@flow/shared';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { memo } from 'react';
import { NODE_KIND_META } from './node-registry';
import type { NodeActivation } from '@/features/execution/execution-state';
import { NODE_STATUS_STYLES } from '@/lib/status';
import { cn } from '@/lib/utils';

export type WorkflowNodeType = Node<
  FlowNodeData & {
    /** Present only while viewing an execution. */
    run?: NodeActivation;
    /** Number of times this node ran in the execution, when more than once. */
    runCount?: number;
  },
  'trigger' | 'action' | 'delay' | 'conditional' | 'parallel' | 'end'
>;

/**
 * One canvas node. The same component renders in the editor and during an execution --
 * the only difference is whether `data.run` is present, which is what makes watching a
 * run feel like watching the thing you built rather than a separate view of it.
 */
export function WorkflowNode({ data, type, selected }: NodeProps<WorkflowNodeType>) {
  const meta = NODE_KIND_META[type];
  const Icon = meta.icon;
  const run = data.run;
  const status = run?.status;
  const style = status ? NODE_STATUS_STYLES[status] : null;
  const isActive = status === 'running' || status === 'retrying';

  return (
    <div
      className={cn(
        'group relative w-[188px] rounded-md border bg-surface-raised transition-all duration-150',
        'shadow-[0_1px_2px_rgba(0,0,0,0.4)]',
        selected ? 'border-accent ring-1 ring-accent/40' : 'border-border',
        style && !selected && style.ring,
        status === 'skipped' && 'opacity-45',
        isActive && 'shadow-[0_0_0_3px_rgba(88,166,255,0.12)]',
      )}
      data-testid={`node-${type}`}
      data-node-label={data.label}
      data-status={status ?? 'idle'}
    >
      {meta.hasInput && (
        <Handle type="target" position={Position.Left} className="!-left-[5px]" />
      )}

      <div className="flex items-start gap-2 px-2.5 py-2">
        <span
          className={cn(
            'mt-px flex size-5 shrink-0 items-center justify-center rounded-xs',
            isActive && 'animate-pulse-ring',
          )}
          style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 16%, transparent)` }}
        >
          <Icon className="size-3" style={{ color: meta.color }} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium leading-tight text-text">
            {data.label}
          </p>
          <p className="mt-0.5 truncate text-[10.5px] uppercase tracking-[0.05em] text-text-subtle">
            {meta.label}
          </p>
        </div>

        {status && (
          <span
            className={cn('mt-px text-[11px] leading-none', style?.text, isActive && 'animate-pulse-ring')}
          >
            {style?.glyph}
          </span>
        )}
      </div>

      {run && (status !== 'pending' || run.attempt > 1) && (
        <div className="flex items-center gap-2 border-t border-border px-2.5 py-1 font-mono text-[10.5px] text-text-subtle tabular">
          <span>{formatDuration(run.durationMs)}</span>
          {run.attempt > 1 && (
            <span className="text-warning">
              {run.attempt}/{run.maxAttempts} attempts
            </span>
          )}
          {data.runCount && data.runCount > 1 && (
            <span className="ml-auto text-warning">×{data.runCount}</span>
          )}
        </div>
      )}

      {meta.branchHandles ? (
        meta.branchHandles.map((handle, index) => (
          <Handle
            key={handle}
            id={handle}
            type="source"
            position={Position.Right}
            style={{ top: index === 0 ? '35%' : '70%' }}
            className={cn(
              '!-right-[5px]',
              handle === 'true' ? '!bg-success' : '!bg-danger',
            )}
          />
        ))
      ) : meta.hasOutput ? (
        <Handle type="source" position={Position.Right} className="!-right-[5px]" />
      ) : null}
    </div>
  );
}

/*
 * Memoised for the execution view, where an event arrives every few milliseconds. With
 * stable node objects from ExecutionPage, a node whose own state did not change skips
 * rendering entirely.
 */
const MemoWorkflowNode = memo(WorkflowNode);

export const nodeTypes = {
  trigger: MemoWorkflowNode,
  action: MemoWorkflowNode,
  delay: MemoWorkflowNode,
  conditional: MemoWorkflowNode,
  parallel: MemoWorkflowNode,
  end: MemoWorkflowNode,
};
