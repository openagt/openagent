import type { ReactNode } from 'react'
import { GitMerge } from 'lucide-react'
import { cn } from '../../lib/utils.js'

// What an agent's work is doing, drawn from the logo's hexagon: the one place the knot's hues
// appear in the frame, always beside words (a pill, a row's meta line, a heading), never alone.

/** Where a piece of work stands. */
export type WorkState = 'working' | 'waiting' | 'queued' | 'done' | 'merged' | 'failed' | 'stopped' | 'idle'

const HUE: Record<WorkState, string> = {
  working: 'text-info',
  waiting: 'text-warning',
  done: 'text-faint-foreground',
  merged: 'text-merged',
  failed: 'text-danger',
  queued: 'text-faint-foreground',
  stopped: 'text-faint-foreground',
  idle: 'text-faint-foreground',
}

/** The six corners of a hexagon of radius `r` around the middle of a 16 box, pointing up. */
function hexagon(r: number): string {
  return [-90, -30, 30, 90, 150, 210].map(degrees => `${(8 + r * Math.cos((degrees * Math.PI) / 180)).toFixed(2)},${(8 + r * Math.sin((degrees * Math.PI) / 180)).toFixed(2)}`).join(' ')
}

/**
 * A state's mark. In a list of runs most are done, so colour and motion are kept for the few that
 * are alive or wrong (his pick, 2026-11-24): working and waiting a solid cell that pulses, blue and
 * yellow; done a faint outline; failed a solid cell crossed, in red. Merged is the merge glyph,
 * queued a dashed outline, stopped a small core in an outline, idle an empty outline, a little
 * smaller than done's. Working and waiting share their shape: the colour tells them apart, and the
 * word beside the mark (or its label) says which for a reader who cannot see it. 14 square;
 * `className` sizes it.
 */
export function StateCell({ state, className }: { state: WorkState; className?: string | undefined }) {
  if (state === 'merged') return <GitMerge aria-hidden strokeWidth={2.5} className={cn('size-3.5 shrink-0', HUE[state], className)} />
  const alive = state === 'working' || state === 'waiting'
  const outline = state === 'done' || state === 'queued' || state === 'idle'
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn('size-3.5 shrink-0 overflow-visible', HUE[state], alive && 'motion-safe:animate-pulse', className)}>
      {(outline || state === 'stopped') && (
        <polygon
          points={hexagon(state === 'done' ? 6 : state === 'stopped' ? 6.9 : 5.6)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeDasharray={state === 'queued' ? '2 2' : undefined}
          opacity={state === 'done' ? 0.7 : 1}
        />
      )}
      {!outline && <polygon points={hexagon(state === 'stopped' ? 3 : 5.2)} fill="currentColor" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />}
      {state === 'failed' && <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" className="stroke-card" strokeWidth={1.5} strokeLinecap="round" />}
    </svg>
  )
}

const PILL: Record<WorkState, string> = {
  working: 'bg-info/10 text-info',
  waiting: 'bg-warning/15 text-warning',
  done: 'bg-success/10 text-success',
  merged: 'bg-merged/10 text-merged',
  failed: 'bg-danger/10 text-danger',
  queued: 'bg-accent text-muted-foreground',
  stopped: 'bg-accent text-muted-foreground',
  idle: 'bg-accent text-muted-foreground',
}

/** A state said in words on its own soft fill, its mark before them: "Working · 7m", "Needs you". */
export function StatePill({ state, children, className }: { state: WorkState; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-full pr-2 pl-1.5 text-xs font-medium whitespace-nowrap', PILL[state], className)}>
      {/* In the pill's own colour: a done pill stays green, where a list's done mark is quiet. */}
      <StateCell state={state} className="size-2.5 text-current" />
      {children}
    </span>
  )
}

/** A priority as its short name, "P8": an outlined key, its edge stronger from 8, the urgent end of the scale. */
export function PriorityBadge({ priority, className }: { priority: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-6 shrink-0 items-center justify-center rounded-sm px-1 text-xs font-semibold ring-1 ring-inset',
        priority >= 8 ? 'text-foreground ring-input' : 'text-muted-foreground ring-hairline',
        className,
      )}
    >
      P{priority}
    </span>
  )
}
