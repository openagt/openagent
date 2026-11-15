import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

// What an agent's work is doing, drawn from the logo's hexagon: the one place the knot's hues
// appear in the frame, always beside words (a pill, a row's meta line, a heading), never alone.

/** Where a piece of work stands. */
export type WorkState = 'working' | 'waiting' | 'queued' | 'done' | 'merged' | 'failed' | 'stopped' | 'idle'

const HUE: Record<WorkState, string> = {
  working: 'text-info',
  waiting: 'text-warning',
  done: 'text-success',
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
 * A state's mark: working and waiting a core in a faint ring (the ring turns while it works), done,
 * merged and failed a solid cell, queued a dashed outline, stopped a small core in an outline, idle an
 * empty outline. 14 square; `className` sizes it.
 */
export function StateCell({ state, className }: { state: WorkState; className?: string }) {
  const ringed = state === 'working' || state === 'waiting'
  const hollow = state === 'queued' || state === 'idle'
  const core = ringed ? 3.6 : state === 'stopped' ? 3 : 5.2
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn('size-3.5 shrink-0 overflow-visible', HUE[state], className)}>
      {(ringed || hollow || state === 'stopped') && (
        <polygon
          points={hexagon(hollow ? 5.6 : 6.9)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeDasharray={state === 'queued' ? '2 2' : undefined}
          opacity={ringed ? 0.4 : 1}
          className={cn(state === 'working' && 'origin-center motion-safe:animate-spin [animation-duration:2s] [transform-box:fill-box]')}
        />
      )}
      {!hollow && <polygon points={hexagon(core)} fill="currentColor" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />}
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
      <StateCell state={state} className="size-2.5" />
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
