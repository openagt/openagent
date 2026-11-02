'use client'
import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { cn } from '../../lib/utils.js'

// A two-thumb range slider on Base UI, matching the Checkbox/Tooltip already here (no Radix pulled
// in). Built for the tickets filter's fine-grained 0-10 ranges (#1144); minimal on purpose — one
// value shape (a [min, max] pair), themed with the dashboard's CSS-var tokens.

const THUMB_CLASS =
  'h-3.5 w-3.5 rounded-full border border-primary bg-card shadow-sm outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1'

export function RangeSlider({
  value,
  onValueChange,
  min = 0,
  max = 10,
  className,
  'aria-label': ariaLabel,
}: {
  /** The selected [min, max] pair, both inclusive. */
  value: [number, number]
  onValueChange: (next: [number, number]) => void
  min?: number
  max?: number
  className?: string
  'aria-label'?: string
}) {
  return (
    <SliderPrimitive.Root
      value={value}
      onValueChange={next => {
        // Base UI hands back number | number[]; with two thumbs it is always a pair.
        if (Array.isArray(next) && next.length === 2) onValueChange([next[0]!, next[1]!])
      }}
      min={min}
      max={max}
      step={1}
      className={cn('w-full', className)}
    >
      <SliderPrimitive.Control className="flex w-full touch-none select-none items-center py-1.5">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-[var(--color-muted)]">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb aria-label={ariaLabel ? `${ariaLabel} minimum` : 'Minimum'} className={THUMB_CLASS} />
          <SliderPrimitive.Thumb aria-label={ariaLabel ? `${ariaLabel} maximum` : 'Maximum'} className={THUMB_CLASS} />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}
