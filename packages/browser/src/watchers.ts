import type { ServerResponse } from 'node:http'
import type { ConsoleLog } from './console.js'
import { ACTED, CONSOLE, CURSOR, FRAME, jsonPart, PULSE, SELECTED, STATE, streamPart, type ActedPoint, type Cursor, type ScreenState } from './stream.js'

/**
 * Whoever watches the browser's screen, each through a stream of their own (stream.ts), and what
 * the screen shows them: the newest picture, the shape of the pointer, what the page has
 * selected, where the agent last acted, what the address bar says, and the console's lines. Each
 * watcher is told each of these once, as it changes, and someone who joins is told what the others
 * see. A stream too slow for the pictures gets the newest one when it is ready for it, never a
 * queue of old ones; anything else it could not take it is told at a later turn.
 */

/** How many may watch one browser at once: a person and their devices, generously. */
const MAX_VIEWERS = 8

/** One person watching: the answer their stream is written to, the picture kept for when it can take one, what it was last told the address bar says, the pointer looks like and the page has selected, and the number of the console line it gets next. */
interface Viewer {
  res: ServerResponse
  waiting?: Buffer
  said?: string
  shape?: Cursor
  selected?: string
  next: number
}

export type Watchers = ReturnType<typeof screenWatchers>

/** The watchers of a browser whose console is `log`: none until someone joins. */
export function screenWatchers(log: ConsoleLog) {
  const viewers = new Set<Viewer>()
  /** The newest picture Chrome drew; none while it draws none. */
  let latest: Buffer | undefined
  /** What the pointer looks like where the person last moved it. */
  let shape: Cursor = 'default'
  /** What the page has selected. */
  let selected = ''
  /** Where the agent last clicked or typed; none until it does, and none on a page it has not acted on. */
  let acted: ActedPoint | undefined

  /** The console lines a watcher has not got, as far as its stream takes them; the rest at a later turn. */
  const pour = (viewer: Viewer): void => {
    for (let line = log.from(viewer.next); line && !viewer.res.writableNeedDrain; line = log.from(viewer.next)) {
      viewer.res.write(jsonPart(CONSOLE, line))
      viewer.next = line.n + 1
    }
  }

  /** A picture for one watcher: now when its stream takes it, else kept, the newest only, for when it does. */
  const show = (viewer: Viewer, jpeg: Buffer): void => {
    if (viewer.res.writableNeedDrain) viewer.waiting = jpeg
    else viewer.res.write(streamPart(FRAME, jpeg))
  }

  /** What the pointer looks like, for one watcher that has not been told this shape. */
  const point = (viewer: Viewer): void => {
    if (viewer.shape === shape || viewer.res.writableNeedDrain) return
    viewer.shape = shape
    viewer.res.write(jsonPart(CURSOR, { cursor: shape }))
  }

  /** What the page has selected, for one watcher that has not been told this much. */
  const tellSelection = (viewer: Viewer): void => {
    if (viewer.selected === selected || viewer.res.writableNeedDrain) return
    viewer.selected = selected
    viewer.res.write(jsonPart(SELECTED, { text: selected }))
  }

  return {
    /** How many watch now. */
    get size(): number {
      return viewers.size
    },
    /** As many watch as may. */
    get full(): boolean {
      return viewers.size >= MAX_VIEWERS
    },

    /** Someone starts watching on `res`, and is told what the others see; the first one waits for the picture Chrome draws as it starts. Answers how they leave. */
    join(res: ServerResponse): () => void {
      const viewer: Viewer = { res, next: 0 }
      viewers.add(viewer)
      res.on('drain', () => {
        const kept = viewer.waiting
        delete viewer.waiting
        if (kept) show(viewer, kept)
        pour(viewer)
      })
      if (latest) show(viewer, latest)
      point(viewer)
      tellSelection(viewer)
      if (acted) res.write(jsonPart(ACTED, acted))
      pour(viewer)
      return () => void viewers.delete(viewer)
    },

    /** A new picture of the page, for every watcher. */
    picture(jpeg: Buffer): void {
      latest = jpeg
      for (const viewer of viewers) show(viewer, jpeg)
    },

    /** The picture there was is not what the page shows now: whoever joins waits for the next. */
    forgetPicture(): void {
      latest = undefined
    },

    /** What the pointer looks like where the person moved it, told to whoever has not been told it. */
    cursor(now: Cursor): void {
      shape = now
      for (const viewer of viewers) point(viewer)
    },

    /** What the page has selected, told to whoever watches when it changed. */
    selection(now: string): void {
      if (now === selected) return
      selected = now
      for (const viewer of viewers) tellSelection(viewer)
    },

    /** Where the agent just acted, told to whoever watches, so they see the agent's own pointer move. */
    acted(where: ActedPoint): void {
      acted = where
      for (const viewer of viewers) if (!viewer.res.writableNeedDrain) viewer.res.write(jsonPart(ACTED, where))
    },

    /** The page went to another address: where the agent last acted is nowhere on it, so whoever joins from here on is told of no pointer at all. */
    actedNowhere(): void {
      acted = undefined
    },

    /** The console's lines each watcher has not got. */
    pourConsole(): void {
      for (const viewer of viewers) pour(viewer)
    },

    /** What the address bar says, told to each watcher that was told otherwise; to the others, with `pulse`, that the stream is still there. */
    address(state: ScreenState, pulse: boolean): void {
      const said = JSON.stringify(state)
      for (const viewer of viewers) {
        if (viewer.res.writableNeedDrain) continue
        if (viewer.said !== said) {
          viewer.said = said
          viewer.res.write(streamPart(STATE, Buffer.from(said)))
        } else if (pulse) viewer.res.write(streamPart(PULSE))
      }
    },

    /** Every stream ends: the browser is closing. */
    end(): void {
      for (const viewer of viewers) viewer.res.end()
    },
  }
}
