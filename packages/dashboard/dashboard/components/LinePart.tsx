import type { ReactNode } from 'react'
import { cn } from '../lib/utils.js'
import { STATUS_DOT } from '../lib/status-tone.js'
import { inPlace } from '../lib/in-place.js'

// One part of the line under the Overview's title: how one thing stands, in a few words ("2 need
// you", "nothing queued"), a link to where it is. The Overview's own parts (what needs the person,
// who is at work) and a package's (the queue's: what waits its turn) look the same. A part that leads
// somewhere is a link (`href`, a page) or a button (`onClick`, a part of the page); one that leads
// nowhere is neither.

/** The ids of the Overview's parts a part of the line scrolls to. */
export const NEEDS_YOU_ID = 'needs-you'
export const WORKING_ID = 'working-now'

/** Scroll the Overview to one of its parts. */
export function scrollToPart(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const PRESS = 'focus-ring rounded-sm text-foreground underline-offset-4 hover:underline'

export function LinePart({ children, reading = false, note, live = false, href, onClick }: {
  /** What it says: a count and its words, a nothing said in words. */
  children: ReactNode
  /** Not read yet: its words wait, and a screen reader hears that. */
  reading?: boolean
  /** More of it, on a hover: "1 question, 1 to publish". */
  note?: string | undefined
  /** Something is going on: a dot before the words. */
  live?: boolean
  href?: string
  onClick?: () => void
}) {
  if (reading)
    return (
      <span className="inline-block h-4 w-16 animate-skeleton rounded-md bg-accent align-middle motion-reduce:animate-skeleton-still">
        <span className="sr-only">Loading…</span>
      </span>
    )
  const words = (
    <>
      {live && <span aria-hidden className={cn('mr-1.5 inline-block size-1.5 rounded-full align-middle', STATUS_DOT['running'])} />}
      {children}
    </>
  )
  if (href !== undefined)
    return (
      <a href={href} title={note} className={PRESS} onClick={inPlace(() => onClick?.())}>
        {words}
      </a>
    )
  if (onClick)
    return (
      <button type="button" title={note} className={PRESS} onClick={onClick}>
        {words}
      </button>
    )
  return <span title={note}>{words}</span>
}

/** "1 agent", "2 agents", "no agents": a count said in words, a nothing too. */
export function counted(count: number, one: string, many: string, none: string): string {
  return count === 0 ? none : count === 1 ? `1 ${one}` : `${count} ${many}`
}
