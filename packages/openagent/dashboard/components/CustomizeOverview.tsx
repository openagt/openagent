import { useCallback, useState, type DragEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ChevronLeft, ChevronRight, GripVertical, Plus, X } from 'lucide-react'
import { widthsFor, type CardWidth, type OverviewLayouts } from '../../src/client.js'
import { updatePreferences } from '../lib/preferences.js'
import { StaleReads } from '../lib/use-async.js'
import { cn } from '../lib/utils.js'
import type { OverviewCard } from './ModuleCards.js'

/** A card as the layout placed it: its width, and whether it is hidden. */
export interface Placed {
  card: OverviewCard
  width: CardWidth
  hidden: boolean
}

// How many of the column's twelve parts a card takes at each width. The widths follow the
// Overview's own room, not the window's (the sidebar takes some, or none once hidden): in a narrow
// column every card is full width, in a middling one a card under the whole width is a half, and
// only in a wide one does each stand at its own share: a quarter beside three, a third beside two.
// A phone's column is always narrow.
const SPAN: Record<CardWidth, string> = {
  '1/4': '@2xl:col-span-6 @5xl:col-span-3',
  '1/3': '@2xl:col-span-6 @5xl:col-span-4',
  '1/2': '@2xl:col-span-6',
  '2/3': '@2xl:col-span-6 @5xl:col-span-8',
  '3/4': '@2xl:col-span-6 @5xl:col-span-9',
  '1': '',
}

/**
 * The Overview's cards on a grid of twelve, each at its width, in the order given. The cards of one
 * row are as tall as its tallest, their content at the top: three bottoms at three heights read as
 * unfinished.
 */
export function CardGrid({ cards }: { cards: Placed[] }) {
  return (
    <Grid>
      {cards.map(({ card, width }) => (
        <CardCell key={card.id} card={card} className={cn('col-span-12 flex min-w-0 flex-col *:flex-1', SPAN[width])} />
      ))}
    </Grid>
  )
}

const NONE_STALE: ReadonlySet<object> = new Set()

/**
 * One card in its cell, faded while what it shows is only what an earlier visit read: the page
 * opens with the last numbers at once, and each card turns full as its fresh answer lands.
 */
function CardCell({ card, className }: { card: OverviewCard; className: string }) {
  const [staleReads, setStaleReads] = useState(NONE_STALE)
  const told = useCallback((reader: object, stale: boolean) => {
    setStaleReads(readers => {
      if (readers.has(reader) === stale) return readers
      const next = new Set(readers)
      if (stale) next.add(reader)
      else next.delete(reader)
      return next
    })
  }, [])
  const stale = card.stale === true || staleReads.size > 0
  return (
    <div data-card={card.id} data-stale={stale || undefined} className={cn(className, 'transition-opacity duration-300', stale && 'opacity-60')}>
      <StaleReads.Provider value={told}>{card.node}</StaleReads.Provider>
    </div>
  )
}

function Grid({ children, onDragOver, onDrop }: { children: ReactNode; onDragOver?: (event: DragEvent) => void; onDrop?: (event: DragEvent) => void }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-12 gap-4" onDragOver={onDragOver} onDrop={onDrop}>
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
  return <span data-drop={side} aria-hidden className={cn('pointer-events-none absolute inset-y-0 z-20 w-1 rounded-full bg-primary', side === 'before' ? '-left-2.5' : '-right-2.5')} />
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
export function EditOverview({ arranged, layouts, layoutKey }: { arranged: Placed[]; layouts: OverviewLayouts | undefined; layoutKey: string }) {
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
  const write = (next: Placed[]): void =>
    updatePreferences({
      overviewLayouts: {
        ...layouts,
        [layoutKey]: next.map(({ card, width, hidden }) => ({ id: card.id, ...(hidden ? { hidden: true as const } : {}), ...(width !== card.width ? { width } : {}) })),
      },
    })
  /**
   * The layout changed, the cards sliding to where they now stand rather than jumping: the browser's
   * own view transition, each card named for itself. Where the browser has none, they just stand there.
   */
  const save = (next: Placed[]): void => {
    const apply = (): void => flushSync(() => write(next))
    if (typeof document.startViewTransition === 'function') document.startViewTransition(apply)
    else apply()
  }
  const indexOf = (id: string): number => arranged.findIndex(placed => placed.card.id === id)
  /** The card `id` put where `before` stands (the end, when none), shown or not. */
  const place = (id: string, before: string | undefined, hidden: boolean): void => {
    const moving = arranged[indexOf(id)]
    if (!moving) return
    const rest = arranged.filter(placed => placed.card.id !== id)
    const at = before === undefined ? rest.length : rest.findIndex(placed => placed.card.id === before)
    rest.splice(at < 0 ? rest.length : at, 0, { ...moving, hidden })
    save(rest)
  }
  const change = (id: string, picked: Partial<Pick<Placed, 'width' | 'hidden'>>): void => save(arranged.map(placed => (placed.card.id === id ? { ...placed, ...picked } : placed)))
  const shown = arranged.filter(placed => !placed.hidden)
  const tray = arranged.filter(placed => placed.hidden)
  /** The card one step earlier or later among the shown ones. */
  const step = (id: string, by: -1 | 1): void => {
    const at = shown.findIndex(placed => placed.card.id === id)
    const to = at + by
    if (to < 0 || to >= shown.length) return
    // Before the card it passes when moving up; before the one after that when moving down.
    place(id, by < 0 ? shown[to]!.card.id : shown[to + 1]?.card.id, false)
  }
  const drop = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (dragging && aimed !== undefined) {
      const at = aimed === 'end' ? undefined : aimed
      // Dropped beside itself: it stays where it was.
      if (at?.id !== dragging.id) {
        const before = at === undefined ? undefined : at.side === 'before' ? at.id : shown.slice(shown.findIndex(placed => placed.card.id === at.id) + 1).find(placed => placed.card.id !== dragging.id)?.card.id
        if (before !== dragging.id) place(dragging.id, before, false)
      }
    }
    endDrag()
  }
  const last = shown.at(-1)?.card.id

  return (
    <div className="space-y-4">
      {/* The tray: the cards not on the page. A card dragged here leaves the page. */}
      <section
        aria-label="Cards not on the page"
        onDragOver={event => dragging?.from === 'page' && event.preventDefault()}
        onDrop={event => {
          event.preventDefault()
          if (dragging?.from === 'page') change(dragging.id, { hidden: true })
          endDrag()
        }}
        className={cn('rounded-lg border border-dashed border-border px-3 py-2.5', dragging?.from === 'page' && 'border-primary bg-accent/40')}
      >
        <p className="mb-2 text-xs text-muted-foreground">{tray.length === 0 ? 'Every card is on the page. Drag one here, or press its ✕, to take it off.' : 'Not on the page: drag one onto a card to put it there, or press + to add it at the end.'}</p>
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
                <button type="button" aria-label={`Add ${card.label}`} onClick={() => place(card.id, undefined, false)} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
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
            className={cn('col-span-12 flex min-h-40 items-center justify-center rounded-lg border-2 border-dashed text-sm text-muted-foreground transition-colors', dragging && aimed === 'end' ? 'border-primary bg-primary/5 text-primary' : 'border-border')}
          >
            No card on the page. Drag one here, or press its +.
          </div>
        )}
        {shown.map(({ card, width }, at) => (
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
            className={cn('relative col-span-12 flex min-w-0 cursor-grab flex-col rounded-lg outline-1 outline-offset-2 outline-border outline-dashed', SPAN[width], dragging?.id === card.id && 'opacity-40')}
            style={{ viewTransitionName: transitionName(card.id) }}
          >
            {/* Where the dragged card lands: a bar in the gap at this card's edge, laid over the page. */}
            {dragging && aimed !== undefined && (aimed === 'end' ? card.id === last && <DropBar side="after" /> : aimed.id === card.id && <DropBar side={aimed.side} />)}
            {/* The card as it stands, its own buttons asleep while it is being arranged. */}
            <div aria-hidden className="pointer-events-none flex flex-1 select-none flex-col *:flex-1">
              {card.node}
            </div>
            <CardBar
              label={card.label}
              widths={widthsFor(card)}
              width={width}
              first={at === 0}
              last={at === shown.length - 1}
              onStep={by => step(card.id, by)}
              onWidth={picked => change(card.id, { width: picked })}
              onHide={() => change(card.id, { hidden: true })}
            />
          </div>
        ))}
      </Grid>
    </div>
  )
}

/** The bar on a card's top edge while the page is arranged: its handle, its widths, and ✕. */
function CardBar({ label, widths, width, first, last, onStep, onWidth, onHide }: { label: string; widths: CardWidth[]; width: CardWidth; first: boolean; last: boolean; onStep: (by: -1 | 1) => void; onWidth: (width: CardWidth) => void; onHide: () => void }) {
  return (
    <div role="toolbar" aria-label={label} className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-border bg-popover p-0.5 text-popover-foreground shadow-sm">
      <button
        type="button"
        aria-label={`Move ${label}: arrow keys`}
        onKeyDown={event => {
          const by = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0
          if (by === 0) return
          event.preventDefault()
          onStep(by)
        }}
        className="flex size-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] pointer-coarse:hidden"
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      {/* A touch screen drags nothing: there a card moves by a press. */}
      <span className="hidden pointer-coarse:flex">
        <BarButton label={`Move ${label} earlier`} disabled={first} onClick={() => onStep(-1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </BarButton>
        <BarButton label={`Move ${label} later`} disabled={last} onClick={() => onStep(1)}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </BarButton>
      </span>
      {widths.length > 1 && (
        <div role="group" aria-label={`Width of ${label}`} className="flex overflow-hidden rounded border border-border text-xs">
          {widths.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={option === width}
              onClick={() => onWidth(option)}
              className={cn('min-w-7 px-1.5 py-0.5 tabular-nums transition-colors', option === width ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {WIDTH_WORDS[option]}
            </button>
          ))}
        </div>
      )}
      <BarButton label={`Take ${label} off the page`} onClick={onHide}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </BarButton>
    </div>
  )
}

function BarButton({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">
      {children}
    </button>
  )
}
