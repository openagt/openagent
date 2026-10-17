import type { ReactNode } from 'react'
import { cn } from '../../lib/utils.js'

// The look of what stands in the rows above and under the message box, as in Claude Code's: plain words with
// an icon, no border, every one the same height and size, muted until pointed at. A class as well
// as a component, so a menu's button is drawn the same way as a word that is only said.
// min-w-0 and overflow-hidden: in a full row an item gives way, and its label is cut short. On a
// phone the row is too narrow for every item cut short to say anything: there each keeps its whole
// width, and the row scrolls sideways (Composer).
export const rowItemClass = 'inline-flex h-8 min-w-0 max-w-full shrink items-center gap-1.5 overflow-hidden rounded-md px-2 text-sm font-normal text-muted-foreground max-sm:max-w-none max-sm:shrink-0'

/** A row item that is a button: it lights up under the pointer and shows the keyboard's focus. */
export const rowButtonClass = cn(
  rowItemClass,
  'transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50',
)

/** A plain row item: an icon and a few words that say one thing. Not a button. */
export function RowItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className={rowItemClass}>
      {icon}
      <span className="truncate">{children}</span>
    </span>
  )
}
