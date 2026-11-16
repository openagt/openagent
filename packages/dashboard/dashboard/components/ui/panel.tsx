import { Fragment, useId, type ReactNode } from 'react'
import { cn } from '../../lib/utils.js'
import { inPlace } from '../../lib/in-place.js'
import { cardSurface } from './card.js'
import { useHeadingTag } from './section.js'

/** Rows held as one object: a card that is the list itself, its rows reaching its edges, a hairline between them. `ordered`: rows a person goes through in turn (numbered steps). */
export function Panel({ ordered = false, className, children, ...props }: { ordered?: boolean; className?: string; children: ReactNode; 'aria-label'?: string; 'aria-hidden'?: boolean }) {
  const List = ordered ? 'ol' : 'ul'
  return (
    <List {...props} className={cn(cardSurface, 'overflow-hidden', className)}>
      {children}
    </List>
  )
}

/**
 * A group of rows on a page: its heading (a name, a badge, a count, a press or a link at its right)
 * over a {@link Panel} of them. Named by the heading's name alone. `bare`: what it holds is drawn as
 * given, under the heading, for a group that draws its own panel (inside a `Slot`) or cards of its own.
 */
export function PanelGroup({ title, badge, count, action, bare = false, children }: { title: ReactNode; badge?: ReactNode; count?: ReactNode; action?: ReactNode; bare?: boolean; children: ReactNode }) {
  const heading = useId()
  const Heading = useHeadingTag()
  return (
    <section aria-labelledby={heading} className="min-w-0">
      {/* Its name 8 over its card, the row as tall as the name: a press or a link at its right stands out of it
          above and below, so groups side by side have their names on one line and their cards at one height.
          On a phone, where a link is 44 tall to touch and no group stands beside another, the row is the link's height. */}
      <div className="mb-2 flex items-center gap-2">
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
        {action !== undefined && <div className="flex shrink-0 items-center gap-2 md:h-5">{action}</div>}
      </div>
      {bare ? children : <Panel>{children}</Panel>}
    </section>
  )
}

/** A {@link Panel}'s one sentence where its rows would be: what it holds when it holds none, on the rows' inset. */
export function PanelNote({ children }: { children: ReactNode }) {
  return <li className="px-4 py-3 text-sm text-muted-foreground">{children}</li>
}

/** The press at a {@link Panel}'s foot that shows the rows it holds back, or hides them again: "Show 3 more", as tall as a one-line row. */
export function PanelMore({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <li className="relative before:absolute before:top-0 before:right-4 before:left-4 before:h-px before:bg-hairline">
      <button type="button" onClick={onClick} className="focus-ring-inset flex h-11 w-full items-center px-4 text-sm text-muted-foreground transition-colors hover:bg-foreground/4 hover:text-foreground">
        {children}
      </button>
    </li>
  )
}

// The whole row is the link or the press: the title's box covers the row. The row's presses stand above that cover.
const coverClass = 'outline-none after:absolute after:inset-0'

/**
 * One row of a {@link Panel}, two lines: what it is (`state`: a place, a {@link StateCell}), its name, and
 * under it what is known of it (`meta`, parts said with a dot between them). At its right one fact
 * (`fact`: an age, a place) that, under the pointer and the keyboard, gives its room to the row's
 * own presses (`actions`, always shown where no mouse points, and on a phone-width screen, where a row's
 * press is the one way to its actions). With `href` it is a link (`external`
 * opens it in a new tab; else a plain click goes through `onClick`); with `onClick` alone, a press.
 * Under the pointer it lightens, with the keyboard on it it takes an inset ring, and the hairline
 * beside it gives way.
 *
 * Its spacing is the look's rule (ui/look/spacing.md): 16 in from every edge, as tall as its lines
 * (44 with one, 64 with two); `state` takes 16 on the title's line and the title starts 12 after it;
 * a fact stands on the title's line and the presses are centred on the row, both ending on the inset.
 * A press with no painted box is pulled out by its own padding by its caller, so its glyph ends there.
 * Before the fact, `columns`: facts a list lines up down its rows (who ran it, its pull request), on
 * the title's line too, which stay under the pointer: only the fact gives its room to the presses.
 * `under`: a line of its own under what is known, for what holds for this row alone (a warning).
 * `actionsAtRest`: the presses show with no pointer on the row too, where the press is what a person
 * comes to the row for (Answer, Review); then the fact stands just before them, centred on the row with
 * them, and is not said on a phone, where the room is the name's.
 */
export function PanelRow({ state, before, title, titleHint, meta = [], metaLines = 1, under, columns, fact, actions, actionsAtRest = false, href, external = false, onClick, className }: {
  state?: ReactNode
  /** On the name's line before it, 12 after `state`, its own column (a ticket's priority): `meta` starts under the name, not under it. */
  before?: ReactNode
  title: ReactNode
  /** Said under the pointer over the name: the whole text where the name stands in for it. */
  titleHint?: string | undefined
  meta?: ReactNode[]
  /** How many lines what is known of it may take before it is cut: 2 for a sentence a person must read whole (a question). */
  metaLines?: 1 | 2
  under?: ReactNode
  columns?: ReactNode
  fact?: ReactNode
  actions?: ReactNode
  actionsAtRest?: boolean
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
        'group/row relative flex items-start gap-3 px-4 py-3 text-sm',
        // The hairline over every row but the first, from inset to inset, gone beside a lit row. Every
        // row's line is placed out of the flow, so lighting the first (which draws none) moves nothing.
        'before:absolute before:top-0 before:right-4 before:left-4 before:h-px not-first:before:bg-hairline',
        'pointer-fine:hover:bg-foreground/4 pointer-fine:hover:before:opacity-0 pointer-fine:[&:hover+li]:before:opacity-0',
        'has-[[data-cover]:focus-visible]:ring-2 has-[[data-cover]:focus-visible]:ring-focus has-[[data-cover]:focus-visible]:ring-inset has-[[data-cover]:focus-visible]:before:opacity-0 [&:has([data-cover]:focus-visible)+li]:before:opacity-0',
        (href !== undefined || onClick !== undefined) && 'has-[[data-cover]:active]:bg-foreground/8',
        className,
      )}
    >
      {state !== undefined && <span className="flex h-5 w-4 shrink-0 items-center">{state}</span>}
      {before !== undefined && <span className="flex h-5 shrink-0 items-center">{before}</span>}
      <span className="min-w-0 flex-1">
        {named}
        {/* On one line every part but the last is said whole and the last gives way, cut with "…"; on two, the parts run on and the second line is cut. */}
        {parts.length > 0 && (
          <span className={cn('mt-1 text-xs text-faint-foreground', metaLines === 2 ? 'line-clamp-2' : 'flex min-w-0 items-center gap-1.5')}>
            {parts.map((part, index) => (
              <Fragment key={index}>
                {index > 0 && <span aria-hidden className={cn(metaLines === 2 && 'mx-1.5')}>·</span>}
                {metaLines === 2 ? part : <span className="min-w-0 truncate not-last:shrink-0">{part}</span>}
              </Fragment>
            ))}
          </span>
        )}
        {under !== undefined && <span className="mt-1 block text-xs">{under}</span>}
      </span>
      {columns !== undefined && <span className="flex h-5 shrink-0 items-center gap-4 text-xs text-faint-foreground">{columns}</span>}
      {/* The fact and the presses take the row's whole height at its right (their margins undo the row's
          padding), so a press is centred on the row and makes it no taller. Presses shown at rest have the
          fact beside them, centred too. Otherwise the two share one cell: the presses come in over the
          fact, and stay reachable by Tab while unseen; the fact stands on the title's line. */}
      {actionsAtRest && (fact !== undefined || actions !== undefined) ? (
        <span className="-my-3 flex shrink-0 items-center gap-2 self-stretch">
          {fact !== undefined && <span className="text-xs leading-5 text-faint-foreground max-md:hidden">{fact}</span>}
          {actions !== undefined && <span className="relative flex items-center gap-1">{actions}</span>}
        </span>
      ) : (fact !== undefined || actions !== undefined) && (
        <span className="-my-3 grid shrink-0 self-stretch justify-items-end">
          {fact !== undefined && (
            <span className={cn('col-start-1 row-start-1 mt-3 self-start text-xs leading-5 text-faint-foreground', actions !== undefined && 'not-pointer-fine:invisible max-md:invisible pointer-fine:group-hover/row:invisible pointer-fine:group-focus-within/row:invisible pointer-fine:group-has-[[aria-expanded=true]]/row:invisible')}>{fact}</span>
          )}
          {actions !== undefined && (
            <span className="relative col-start-1 row-start-1 flex items-center gap-1 self-center md:pointer-fine:opacity-0 md:pointer-fine:group-hover/row:opacity-100 md:pointer-fine:group-focus-within/row:opacity-100 md:pointer-fine:group-has-[[aria-expanded=true]]/row:opacity-100">
              {actions}
            </span>
          )}
        </span>
      )}
    </li>
  )
}
