import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The thumb is the element with `role="slider"`, so the accessible name belongs there --
 * on the root it labels a group that assistive tech does not treat as the control.
 */
export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, 'aria-label': ariaLabel, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none select-none items-center', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-[#2c2c34]">
      <SliderPrimitive.Range className="absolute h-full bg-accent" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={ariaLabel}
      className="block size-3.5 rounded-full border-2 border-accent bg-surface-raised transition-colors hover:border-accent-hover focus-visible:outline-none disabled:pointer-events-none"
    />
  </SliderPrimitive.Root>
));
Slider.displayName = 'Slider';
