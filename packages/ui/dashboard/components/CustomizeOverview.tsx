import { isValidElement, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ChevronLeft, ChevronRight, GripVertical, Plus, X } from 'lucide-react'
import { widthsFor, type CardWidth, type OverviewLayouts } from '../../src/client.js'
import { updatePreferences } from '../lib/preferences.js'
import { cn } from '../lib/utils.js'
import type { OverviewCard } from './ModuleCards.js'
import { FadeWhileStale } from './FadeWhileStale.js'

/** A card as the layout placed it: its width, and whether it is hidden. */
export interface Placed {
  card: OverviewCard
  width: CardWidth
  hidden: boolean
}

// Where a card starts at each width, and how much of a row's leftover it takes. The widths follow
// the Overview's own room, not the window's (the sidebar takes some, or none once hidden): in a
// narrow column every card is full width, in a middling one a card under the whole width is a
// half, and only in a wide one does each start at its own share: a quarter beside three, a third
// beside two. A row its cards do not fill (a card that is not there on this install, a half beside
// a third) is filled by them, each growing by its share (his pick over gaps, and over moving cards
// up out of the order set). A quarter is a third in a middling column: the number tiles, three of
// them a row. A phone's column is always narrow. Each size is said for its own widths only
// (`@max-2xl:`), never as a base class a wider one refines: a module's dashboard.css that defines
// the base class again would win over the refinement.
const FULL = '@max-2xl:basis-full'
const FLEX: Record<CardWidth, string> = {
  '1/4': `${FULL} grow-[3] @2xl:basis-[calc(33.333%_-_1.333rem)] @4xl:basis-[calc(25%_-_1.5rem)]`,
  '1/3': `${FULL} grow-[4] @2xl:basis-[calc(50%_-_1rem)] @4xl:basis-[calc(33.333%_-_1.333rem)]`,
  '1/2': `${FULL} grow-[6] @2xl:basis-[calc(50%_-_1rem)]`,
  '2/3': `${FULL} grow-[8] @2xl:basis-[calc(50%_-_1rem)] @4xl:basis-[calc(66.667%_-_0.667rem)]`,
  '3/4': `${FULL} grow-[9] @2xl:basis-[calc(50%_-_1rem)] @4xl:basis-[calc(75%_-_0.5rem)]`,
  '1': 'basis-full grow-[12]',
}

/** What is no card but stands among them, full width, right under the card `card`, or first when that card is not on the page or there is none: the coding agents' updates, under what needs the person. */
export interface Under {
  card: string | undefined
  node: ReactNode
}

/** An {@link Under}'s room in the rows: none when it draws nothing, so it leaves no gap. */
export function UnderCards({ under }: { under: Under }) {
  return <div className="min-w-0 basis-full space-y-10 empty:hidden">{under.node}</div>
}

/** The key of {@link Under} among the cards: what `CardGrid`'s `until` names to stop after it. */
export const UNDER = 'under'

/** The cards with `under` drawn after the card it names, or before them all. */
function withUnder<T extends { card: OverviewCard }>(cards: T[], under: Under, draw: (placed: T, at: number) => ReactNode): ReactNode[] {
  const after = cards.findIndex(({ card }) => card.id === under.card)
  const drawn = cards.map(draw)
  drawn.splice(after + 1, 0, <UnderCards key={UNDER} under={under} />)
  return drawn
}

/**
 * The Overview's cards in rows, each at its width, in the order given, a row's cards filling it.
 * The cards of one row are as tall as its tallest, their content at the top: three bottoms at
 * three heights read as unfinished.
 */
export function CardGrid({
  cards,
  under,
  until,
}: {
  cards: Placed[]
  under: Under
  /** A part whose first answer is still out and can outgrow its waiting room (a card's id, or {@link UNDER}): nothing after it is drawn yet, so nothing is pushed when it answers. */
  until?: string | undefined
}) {
  const drawn = withUnder(cards, under, ({ card, width }) => <CardCell key={card.id} card={card} className={cn('flex min-w-0 flex-col *:flex-1', FLEX[width])} />)
  const last = drawn.findIndex(node => isValidElement(node) && node.key === until)
  return <Grid>{last < 0 ? drawn : drawn.slice(0, last + 1)}</Grid>
}

/** One card in its cell, faded while it shows only what an earlier visit read ({@link FadeWhileStale}). */
function CardCell({ card, className }: { card: OverviewCard; className: string }) {
  return (
    <FadeWhileStale data-card={card.id} stale={card.stale === true} className={className}>
      {card.node}
    </FadeWhileStale>
  )
}

function Grid({ children, onDragOver, onDrop }: { children: ReactNode; onDragOver?: (event: DragEvent) => void; onDrop?: (event: DragEvent) => void }) {
  return (
    <div className="@container">
      {/* 40 down between the rows of parts, 32 across: space, not lines, sets them apart. */}
      <div className="flex flex-wrap gap-x-8 gap-y-10" onDragOver={onDragOver} onDrop={onDrop}>
        {children}
      </div>
    </div>
  )
}

const WIDTH_WORDS: Record<CardWidth, string> = { '1/4': '¼', '1/3': '⅓', '1/2': '½', '2/3': '⅔', '3/4': '¾', '1': 'Full' }

/** What is being dragged: a card on the page, or one from the tray. */
type Dragging = { id: string; from: 'page' | 'tray' }

/** Where a dragged card lands: beside a card, or at the end. */
type Aim = { id: string; side: 'before' | 'after' } | 'end'

const sameAim = (a: Aim, b: Aim): boolean => (a === 'end' || b === 'end' ? a === b : a.id === b.id && a.side === b.side)

/** A card's name for the view transition that slides it: its id, in the letters a name may have. */
const transitionName = (id: string): string => `card-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

/** The bar in the gap beside a card where a dragged card lands. */
function DropBar({ side }: { side: 'before' | 'after' }) {
  return <span data-drop={side} aria-hidden className={cn('pointer-events-none absolute inset-y-0 z-20 w-1 rounded-full bg-primary', side === 'before' ? '-left-4.5' : '-right-4.5')} />
}

/**
 * The Overview while the person arranges it, on the cards themselves (his pick over a list in a
 * panel): each card on the page is drawn as it stands, at its width, with a small bar on its top
 * edge — a handle it is dragged by (or moved with the arrow keys; on a touch screen, by the buttons
 * either side), the widths it fits, and ✕, which puts it in the tray. The tray, above the cards,
 * holds the ones not on the page: dragged onto the page, one lands where its bar shows; its + adds
 * it at the end; a card dragged onto the tray leaves the page. While a card is dragged, from the
 * tray or on the page, the page stands still and a bar in a gap shows where it lands. The cards'
 * own buttons do nothing meanwhile. Every change is the layout at once, the cards sliding to their
 * new places: this page's (the picked project's, or the one of every project, which also lays out a
 * project never arranged on its own).
 */
export function EditOverview({ arranged, under, layouts, layoutKey, notice, reset }: { arranged: Placed[]; /** Drawn where it stands on the page, so arranging moves nothing. */ under: Under; layouts: OverviewLayouts | undefined; layoutKey: string; /** What arranging does, said above the tray. */ notice: ReactNode; /** The press that gives up this page's own layout, when it is drawn here rather than in the page's head (on a phone). */ reset?: ReactNode }) {
  const [dragging, setDragging] = useState<Dragging | null>(null)
  // Where the card being dragged lands: beside one card (before or after it, by which half of it the
  // pointer is over), or at the end, over the page's empty room. It is drawn as a bar in the gap,
  // over the page, never as room in the grid: a slot that took room pushed the cards from under the
  // pointer, which then aimed elsewhere, and the slot flickered between the two.
  const [aimed, setAimed] = useState<Aim | undefined>(undefined)
  const endDrag = (): void => {
    setDragging(null)
    setAimed(undefined)
  }
  const aim = (to: Aim): void => {
    if (aimed === undefined || !sameAim(aimed, to)) setAimed(to)
  }
  /** The layout changed: by a press or a key, the cards stand in their new places at once. None (the card moved is gone): nothing is written. */
  const write = (next: Placed[] | undefined): void => {
    if (next === undefined) return
    updatePreferences({
      overviewLayouts: {
        ...layouts,
        [layoutKey]: next.map(({ card, width, hidden }) => ({ id: card.id, ...(hidden ? { hidden: true as const } : {}), ...(width !== card.width ? { width } : {}) })),
      },
    })
  }
  /**
   * The layout changed by a drag: the cards slide to where they now stand, the browser's own view
   * transition, each card named for itself; under reduced motion, or where the browser has none, they just stand there.
   */
  const slide = (next: Placed[] | undefined): void => {
    if (next === undefined) return
    const apply = (): void => flushSync(() => write(next))
    if (typeof document.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply)
    else apply()
  }
  /** The layout with the card `id` put where `before` stands (the end, when none), shown or not; none when the card is gone. */
  const moved = (id: string, before: string | undefined, hidden: boolean): Placed[] | undefined => {
    const moving = arranged.find(placed => placed.card.id === id)
    // A package's card can leave the page while it is held (its package removed, a project picked on another tab).
    if (!moving) return undefined
    const rest = arranged.filter(placed => placed.card.id !== id)
    const at = before === undefined ? rest.length : rest.findIndex(placed => placed.card.id === before)
    rest.splice(at < 0 ? rest.length : at, 0, { ...moving, hidden })
    return rest
  }
  /** The layout with the card `id` changed. */
  const changed = (id: string, picked: Partial<Pick<Placed, 'width' | 'hidden'>>): Placed[] => arranged.map(placed => (placed.card.id === id ? { ...placed, ...picked } : placed))
  const shown = arranged.filter(placed => !placed.hidden)
  const tray = arranged.filter(placed => placed.hidden)
  /** The card one step earlier or later among the shown ones. */
  const step = (id: string, by: -1 | 1): void => {
    const at = shown.findIndex(placed => placed.card.id === id)
    const to = at + by
    if (to < 0 || to >= shown.length) return
    // Before the card it passes when moving up; before the one after that when moving down.
    write(moved(id, by < 0 ? shown[to]!.card.id : shown[to + 1]?.card.id, false))
  }
  const drop = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (dragging && aimed !== undefined) {
      const at = aimed === 'end' ? undefined : aimed
      // Dropped beside itself: it stays where it was.
      if (at?.id !== dragging.id) {
        const before = at === undefined ? undefined : at.side === 'before' ? at.id : shown.slice(shown.findIndex(placed => placed.card.id === at.id) + 1).find(placed => placed.card.id !== dragging.id)?.card.id
        if (before !== dragging.id) slide(moved(dragging.id, before, false))
      }
    }
    endDrag()
  }
  const last = shown.at(-1)?.card.id

  return (
    <div className="space-y-10">
      <Grid
        onDragOver={event => {
          if (dragging === null) return
          event.preventDefault()
          // Over the page's empty room, past its last card: the card lands at the end.
          aim('end')
        }}
        onDrop={drop}
      >
        {/* No card on the page: the room they would stand in, to drop the first one into. */}
        {shown.length === 0 && (
          <div
            data-empty
            onDragOver={event => {
              if (dragging === null) return
              event.preventDefault()
              event.stopPropagation()
              aim('end')
            }}
            onDragLeave={() => setAimed(undefined)}
            onDrop={drop}
            className={cn('flex min-h-40 basis-full items-center justify-center rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors', dragging && aimed === 'end' ? 'border-primary bg-primary/5 text-primary' : 'border-border')}
          >
            No card on the page. Drag one here, or press its +.
          </div>
        )}
        {withUnder(shown, under, ({ card, width }, at) => (
          <div
            key={card.id}
            data-card={card.id}
            draggable
            onDragStart={event => {
              event.dataTransfer.effectAllowed = 'move'
              setDragging({ id: card.id, from: 'page' })
            }}
            onDragOver={event => {
              event.preventDefault()
              event.stopPropagation()
              // Over a card's first half the card lands before it, over its second half after it.
              const box = event.currentTarget.getBoundingClientRect()
              aim({ id: card.id, side: event.clientX > box.left + box.width / 2 ? 'after' : 'before' })
            }}
            onDrop={drop}
            onDragEnd={endDrag}
            // The card being moved stays where it was, faded, until it is dropped where the bar shows.
            className={cn('group/cell relative flex min-w-0 cursor-grab flex-col rounded-lg outline-1 outline-offset-8 outline-hairline outline-dashed', FLEX[width], dragging?.id === card.id && 'opacity-40')}
            style={{ viewTransitionName: transitionName(card.id) }}
          >
            {/* Where the dragged card lands: a bar in the gap at this card's edge, laid over the page. */}
            {dragging && aimed !== undefined && (aimed === 'end' ? card.id === last && <DropBar side="after" /> : aimed.id === card.id && <DropBar side={aimed.side} />)}
            <CardBar
              label={card.label}
              widths={widthsFor(card)}
              width={width}
              first={at === 0}
              last={at === shown.length - 1}
              onStep={by => step(card.id, by)}
              onWidth={picked => write(changed(card.id, { width: picked }))}
              onHide={() => write(changed(card.id, { hidden: true }))}
            />
            {/* The card as it stands, its own buttons asleep while it is being arranged; its sentence still for a screen reader alone, so arranging moves nothing. Its heading's link to its page is not drawn, its room kept. */}
            <div inert className="flex flex-1 select-none flex-col *:flex-1 [&_section>div:first-child>h2~*]:invisible">
              {card.node}
            </div>
          </div>
        ))}
      </Grid>
      {/* Under the parts, so arranging moves none of them: what it does, and the tray of the cards not on the page. A card dragged here leaves the page. */}
      <section
        aria-label="Cards not on the page"
        onDragOver={event => dragging?.from === 'page' && event.preventDefault()}
        onDrop={event => {
          event.preventDefault()
          if (dragging?.from === 'page') slide(changed(dragging.id, { hidden: true }))
          endDrag()
        }}
        className={cn('rounded-lg border border-dashed border-border px-3 py-3', dragging?.from === 'page' && 'border-primary bg-accent/40')}
      >
        <p role="status" className="mb-2 text-sm text-muted-foreground">
          {notice}
        </p>
        <p className="mb-2 text-sm text-muted-foreground">
          {tray.length === 0 ? (
            <>
              Every card is on the page. Drag one here, or press its <TakeOffMark />, to take it off.
            </>
          ) : (
            'Not on the page: drag one onto a card to put it there, or press + to add it at the end.'
          )}
        </p>
        {reset !== undefined && <div className={cn(tray.length > 0 && 'mb-3')}>{reset}</div>}
        {tray.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {tray.map(({ card }) => (
              <li
                key={card.id}
                aria-label={card.label}
                draggable
                onDragStart={event => {
                  event.dataTransfer.effectAllowed = 'move'
                  setDragging({ id: card.id, from: 'tray' })
                }}
                onDragEnd={endDrag}
                className="flex cursor-grab items-center gap-1 rounded-md border border-border bg-card py-0.5 pr-0.5 pl-2 text-sm"
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {card.label}
                <button type="button" aria-label={`Add ${card.label}`} onClick={() => write(moved(card.id, undefined, false))} className="focus-ring flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** The ✕ a card's bar takes it off the page with, as a sentence names it: the bar's own icon, drawn whatever fonts the computer has, its box cut to the glyph so it sits on the line as a letter does. */
export function TakeOffMark() {
  return <X role="img" aria-label="X" viewBox="5 5 14 14" className="inline size-[7px] align-baseline" />
}

/** The bar above a card while the page is arranged, so it covers none of the card: its handle, its widths, and ✕. */
function CardBar({ label, widths, width, first, last, onStep, onWidth, onHide }: { label: string; widths: CardWidth[]; width: CardWidth; first: boolean; last: boolean; onStep: (by: -1 | 1) => void; onWidth: (width: CardWidth) => void; onHide: () => void }) {
  return (
    // On the card's frame, over its top edge and above the card: it covers none of the card, however narrow the card or
    // long its title, and the card keeps its place. Its ground hides the frame's line under it, nothing else.
    <div role="toolbar" aria-label={label} className="absolute right-0 bottom-full z-10 flex h-5 items-center gap-1 bg-background px-1 pointer-coarse:gap-6">
      <button
        type="button"
        aria-label={`Move ${label}: arrow keys`}
        onKeyDown={event => {
          const by = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0
          if (by === 0) return
          event.preventDefault()
          onStep(by)
        }}
        className="focus-ring not-pointer-coarse:flex size-5 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground pointer-coarse:hidden"
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      {/* A touch screen drags nothing: there a card moves by a press. */}
      <span className="not-pointer-coarse:hidden pointer-coarse:flex pointer-coarse:gap-6">
        <BarButton label={`Move ${label} earlier`} disabled={first} onClick={() => onStep(-1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </BarButton>
        <BarButton label={`Move ${label} later`} disabled={last} onClick={() => onStep(1)}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </BarButton>
      </span>
      {widths.length > 1 && (
        // Not in a narrow column, where every part is full width; under a pointer, on the part it rests on or the keyboard is in.
        <div role="group" aria-label={`Width of ${label}`} className="items-center text-xs @max-2xl:hidden @2xl:pointer-coarse:flex @2xl:pointer-fine:hidden @2xl:pointer-fine:group-hover/cell:flex @2xl:pointer-fine:group-focus-within/cell:flex">
          {widths.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={option === width}
              onClick={() => onWidth(option)}
              className={cn('focus-ring h-5 min-w-5 rounded-md px-1.5 tabular-nums transition-colors', option === width ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
            >
              {WIDTH_WORDS[option]}
            </button>
          ))}
        </div>
      )}
      <BarButton label={`Take ${label} off the page`} onClick={onHide}>
        <X className="size-4" aria-hidden />
      </BarButton>
    </div>
  )
}

function BarButton({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    // Drawn as small as the bar is tall; under a finger it takes 44 px all round, beyond what it draws.
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="focus-ring relative flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 pointer-coarse:after:absolute pointer-coarse:after:-inset-3">
      {children}
    </button>
  )
}
