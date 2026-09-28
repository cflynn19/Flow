import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-text-subtle', className)} />;
}

export function LoadingState({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      className={cn('flex items-center justify-center gap-2 py-16 text-[13px] text-text-subtle', className)}
    >
      <Spinner />
      {label}…
    </div>
  );
}

/** Skeleton rows for lists, so a slow query does not collapse the layout. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-px', className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-11 animate-pulse rounded-sm bg-surface-raised/60"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center',
        className,
      )}
    >
      {icon && <div className="text-text-subtle [&_svg]:size-6">{icon}</div>}
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-text">{title}</p>
        {description && <p className="max-w-sm text-[13px] text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-[#4a2523] bg-danger-muted/40 px-6 py-12 text-center',
        className,
      )}
    >
      <AlertTriangle className="size-5 text-danger" />
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-text">{title}</p>
        {message && <p className="max-w-md text-[13px] text-text-muted">{message}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
