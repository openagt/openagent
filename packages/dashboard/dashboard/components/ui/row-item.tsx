import type { ReactElement, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.js'

// The look of what stands in the rows above and under the message box, as in Claude Code's: plain
// words with an icon, no border, every one the same height and size, a little smaller than the
// box's own text, muted until pointed at. A class as well as a component, so a menu's button is
// drawn the same way as a word that is only said.
// min-w-0 and overflow-hidden: in a full row an item gives way, and its label is cut short. In a
// narrow box (a phone, a chat beside panes) the row is too narrow for every item cut short to say
// anything: there each keeps its whole width, and the row scrolls sideways (Composer). Narrow is the
// box's own width, its callers' `@container`, not the screen's. Each width's size is said for its
// own widths only: a module's stylesheet, loaded later, has its own copy of a plain class, which would win.
export const rowItemClass = 'inline-flex h-7 min-w-0 @xl:max-w-full items-center gap-1.5 overflow-hidden rounded-md px-2 text-[13px] font-normal text-muted-foreground @max-xl:max-w-none @max-xl:shrink-0'

/** A row item that is a button: it lights up under the pointer and shows the keyboard's focus. */
export const rowButtonClass = cn(
  rowItemClass,
  'transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50',
)

/** A row of items above or under the box: one line of a fixed height, no wrap. */
export const rowClass = 'flex h-8 items-center gap-2'
/** Its left side, which gives way: each item cut short, and in a narrow box, where cut short they would say nothing, scrolled sideways under a faded edge. */
export const rowLeftClass = 'flex min-w-0 flex-1 items-center gap-0.5 @max-xl:overflow-x-auto @max-xl:[scrollbar-width:none] @max-xl:[mask-image:linear-gradient(to_right,#000_85%,transparent)]'

/**
 * The row above the box, on both pages: where the agent starts, or where it started. A fixed height
 * and no wrap, so a name that lands late moves nothing; the later items give way first, each cut
 * short, and in a narrow box the row scrolls sideways, its right edge faded to say so.
 */
export function RowAboveBox({ children }: { children: ReactNode }) {
  return (
    <div className={cn('mb-1', rowClass)}>
      <div className={rowLeftClass}>{children}</div>
    </div>
  )
}

/**
 * A disabled row button and what its hover says. A disabled button takes no pointer, so the hover
 * is on what holds it, which gives way in the row as the button does.
 */
export function RowOff({ tip, children }: { tip: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex min-w-0 @xl:max-w-full @max-xl:max-w-none @max-xl:shrink-0" />}>{children}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/** A plain row item: an icon and a few words that say one thing. Not a button. */
export function RowItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className={rowItemClass}>
      {icon}
      <span className="truncate">{children}</span>
    </span>
  )
}
