import { Minus, Plus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@openagt/dashboard/module'

/** How many agents a project's batch starts, typed or stepped, from one to `max`: the Queue page's and the card's. */
export function BatchCount({ count, max, onChange }: { count: number; max: number; onChange: (count: number) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<div role="group" aria-label="How many agents to start" className="flex h-7 shrink-0 items-center rounded-md border border-border text-xs tabular-nums" />}>
        <button type="button" aria-label="One agent fewer" disabled={count <= 1} onClick={() => onChange(count - 1)} className="flex h-full w-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40">
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
        <button type="button" aria-label="One agent more" disabled={count >= max} onClick={() => onChange(count + 1)} className="flex h-full w-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40">
          <Plus className="h-3 w-3" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>How many agents to start: one per entry, from the top of the queue.</TooltipContent>
    </Tooltip>
  )
}
