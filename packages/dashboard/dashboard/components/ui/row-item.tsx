import type { ReactElement, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.js'

// The look of what stands in the rows above and under the message box, as in Claude Code's: plain
// words with an icon, no border, every one the same height and size, muted until pointed at. A class
// as well as a component, so a menu's button is drawn the same way as a word that is only said.
// min-w-0 and overflow-hidden: in a full row an item gives way, and its label is cut short. A narrow
// box (a phone, a chat beside panes) says less instead: no chevrons, and the longer labels left to
// their icon (`rowWideClass`). Narrow is the box's own width, its callers' `@container`, not the
// screen's. Each width's size is said for its own widths only: a module's stylesheet, loaded later,
// has its own copy of a plain class, which would win.
export const rowItemClass = 'inline-flex h-7 min-w-0 @xl:max-w-full items-center gap-1.5 overflow-hidden rounded-md px-2 text-sm font-normal text-muted-foreground'

/** A row item that is a button: it lights up under the pointer and shows the keyboard's focus. */
export const rowButtonClass = cn(rowItemClass, 'focus-ring transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50')

/** Words of an item that a narrow box leaves to its icon: still in its accessible name, as its tooltip still says them. */
export const rowWideClass = '@max-xl:sr-only'

/** The chevron of an item that opens a menu: quiet, and left out in a narrow box, where the row has no room for it. */
export function RowChevron() {
  return <ChevronDown className="size-3 shrink-0 text-faint-foreground @max-xl:hidden" aria-hidden />
}

/** A row of items above or under the box: one line of a fixed height, no wrap. */
export const rowClass = 'flex h-8 items-center gap-2'
/** Its left side, the one that gives way: each item cut short. */
export const rowLeftClass = 'flex min-w-0 flex-1 items-center gap-0.5'

/**
 * The row above the box, on both pages: where the agent starts, or where it started. A fixed height
 * and no wrap, so a name that lands late moves nothing; the later items give way first, each cut
 * short, and in a narrow box, where a folder's or a branch's name cut short would say nothing, the
 * row scrolls sideways, its right edge faded to say so.
 */
export function RowAboveBox({ children }: { children: ReactNode }) {
  return (
    <div className={cn('mb-1', rowClass)}>
      <div className={cn(rowLeftClass, '@max-xl:overflow-x-auto @max-xl:[scrollbar-width:none] @max-xl:[mask-image:linear-gradient(to_right,#000_85%,transparent)] @max-xl:*:shrink-0')}>{children}</div>
    </div>
  )
}

/**
 * Words a session keeps from its start, in a row item's look, not a press: the keyboard stops on them
 * and their hover or focus says why they stay; a screen reader hears the words and the why together.
 */
export function RowSaid({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className={cn(rowItemClass, 'focus-ring')} />}>
        {children}
        <span className="sr-only">{`. ${tip}`}</span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A disabled row button and what its hover says. A disabled button takes no pointer, so the hover
 * is on what holds it, which gives way in the row as the button does.
 */
export function RowOff({ tip, children }: { tip: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex min-w-0 @xl:max-w-full" />}>{children}</TooltipTrigger>
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
