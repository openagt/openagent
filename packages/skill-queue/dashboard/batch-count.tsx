import { Minus, Plus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@openagt/dashboard/module'

/** A step of the count: 24 wide, and on a phone 44 by 44, its press reaching 6 past the group's top and bottom. */
const STEP_CLASS = 'relative flex h-full w-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 max-md:w-11 max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-1.5'

/** How many agents a project's batch starts, typed or stepped, from one to `max`: the Queue page's and the card's. `className` sets its height to the press beside it. */
export function BatchCount({ count, max, onChange, className }: { count: number; max: number; onChange: (count: number) => void; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<div role="group" aria-label="How many agents to start" className={cn('flex h-7 shrink-0 items-center rounded-md border border-border text-sm tabular-nums', className)} />}>
        <button type="button" aria-label="One agent fewer" disabled={count <= 1} onClick={() => onChange(count - 1)} className={STEP_CLASS}>
          <Minus className="h-3 w-3" aria-hidden />
        </button>
        <input
          name="agent-count"
          type="number"
          min={1}
          max={max}
          step={1}
          value={count}
          aria-label="How many agents to start"
          onChange={event => {
            // An emptied box is mid-edit rather than a count: `Number('')` is 0.
            const typed = event.target.value.trim()
            if (!typed) return
            const next = Math.round(Number(typed))
            if (Number.isFinite(next)) onChange(next)
          }}
          className="h-full w-7 [appearance:textfield] bg-transparent text-center outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button type="button" aria-label="One agent more" disabled={count >= max} onClick={() => onChange(count + 1)} className={STEP_CLASS}>
          <Plus className="h-3 w-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>How many agents to start: one per entry, from the top of the queue.</TooltipContent>
    </Tooltip>
  )
}
