import type { ReactNode } from 'react'
import { cn } from '../lib/utils.js'
import { STATUS_DOT } from '../lib/status-tone.js'
import { inPlace } from '../lib/in-place.js'

// A number that says how things stand, as a part of the Overview's: its name, the number, and
// a line under it. The Overview's own (what needs the person, who is at work) and a package's (the
// queue's: what waits its turn) look the same. A number that is nothing is grey; one with a tone
// (what needs the person) is in it. A tile that leads somewhere is a link (`href`, a page) or a
// button (`onClick`, a part of the page); one that leads nowhere is neither.

/** The ids of the Overview's parts a tile scrolls to. */
export const NEEDS_YOU_ID = 'needs-you'
export const WORKING_ID = 'working-now'

/** Scroll the Overview to one of its parts. */
export function scrollToPart(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function StatTile({ label, value, note, tone, live = false, href, onClick }: { label: string; /** Undefined until it is read: no number then. */ value: number | undefined; note: ReactNode; /** The number's colour while it is not nothing. */ tone?: string | undefined; /** Something is going on: a pulsing dot before the name. */ live?: boolean; href?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {live && (
          <span className="relative flex size-2" aria-hidden>
            <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', STATUS_DOT['running'])} />
            <span className={cn('relative inline-flex size-2 rounded-full', STATUS_DOT['running'])} />
          </span>
        )}
        {label}
      </span>
      {/* A no-break space while there is no number keeps the tile as tall as with one. */}
      <span className={cn('text-2xl font-semibold tabular-nums', !value ? 'text-muted-foreground' : (tone ?? 'text-foreground'))}>{value ?? '\u00a0'}</span>
      <span className="truncate text-xs text-muted-foreground">{note}</span>
    </>
  )
  // No box: a number among the Overview's parts, its press a fill under the pointer, pulled out by its own inset so its words start where a heading does.
  const className = cn(
    '-mx-3 flex min-w-0 flex-col gap-1 rounded-lg px-3 py-2 text-left',
    (href !== undefined || onClick) && 'focus-ring transition-colors hover:bg-accent active:bg-foreground/10',
  )
  if (href !== undefined)
    return (
      <a
        href={href}
        className={className}
        onClick={inPlace(() => onClick?.())}
      >
        {body}
      </a>
    )
  if (onClick)
    return (
      <button type="button" className={className} onClick={onClick}>
        {body}
      </button>
    )
  return <div className={className}>{body}</div>
}
