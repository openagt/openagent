import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/utils.js'
import { inPlace } from '../../lib/in-place.js'

/** Rows in one container: its line around them, none between them. */
export function List({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cn('rounded-lg border border-hairline p-1', className)} {...props} />
}

// The whole row is the link or the press: the title's box covers the row, so a click anywhere on it,
// a middle click and Ctrl+click too, is the title's. The actions stand above that cover.
const coverClass = 'min-w-0 flex-1 truncate text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary'

/**
 * One line of a {@link List}: what it is (`leading`), its name, what is said of it, its own presses.
 * With `href` it is a link (a plain click goes through `onClick`, any other is the browser's); with
 * `onClick` alone, a press. The name is cut to the row, and said whole to a screen reader.
 */
export function Row({ leading, title, meta, actions, href, onClick, className }: {
  leading?: ReactNode
  title: ReactNode
  /** At the right, quieter: an age, a count, a state. */
  meta?: ReactNode
  /** The row's own presses: shown under the pointer and the keyboard, always on touch. */
  actions?: ReactNode
  href?: string
  onClick?: () => void
  className?: string
}) {
  const pressable = href !== undefined || onClick !== undefined
  return (
    <li
      className={cn(
        'group/row relative flex items-center gap-3 rounded-md px-3 text-sm md:h-10 max-md:h-11',
        pressable && 'transition-colors hover:bg-accent has-[[data-cover]:active]:bg-foreground/10',
        className,
      )}
    >
      {leading !== undefined && <span className="flex shrink-0 items-center text-muted-foreground">{leading}</span>}
      {href !== undefined ? (
        <a data-cover href={href} onClick={onClick && inPlace(onClick)} className={cn(coverClass, 'font-medium')}>
          {title}
        </a>
      ) : onClick !== undefined ? (
        <button data-cover type="button" onClick={onClick} className={cn(coverClass, 'font-medium')}>
          {title}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      )}
      {meta !== undefined && <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{meta}</span>}
      {actions !== undefined && (
        <span className="relative flex shrink-0 items-center gap-1 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100">{actions}</span>
      )}
    </li>
  )
}
