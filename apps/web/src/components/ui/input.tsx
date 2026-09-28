import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-8 w-full rounded-sm border border-border bg-surface px-2.5 text-[13px] text-text',
        'placeholder:text-text-subtle transition-colors',
        'hover:border-border-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/30',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-sm border border-border bg-surface px-2.5 py-2 text-[13px] text-text',
        'placeholder:text-text-subtle transition-colors resize-none',
        'hover:border-border-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
