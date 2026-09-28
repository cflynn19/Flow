import { formatClockTime, type ExecutionEvent } from '@flow/shared';
import { cn } from '@/lib/utils';

const EVENT_STYLE: Record<ExecutionEvent['type'], string> = {
  'workflow.started': 'text-accent',
  'workflow.completed': 'text-success',
  'workflow.failed': 'text-danger',
  'node.started': 'text-running',
  'node.completed': 'text-success',
  'node.failed': 'text-danger',
  'node.retrying': 'text-warning',
  'node.skipped': 'text-skipped',
};

/** The raw event stream, in the order the engine produced it. */
export function EventLog({ events }: { events: ExecutionEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-[13px] text-text-subtle">
        Waiting for the first event…
      </p>
    );
  }

  return (
    <ol className="divide-y divide-border/60 font-mono text-[12px]">
      {events.map((event) => (
        <li
          key={event.seq}
          className="flex items-baseline gap-3 px-4 py-1.5 hover:bg-surface-raised/60"
        >
          <span className="w-8 shrink-0 text-right text-text-subtle tabular">{event.seq}</span>
          <span className="w-24 shrink-0 text-text-subtle tabular">{formatClockTime(event.ts)}</span>
          <span className={cn('w-40 shrink-0', EVENT_STYLE[event.type])}>{event.type}</span>
          <span className="min-w-0 flex-1 truncate text-text-muted">{describe(event)}</span>
        </li>
      ))}
    </ol>
  );
}

function describe(event: ExecutionEvent): string {
  switch (event.type) {
    case 'workflow.started':
      return event.payload.workflowName;
    case 'node.started':
      return `${event.label}${event.payload.attempt > 1 ? ` (attempt ${event.payload.attempt})` : ''}`;
    case 'node.completed':
      return `${event.label} — ${event.payload.durationMs}ms${
        event.payload.branch ? ` → ${event.payload.branch}` : ''
      }`;
    case 'node.failed':
      return `${event.label} — ${event.payload.error.message}`;
    case 'node.retrying':
      return `${event.label} — retrying in ${event.payload.delayMs}ms (attempt ${event.payload.nextAttempt}/${event.payload.maxAttempts})`;
    case 'node.skipped':
      return `${event.label} — ${event.payload.reason.replace(/-/g, ' ')}`;
    case 'workflow.completed':
      return `${event.payload.stats.successCount} succeeded in ${event.payload.durationMs}ms`;
    case 'workflow.failed':
      return event.payload.error?.message ?? 'Execution failed';
  }
}
