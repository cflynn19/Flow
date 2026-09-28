import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm text-[13px] font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-[#0b0b12] hover:bg-accent-hover font-semibold',
        secondary:
          'bg-surface-raised text-text border border-border hover:bg-surface-hover hover:border-border-strong',
        ghost: 'text-text-muted hover:bg-surface-hover hover:text-text',
        danger: 'bg-danger-muted text-danger border border-[#5a2926] hover:bg-[#4a2220]',
        link: 'text-accent hover:underline underline-offset-4',
      },
      size: {
        sm: 'h-7 px-2.5 [&_svg]:size-3.5',
        md: 'h-8 px-3 [&_svg]:size-4',
        lg: 'h-9 px-4 text-sm [&_svg]:size-4',
        icon: 'h-7 w-7 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';

export { buttonVariants };
