import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-[11px] font-medium leading-none',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-hover text-text-muted',
        outline: 'border border-border text-text-muted',
        accent: 'bg-accent-muted text-accent',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
