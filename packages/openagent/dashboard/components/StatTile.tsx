import type { ReactNode } from 'react'
import { cn } from '@openagt/skill-ui/module'

// A number that says how things stand, as a small card of the Overview's: its name, the number, and
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

export function StatTile({ label, value, note, tone, live = false, href, onClick }: { label: string; value: number; note: ReactNode; /** The number's colour while it is not nothing. */ tone?: string | undefined; /** Something is going on: a pulsing dot before the name. */ live?: boolean; href?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {live && (
          <span className="relative flex size-2" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
        )}
        {label}
      </span>
      <span className={cn('text-2xl font-semibold tabular-nums', value === 0 ? 'text-muted-foreground' : (tone ?? 'text-foreground'))}>{value}</span>
      <span className="truncate text-xs text-muted-foreground">{note}</span>
    </>
  )
  const className = cn(
    'flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 text-left',
    (href !== undefined || onClick) && 'transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
  )
  if (href !== undefined)
    return (
      <a
        href={href}
        className={className}
        onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          onClick?.()
        }}
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
