import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { StaleReads, type ReadState } from '../../lib/use-async.js'
import { cn } from '../../lib/utils.js'
import { cardSurface } from './card.js'
import { FADE_AFTER_MS } from '../FadeWhileStale.js'
import { Skeleton, useSkeleton } from './skeleton.js'

/** What a {@link Slot} draws from: a read's value, what is known of it, and whether its last ask failed. */
export interface SlotRead<T> {
  value: T
  state: ReadState
  failing?: boolean
}

/**
 * Where a read's answer is drawn, and the one way its wait is drawn. `children` are given only an
 * answer, never the value a read holds before one, so a slot cannot say "none" for what is not known.
 *
 * - Unknown: `shape` holds the answer's room from the first frame, unseen for 200ms and then
 *   pulsing; once seen it stays 300ms, so an answer just after it does not flash it away. A screen
 *   reader is told it is loading.
 * - Kept (an earlier visit's answer): drawn at once, and faded once the fresh read has been out a
 *   second. Inside a part that fades as a whole (an Overview card) the read tells that part instead.
 * - Failing: a note under the slot's corner, which takes no room.
 * - `hold`: a change of subject keeps the last answer in place, dimmed, until the new one lands.
 *
 * An answer that comes after a wait fades in at its place, and a slot that draws nothing takes no
 * room. One element: `className` lays it out where it stands (a column's `flex-1`).
 */
export function Slot<T>({ of, shape, hold = false, className, children }: { of: SlotRead<T>; shape: ReactNode; hold?: boolean; className?: string | undefined; children: (answer: T) => ReactNode }) {
  const unknown = of.state === 'unknown'
  const last = useRef<{ answer: T } | undefined>(undefined)
  const waited = useRef(false)
  const held = hold && unknown && last.current !== undefined
  const marked = useSkeleton(unknown && !held)
  if (marked) waited.current = true
  // Not unknown once the mark is gone: a slot that is not held draws its mark for as long as it waits.
  const drawn = !held && !marked
  if (drawn) last.current = { answer: of.value }
  const around = useContext(StaleReads)
  const old = useLate(drawn && of.state === 'kept' && around === null)
  return (
    <div
      // A new element when the answer comes, so it fades in from nothing at its place.
      key={held ? 'held' : marked ? 'wait' : 'answer'}
      aria-busy={unknown || undefined}
      data-stale={old || undefined}
      className={cn('relative transition-opacity empty:hidden', drawn && waited.current && 'starting:opacity-0', (held || old) && 'opacity-60', className)}
    >
      {held ? (
        children(last.current!.answer)
      ) : marked ? (
        <div role="status">
          <span className="sr-only">Loading…</span>
          <div aria-hidden>{shape}</div>
        </div>
      ) : (
        children(of.value)
      )}
      {of.failing && drawn && <p className="pointer-events-none absolute top-full right-0 text-xs text-muted-foreground">Not up to date</p>}
    </div>
  )
}

/** Whether `on` has held for {@link FADE_AFTER_MS}: a kept answer still not read again by then is marked old. */
function useLate(on: boolean): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) return
    const timer = setTimeout(() => setLate(true), FADE_AFTER_MS)
    return () => {
      clearTimeout(timer)
      setLate(false)
    }
  }, [on])
  return late
}

/** The rows of a list while they are read, in the rows' own shape and height: a {@link Slot}'s `shape`. */
export function RowShapes({ rows = 2 }: { rows?: number }) {
  return Array.from({ length: rows }, (_, at) => (
    <div key={at} className="flex items-center gap-3 md:h-10 max-md:h-11">
      <Skeleton className="size-4 shrink-0 rounded-full" />
      <Skeleton className={cn('h-4', at % 2 === 0 ? 'w-2/3' : 'w-1/2')} />
    </div>
  ))
}

/**
 * The rows of a part drawn on a card while they are read, as tall as the card that comes: its card, with `rows` rows
 * of a {@link PanelRow}'s height (`lines`: 1 for a row of one line, 44; 2 for a name over its facts, 64). A {@link Slot}'s
 * `shape` for a part whose answer is a card of rows, so the answer moves nothing beside it or under it. As the look draws
 * a row while it is read: its mark a 12 square, each line a bar centred on it, 10 on a name's line and 8 on its facts', so
 * the shapes stand 16 in from the card's every edge, as its words do. `before`: the rows have a column after their mark,
 * as a ticket's priority ({@link PanelRow}'s `before`), left empty so the names' bars start where the names will.
 */
export function PanelShape({ rows = 1, lines = 2, before = false }: { rows?: number; lines?: 1 | 2; before?: boolean }) {
  return (
    <div className={cn(cardSurface, 'overflow-hidden')}>
      {Array.from({ length: rows }, (_, at) => (
        <div key={at} className={cn('relative flex items-start gap-3 px-4 py-3 before:absolute before:top-0 before:right-4 before:left-4 before:h-px not-first:before:bg-hairline', lines === 2 ? 'h-16' : 'h-11')}>
          <span className="flex h-5 w-4 shrink-0 items-center">
            <Skeleton className="size-3 rounded-sm" />
          </span>
          {before && <span className="h-5 w-6 shrink-0" />}
          <span className="min-w-0 flex-1">
            <span className="flex h-5 items-center">
              <Skeleton className={cn('h-2.5', at % 2 === 0 ? 'w-2/3' : 'w-1/2')} />
            </span>
            {lines === 2 && (
              <span className="mt-1 flex h-4 items-center">
                <Skeleton className="h-2 w-1/3" />
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * A sentence while it is read, as tall as it at every width: its likely words, drawn unseen (not text of the page,
 * nor said), each of their lines a 10 bar across its middle, as the look draws a line being read. A {@link Slot}'s
 * `shape` in the place the sentence will stand.
 */
export function WordsShape({ words }: { words: string }) {
  return <span data-shape={words} style={LINE_BAR} className="animate-skeleton box-decoration-clone text-transparent before:content-[attr(data-shape)] motion-reduce:animate-skeleton-still" />
}

// A bar 10 high across the middle of each line the words take.
const LINE_BAR = { backgroundImage: 'linear-gradient(var(--color-accent), var(--color-accent))', backgroundSize: '100% 0.625rem', backgroundPosition: '0 50%', backgroundRepeat: 'no-repeat' }

/** The room of an answer that is one sentence ("Nothing queued."), while it is read: a {@link Slot}'s `shape` for a part whose emptiest answer is that sentence, so its answer moves nothing under it by more than it outgrows the sentence. */
export function SentenceShape() {
  return (
    <div className="flex h-5 items-center">
      <Skeleton className="h-4 w-48 max-w-full" />
    </div>
  )
}
