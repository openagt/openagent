import { createContext, isValidElement, useContext, useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { inPlace } from '../../lib/in-place.js'
import { cardSurface } from './card.js'
import { useHeadingTag } from './section.js'

// Inside {@link PanelGroups}: a list's columns are the page's, so a row's fact stands in one place down every list.
const PageColumns = createContext(false)

/**
 * Rows held as one object: a card that is the list itself, its rows reaching its edges, a hairline between them. `ordered`: rows a person goes through in turn (numbered steps).
 * It lays out its rows' columns: a {@link PanelRow}'s fact, then its presses, each stand in one column at the right as wide as
 * the widest row's, so what stands set apart at a row's right has one place in every row; every other child spans the list.
 */
export function Panel({ ordered = false, className, children, ...props }: { ordered?: boolean; className?: string; children: ReactNode; 'aria-label'?: string; 'aria-hidden'?: boolean }) {
  const List = ordered ? 'ol' : 'ul'
  const inPage = useContext(PageColumns)
  return (
    <List {...props} className={cn(cardSurface, 'grid overflow-hidden *:col-span-full', inPage ? 'col-span-full grid-cols-subgrid' : 'grid-cols-[minmax(0,1fr)_auto_auto]', className)}>
      {children}
    </List>
  )
}

/** A step's number in a list of steps a person takes in turn (a `Panel ordered`, a dialog's steps): a quiet disc on the step's first line, 16 across as a row's mark is, in the press's colour on the step at hand. */
export function StepNumber({ at, current = false }: { at: number; current?: boolean }) {
  return (
    <span aria-hidden className="flex h-5 w-4 shrink-0 items-center">
      <span className={cn('flex size-4 items-center justify-center rounded-full bg-accent text-xs font-medium tabular-nums', current ? 'text-primary' : 'text-muted-foreground')}>{at + 1}</span>
    </span>
  )
}

/** {@link PanelGroup}s one under another whose rows' columns stand in one place down all of them, as one list's do (a day's runs under another's). */
export function PanelGroups({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)_auto_auto] *:col-span-full', className)}>
      <PageColumns.Provider value={true}>{children}</PageColumns.Provider>
    </div>
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
  const inPage = useContext(PageColumns)
  return (
    // A column whose last part, its card, takes the height left: two groups side by side end on one line, the shorter one's card as tall as the other's.
    <section aria-labelledby={heading} className={cn('min-w-0', inPage ? 'grid grid-cols-subgrid content-start *:col-span-full' : 'flex flex-col *:last:grow')}>
      {/* Its name 8 over its card, the row as tall as a heading's press (28), so a press's fill under the pointer
          never reaches the card (his report, 2026-11-26), and groups side by side have their names on one line
          and their cards at one height. On a phone, where a link is 44 tall to touch, the row is the link's height. */}
      <div className="mb-2 flex items-center gap-2 md:min-h-7">
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
      {bare ? children : <Panel>{children}</Panel>}
    </section>
  )
}

// What a card holds when it holds nothing: its sentence in the card's middle, under a quiet glyph that says what would be here.
const EMPTY = 'flex-col items-center justify-center gap-3 px-4 py-8 text-center'
const emptyGlyph = 'size-10 items-center justify-center rounded-full bg-foreground/5 text-faint-foreground'

/**
 * What a card holds when it holds nothing: its sentence in the card's middle, under a quiet glyph (`icon`)
 * that says what would be here. The card keeps its surface, so an empty part stands on the page as a full one does.
 */
export function EmptyNote({ icon: Icon, children }: { icon?: LucideIcon | undefined; children: ReactNode }) {
  return (
    <div className={cn('flex text-sm text-muted-foreground', EMPTY)}>
      {Icon !== undefined && (
        <span aria-hidden className={cn('flex', emptyGlyph)}>
          <Icon className="size-5" strokeWidth={1.5} />
        </span>
      )}
      <p>{children}</p>
    </div>
  )
}

/**
 * A {@link Panel}'s one sentence where its rows would be: what it holds when it holds none. Among other
 * children it is a line on the rows' inset; alone in the panel it is the card's {@link EmptyNote}, with its `icon`.
 */
export function PanelNote({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <li className="group/note px-4 py-3 text-sm text-muted-foreground only:flex only:flex-col only:items-center only:justify-center only:gap-3 only:py-8 only:text-center">
      {Icon !== undefined && (
        <span aria-hidden className={cn('hidden group-only/note:flex', emptyGlyph)}>
          <Icon className="size-5" strokeWidth={1.5} />
        </span>
      )}
      {children}
    </li>
  )
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

/** A fact of a run of facts; with a class, what its own wrapper needs too (`max-md:sr-only`: a phone leaves it, its dot with it, to a screen reader). */
export type Fact = ReactNode | { fact: ReactNode; className: string }

/**
 * A run of facts, joined one way everywhere: a dot between each two, in a 16 px column of its own, drawn with the fact
 * after it and not said. A fact never breaks inside itself: the run wraps between facts, and no line opens with a dot,
 * since the run stands 16 px out to its left and cuts that margin off, where a dot that would open a line stands. A fact
 * a narrow screen does not draw takes its dot along. A fact that is nothing (`false`, `''`, `undefined`) is left out.
 * `lead` (a badge) opens the run with no dot after it. `oneLine`: the run keeps to one line, and its last fact's words
 * give way.
 */
export function Facts({ facts, lead, oneLine = false, className }: { facts: Fact[]; lead?: ReactNode; oneLine?: boolean; className?: string }) {
  const shown = facts.filter(fact => fact !== undefined && fact !== null && fact !== false && fact !== '')
  return (
    <span className={cn('-ml-4 flex min-w-0 items-center [clip-path:inset(0_0_0_1rem)]', !oneLine && 'flex-wrap', className)}>
      {lead !== undefined && <span className="-mr-2 flex shrink-0 pl-4">{lead}</span>}
      {shown.map((fact, index) => {
        const own = typeof fact === 'object' && fact !== null && !isValidElement(fact) && 'fact' in fact ? fact : { fact, className: undefined }
        // The first fact has no dot before it, but with a lead, whose dot stands unseen as its gap.
        const dot = index > 0 || lead !== undefined
        return (
          <span key={index} className={cn('min-w-0 max-w-full whitespace-nowrap', oneLine ? 'flex items-center not-last:shrink-0' : 'truncate', !dot && 'pl-4', own.className)}>
            {dot && (
              <span aria-hidden className={cn('inline-block w-4 shrink-0 text-center', index === 0 && 'invisible')}>
                ·
              </span>
            )}
            {oneLine ? <span className="min-w-0 truncate">{own.fact}</span> : own.fact}
          </span>
        )
      })}
    </span>
  )
}

/**
 * One row of a {@link Panel}, two lines: what it is (`state`: a place, a {@link StateCell}), its name, and
 * under it what is known of it (`meta`: {@link Facts}). At its right one fact
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
 * them, and is left to a screen reader on a phone, where the room is the name's.
 */
export function PanelRow({ state, before, title, titleHint, meta = [], under, columns, fact, actions, actionsAtRest = false, href, external = false, onClick, className, 'aria-label': label }: {
  state?: ReactNode
  /** On the name's line before it, 12 after `state`, its own column (a ticket's priority): `meta` starts under the name, not under it. */
  before?: ReactNode
  title: ReactNode
  /** Said under the pointer over the name: the whole text where the name stands in for it. */
  titleHint?: string | undefined
  meta?: Fact[]
  under?: ReactNode
  columns?: ReactNode
  fact?: ReactNode
  actions?: ReactNode
  actionsAtRest?: boolean
  href?: string | undefined
  external?: boolean
  onClick?: (() => void) | undefined
  className?: string
  /** The row's name, where its title alone does not say it (an account's login). */
  'aria-label'?: string
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
      aria-label={label}
      className={cn(
        // The list's columns (see Panel): the row's own parts, its fact where its presses show at rest, its presses.
        'group/row relative grid grid-cols-subgrid items-start px-4 py-3 text-sm',
        // The hairline over every row but the first, from inset to inset, gone beside a lit row. Every
        // row's line is placed out of the flow, so lighting the first (which draws none) moves nothing.
        'before:absolute before:top-0 before:right-4 before:left-4 before:h-px not-first:before:bg-hairline',
        'pointer-fine:hover:bg-foreground/4 pointer-fine:hover:before:opacity-0 pointer-fine:[&:hover+li]:before:opacity-0',
        'has-[[data-cover]:focus-visible]:ring-2 has-[[data-cover]:focus-visible]:ring-focus has-[[data-cover]:focus-visible]:ring-inset has-[[data-cover]:focus-visible]:before:opacity-0 [&:has([data-cover]:focus-visible)+li]:before:opacity-0',
        (href !== undefined || onClick !== undefined) && 'has-[[data-cover]:active]:bg-foreground/8',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {state !== undefined && <span className="flex h-5 w-4 shrink-0 items-center">{state}</span>}
        {before !== undefined && <span className="flex h-5 shrink-0 items-center">{before}</span>}
        <span className="min-w-0 flex-1">
          {named}
          {/* One line: every part but the last is said whole and the last gives way, cut with "…". */}
          {parts.length > 0 && <Facts facts={parts} className="mt-1 text-xs text-faint-foreground" oneLine />}
          {under !== undefined && <span className="mt-1 block text-xs">{under}</span>}
        </span>
        {columns !== undefined && <span className="flex h-5 shrink-0 items-center gap-4 text-xs text-faint-foreground">{columns}</span>}
      </div>
      {/* The fact and the presses stand in the list's columns, each as wide as its widest row's and its words at its
          right, so each has one place in every row, and take the row's whole height (their margins undo the row's
          padding), so a press is centred on the row and makes it no taller. Presses shown at rest have the fact in
          the column before theirs, centred too. Otherwise the two share the last column: the presses come in over
          the fact, and stay reachable by Tab while unseen; the fact stands on the title's line. */}
      {actionsAtRest && (fact !== undefined || actions !== undefined) ? (
        <>
          {fact !== undefined && <span className="col-start-2 -my-3 mr-2 ml-3 flex items-center justify-end self-stretch text-xs leading-5 text-faint-foreground max-md:sr-only">{fact}</span>}
          {actions !== undefined && <span className={cn('relative col-start-3 -my-3 flex items-center justify-end gap-1 self-stretch', fact === undefined ? 'ml-3' : 'max-md:ml-3')}>{actions}</span>}
        </>
      ) : (fact !== undefined || actions !== undefined) && (
        <span className="col-start-3 -my-3 ml-3 grid self-stretch justify-items-end">
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
