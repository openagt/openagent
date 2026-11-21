import type { HTMLAttributes } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '../../lib/utils.js'

/** A step: 28 square, and on a phone a finger's 44: 44 wide, its press reaching 8 past its own top and bottom. */
const STEP =
  'focus-ring-inset relative flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground active:bg-foreground/10 disabled:pointer-events-none disabled:opacity-40 max-md:w-11 max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-2'

/**
 * A whole number from `min` to `max`, typed or stepped, with what it counts after it ("2 agents"): a
 * soft-filled segment that stands joined to the press it qualifies (a `ButtonGroup`'s first part).
 * The rest of its props go to the segment, so it can be a tooltip's trigger.
 */
export function Stepper({ value, min = 1, max, unit, label, fewer, more, onChange, className, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value: number
  min?: number
  max: number
  /** What the number counts, after it, quieter. */
  unit?: string
  /** The number's name, said by the box alone. */
  label: string
  /** The steps' names: "One agent fewer". */
  fewer: string
  more: string
  onChange: (value: number) => void
  className?: string
}) {
  return (
    <div {...props} className={cn('flex h-8 shrink-0 items-center rounded-md bg-accent px-0.5 text-sm tabular-nums', className)}>
      <button type="button" aria-label={fewer} disabled={value <= min} onClick={() => onChange(value - 1)} className={STEP}>
        <Minus className="size-3.5" aria-hidden />
      </button>
      <label className="flex h-full items-center gap-1 px-1 text-muted-foreground">
        <input
          name="count"
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-label={label}
          onChange={event => {
            // An emptied box is mid-edit rather than a number: `Number('')` is 0.
            const typed = event.target.value.trim()
            if (!typed) return
            const next = Math.round(Number(typed))
            if (Number.isFinite(next)) onChange(next)
          }}
          style={{ width: `${String(value).length + 0.5}ch` }}
          className="focus-ring-field h-6 [appearance:textfield] rounded-sm bg-transparent text-center font-semibold text-foreground [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {unit !== undefined && <span aria-hidden>{unit}</span>}
      </label>
      <button type="button" aria-label={more} disabled={value >= max} onClick={() => onChange(value + 1)} className={STEP}>
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
