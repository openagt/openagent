import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'
import { inPlace } from '../../lib/in-place.js'

/**
 * Rows on the page, no line around them and none between them: each row reaches 12px past the
 * list's edges, so its text starts where the heading above it does and its hover fill runs past
 * the text. `boxed`, for a list in something with no edge of its own to hold it: a line around it.
 */
export function List({ boxed = false, className, ...props }: ComponentProps<'ul'> & { boxed?: boolean | undefined }) {
  return <ul className={cn(boxed ? 'rounded-lg border border-hairline p-1' : '-mx-3', className)} {...props} />
}

// The whole row is the link or the press: the title's box covers the row, so a click anywhere on it,
// a middle click and Ctrl+click too, is the title's. The actions stand above that cover.
const coverClass = 'outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary'

/**
 * One line of a {@link List}: what it is (`leading`), its name, what is said of it, its own presses.
 * With `href` it is a link (a plain click goes through `onClick`, any other is the browser's); with
 * `onClick` alone, a press. The name is cut to the row, and said whole to a screen reader.
 */
export function Row({ leading, title, meta, actions, href, onClick, stackOnPhone = false, className }: {
  leading?: ReactNode
  title: ReactNode
  /** At the right, quieter: an age, a count, a state. */
  meta?: ReactNode
  /** The row's own presses: shown under the pointer and the keyboard, always on touch. */
  actions?: ReactNode
  href?: string
  onClick?: () => void
  /** On a phone, the meta goes under the title, for a row whose two do not fit one line there. */
  stackOnPhone?: boolean | undefined
  className?: string
}) {
  const pressable = href !== undefined || onClick !== undefined
  // Stacked on a phone, the title is a line of its own: it takes the row's width, not its height. Each
  // width's layout is said for its own widths only: a module's stylesheet, loaded later, has its own copy of a plain class.
  const titleClass = cn('min-w-0 truncate text-left font-medium', stackOnPhone ? 'md:flex-1' : 'flex-1')
  return (
    <li
      className={cn(
        'group/row relative flex items-center gap-3 rounded-md px-3 text-sm md:h-10',
        stackOnPhone ? 'max-md:min-h-11 max-md:py-2' : 'max-md:h-11',
        pressable && 'transition-colors hover:bg-accent has-[[data-cover]:active]:bg-foreground/10',
        className,
      )}
    >
      {leading !== undefined && <span className="flex shrink-0 items-center text-muted-foreground">{leading}</span>}
      <span className={cn('flex min-w-0 flex-1 gap-x-3 gap-y-0.5', stackOnPhone ? 'md:items-center max-md:flex-col' : 'items-center')}>
        {href !== undefined ? (
          <a data-cover href={href} onClick={onClick && inPlace(onClick)} className={cn(coverClass, titleClass)}>
            {title}
          </a>
        ) : onClick !== undefined ? (
          <button data-cover type="button" onClick={onClick} className={cn(coverClass, titleClass)}>
            {title}
          </button>
        ) : (
          <span className={titleClass}>{title}</span>
        )}
        {meta !== undefined && <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{meta}</span>}
      </span>
      {actions !== undefined && (
        <span className="relative flex shrink-0 items-center gap-1 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100">{actions}</span>
      )}
    </li>
  )
}
