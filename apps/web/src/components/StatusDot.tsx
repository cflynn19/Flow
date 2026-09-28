import type { ExecutionStatus } from '@flow/shared';
import { cn } from '@/lib/utils';
import { EXECUTION_STATUS_STYLES, NODE_STATUS_STYLES, type RunState } from '@/lib/status';

/** The compact status glyph used in tables and lists. */
export function StatusDot({
  status,
  className,
}: {
  status: ExecutionStatus | RunState;
  className?: string;
}) {
  const style =
    status in EXECUTION_STATUS_STYLES
      ? EXECUTION_STATUS_STYLES[status as ExecutionStatus]
      : NODE_STATUS_STYLES[status as RunState];

  return (
    <span
      aria-label={style.label}
      title={style.label}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center text-[11px] leading-none',
        style.text,
        status === 'running' && 'animate-pulse-ring',
        className,
      )}
    >
      {style.glyph}
    </span>
  );
}

export function StatusPill({
  status,
  className,
}: {
  status: ExecutionStatus | RunState;
  className?: string;
}) {
  const style =
    status in EXECUTION_STATUS_STYLES
      ? EXECUTION_STATUS_STYLES[status as ExecutionStatus]
      : NODE_STATUS_STYLES[status as RunState];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xs px-1.5 py-0.5 text-[11px] font-medium leading-none',
        style.chip,
        className,
      )}
    >
      <span className={cn(status === 'running' && 'animate-pulse-ring')}>{style.glyph}</span>
      {style.label}
    </span>
  );
}
