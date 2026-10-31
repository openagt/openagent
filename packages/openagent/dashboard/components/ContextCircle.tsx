import { cn } from '@openagt/skill-ui/module'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// How full the session's context is, as the small circle Claude Code on the web has under its box:
// a ring that fills as the conversation grows. The reading is the last model call's own (what it
// was given, cached part included, plus what it wrote), not a total of the turn's calls, and the
// window is what the coding agent says of the model — Codex says it outright, and for Claude it is
// what `@openagt/agent-driver-claude` knows of the family. Without a window there is no circle: a
// fullness nobody can measure is worse than none. With one and no reading yet the ring is there and
// empty, as Claude Code's is from the session's first frame, rather than appearing mid-turn.

/** A token count as a person reads it: `18.2k`, `184k`, `1.2M`. */
export function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 100_000) return `${Math.round(count / 1_000)}k`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

export function ContextCircle({ used, size }: { used: number; size: number }) {
  if (!(size > 0)) return null
  const part = Math.min(Math.max(used, 0) / size, 1)
  // The ring is drawn as one stroked circle whose dash is the filled part: no arc maths, and it
  // fills clockwise from the top (the -90° turn).
  const r = 5
  const circumference = 2 * Math.PI * r
  const left = Math.round((1 - part) * 100)
  const said = `${tokens(used)} of ${tokens(size)} used · ${left}% of the context left`
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0 items-center px-1" role="img" aria-label={said} />}>
        <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden>
          <circle cx="7" cy="7" r={r} fill="none" strokeWidth="2" className="stroke-muted-foreground/30" />
          <circle
            cx="7"
            cy="7"
            r={r}
            fill="none"
            strokeWidth="2"
            strokeDasharray={`${circumference * part} ${circumference}`}
            transform="rotate(-90 7 7)"
            className={cn('transition-[stroke-dasharray] duration-500', part >= 0.9 ? 'stroke-danger' : part >= 0.75 ? 'stroke-warning' : 'stroke-muted-foreground')}
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent>{said}</TooltipContent>
    </Tooltip>
  )
}
