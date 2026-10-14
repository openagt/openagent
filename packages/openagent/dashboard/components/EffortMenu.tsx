import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu.js'

// How hard the model may think, beside the model it belongs to (Claude Code on the web has the
// same two words under its box: "Opus 5.5  Medium"). The levels are the agent's own, read from the
// model it lists them on, so nothing here decides what a level is called or which exist: a model
// that offers none has no control at all.

/**
 * A level as a person reads it: the agent's own word, capitalised. One is spelled out — `xhigh` is
 * the agent's id for it and "Xhigh" is nobody's word — and any level not listed here is shown as
 * the agent writes it, so a new one needs no change to appear.
 */
const SPELLED: Record<string, string> = { xhigh: 'Extra high' }

export function effortLabel(effort: string): string {
  return SPELLED[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
}

export function EffortMenu({
  efforts,
  effort,
  onChange,
  busy = false,
}: {
  /** The levels the picked model offers, in the agent's own order. Empty: no control is shown. */
  efforts: readonly string[]
  /** The level in force, or `undefined` for the agent's own default. */
  effort?: string | undefined
  /** Told the new level, or `undefined` when the pick is cleared back to the agent's default. */
  onChange: (effort: string | undefined) => void
  busy?: boolean
}) {
  if (efforts.length === 0) return null
  // A level the model does not offer is still what a run would be given, so it is said rather than
  // silently read as "default".
  const shown = effort === undefined ? 'Effort' : effortLabel(effort)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={busy}
        aria-label={effort === undefined ? 'Effort: the agent’s default' : `Effort: ${effortLabel(effort)}`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'gap-1 text-muted-foreground')}
      >
        {shown}
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        <DropdownMenuItem onClick={() => onChange(undefined)}>
          <span className="flex-1">The agent’s default</span>
          {effort === undefined && <Check className="h-3.5 w-3.5" aria-hidden />}
        </DropdownMenuItem>
        {efforts.map(level => (
          <DropdownMenuItem key={level} onClick={() => onChange(level)}>
            <span className="flex-1">{effortLabel(level)}</span>
            {effort === level && <Check className="h-3.5 w-3.5" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
