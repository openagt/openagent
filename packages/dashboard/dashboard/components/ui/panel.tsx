import { Fragment, useId, type ReactNode } from 'react'
import { cn } from '../../lib/utils.js'
import { inPlace } from '../../lib/in-place.js'
import { Card } from './card.js'
import { useHeadingTag } from './section.js'

/** Rows held as one object: a card whose rows reach its edges, a hairline between them. */
export function Panel({ className, children, ...props }: { className?: string; children: ReactNode; 'aria-label'?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <ul {...props}>{children}</ul>
    </Card>
  )
}

/**
 * A group of rows on a page: its heading (a name, a badge, a count, a press or a link at its right)
 * over a {@link Panel} of them. Named by the heading's name alone.
 */
export function PanelGroup({ title, badge, count, action, children }: { title: ReactNode; badge?: ReactNode; count?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const heading = useId()
  const Heading = useHeadingTag()
  return (
    <section aria-labelledby={heading} className="min-w-0">
      <div className="mb-2 flex min-h-7 items-center gap-2 px-1">
        <Heading className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
          <span id={heading} className="min-w-0 truncate">
            {title}
          </span>
          {/* A space, not only the gap, so a screen reader says the name, the badge and the count apart. */}
          {badge !== undefined && (
            <>
              {' '}
              {badge}
            </>
          )}
          {count !== undefined && (
            <>
              {' '}
              <span className="shrink-0 font-normal text-faint-foreground">{count}</span>
            </>
          )}
        </Heading>
        {action !== undefined && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      <Panel>{children}</Panel>
    </section>
  )
}

// The whole row is the link or the press: the title's box covers the row. The row's presses stand above that cover.
const coverClass = 'outline-none after:absolute after:inset-0'

/**
 * One row of a {@link Panel}, two lines: what it is (`state`, a {@link StateCell} say), its name, and
 * under it what is known of it (`meta`, parts said with a dot between them). At its right one fact
 * (`fact`: an age, a place) that, under the pointer and the keyboard, gives its room to the row's
 * own presses (`actions`, always shown on touch). With `href` it is a link (`external` opens it in a
 * new tab; else a plain click goes through `onClick`); with `onClick` alone, a press. Under the pointer
 * it lightens, with the keyboard on it it takes an inset ring, and the hairline beside it gives way.
 */
export function PanelRow({ state, title, titleHint, meta = [], fact, actions, href, external = false, onClick, className }: {
  state?: ReactNode
  title: ReactNode
  /** Said under the pointer over the name: the whole text where the name stands in for it. */
  titleHint?: string | undefined
  meta?: ReactNode[]
  fact?: ReactNode
  actions?: ReactNode
  href?: string | undefined
  external?: boolean
  onClick?: (() => void) | undefined
  className?: string
}) {
  // On a phone a name takes two lines before it is cut.
  const nameClass = 'block min-w-0 truncate text-left font-medium max-md:line-clamp-2 max-md:whitespace-normal'
  const named =
    href !== undefined ? (
      <a data-cover href={href} title={titleHint} {...(external ? { target: '_blank', rel: 'noreferrer' } : { onClick: onClick && inPlace(onClick) })} className={cn(coverClass, nameClass)}>
        {title}
      </a>
    ) : onClick !== undefined ? (
      <button data-cover type="button" title={titleHint} onClick={onClick} className={cn(coverClass, nameClass)}>
        {title}
      </button>
    ) : (
      <span title={titleHint} className={nameClass}>
        {title}
      </span>
    )
  const parts = meta.filter(part => part !== undefined && part !== null && part !== false && part !== '')
  return (
    <li
      className={cn(
        'group/row relative flex min-h-14 items-center gap-3 py-2 pr-3 pl-4 text-sm max-md:min-h-15',
        // The hairline over every row but the first, from the name's edge, gone beside a lit row. Every
        // row's line is placed out of the flow, so lighting the first (which draws none) moves nothing.
        'before:absolute before:top-0 before:right-0 before:h-px not-first:before:bg-hairline',
        state !== undefined ? 'before:left-11' : 'before:left-4',
        'pointer-fine:hover:bg-foreground/4 pointer-fine:hover:before:opacity-0 pointer-fine:[&:hover+li]:before:opacity-0',
        'has-[[data-cover]:focus-visible]:ring-2 has-[[data-cover]:focus-visible]:ring-focus has-[[data-cover]:focus-visible]:ring-inset has-[[data-cover]:focus-visible]:before:opacity-0 [&:has([data-cover]:focus-visible)+li]:before:opacity-0',
        (href !== undefined || onClick !== undefined) && 'has-[[data-cover]:active]:bg-foreground/8',
        className,
      )}
    >
      {state !== undefined && <span className="flex w-4 shrink-0 justify-center">{state}</span>}
      <span className="min-w-0 flex-1">
        {named}
        {/* Every part but the last is said whole; the last gives way, cut with "…". */}
        {parts.length > 0 && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-faint-foreground">
            {parts.map((part, index) => (
              <Fragment key={index}>
                {index > 0 && <span aria-hidden>·</span>}
                <span className="min-w-0 truncate not-last:shrink-0">{part}</span>
              </Fragment>
            ))}
          </span>
        )}
      </span>
      {/* The fact and the presses share one cell at the right: the presses come in over the fact, and stay reachable by Tab while unseen. */}
      {(fact !== undefined || actions !== undefined) && (
        <span className="grid shrink-0 items-center justify-items-end">
          {fact !== undefined && (
            <span className={cn('col-start-1 row-start-1 text-xs text-faint-foreground', actions !== undefined && 'not-pointer-fine:invisible pointer-fine:group-hover/row:invisible pointer-fine:group-focus-within/row:invisible pointer-fine:group-has-[[aria-expanded=true]]/row:invisible')}>{fact}</span>
          )}
          {actions !== undefined && (
            <span className="relative col-start-1 row-start-1 flex items-center gap-1 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:group-has-[[aria-expanded=true]]/row:opacity-100">
              {actions}
            </span>
          )}
        </span>
      )}
    </li>
  )
}
