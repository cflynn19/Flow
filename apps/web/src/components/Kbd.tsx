import { cn } from '@/lib/utils';

export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-border',
        'bg-surface-raised px-1 font-mono text-[10px] font-medium text-text-subtle',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
