/**
 * What the screen's stream carries, and how: one message after the other, each its kind (one
 * byte), its length (four bytes, big-endian) and its bytes. A picture is a whole JPEG; what the
 * address bar says, and a line of the page's console, are JSON. Nothing here is the machine's
 * own: the browser's process writes the stream, and the page that shows it, on whatever computer,
 * reads it.
 */

/** Nothing: sent now and then on a stream that would else stand still, so no hop between takes it for dead. */
export const PULSE = 0
/** A picture of the page: a JPEG. */
export const FRAME = 1
/** What the address bar says: `{ url, title }` as JSON. */
export const STATE = 2

/** A line of the page's console: a {@link ConsoleLine} as JSON. */
export const CONSOLE = 3
/** What the pointer looks like where the person points: `{ cursor }` as JSON, one CSS cursor name. */
export const CURSOR = 4
/** Where the agent last did something to the page: an {@link ActedPoint} as JSON. */
export const ACTED = 5

/** The longest message a reader takes: a picture of the page is a few hundred kilobytes. */
export const MAX_PART = 2 * 1024 * 1024
/** The longest `STATE` a reader takes, and the longest address and title a writer sends. */
export const MAX_STATE = 16 * 1024
export const MAX_URL = 2048
export const MAX_TITLE = 256
/**
 * The longest `CONSOLE` a reader takes, and the longest text and place a writer sends: a line
 * of that length is under it however its characters are written as JSON.
 */
export const MAX_CONSOLE = 16 * 1024
export const MAX_CONSOLE_TEXT = 2000
export const MAX_CONSOLE_WHERE = 300

/** The longest `CURSOR` or `ACTED` a reader takes: each is one small object. */
export const MAX_SMALL = 256
/** The largest coordinate a point may name: past any picture a page is drawn at. */
const MAX_POINT = 100_000

const HEAD = 5

export interface StreamPart {
  kind: number
  bytes: Uint8Array
}

/** What the address bar says. */
export interface ScreenState {
  url: string
  title: string
}

/**
 * The cursors a screen says the page shows, the CSS keywords and nothing else: it is the page
 * that says what its cursor is, and what a page says is nobody's to put in a style, where
 * `url(…)` would have whoever watches fetch a picture of that page's choosing.
 */
export const CURSORS = [
  'default',
  'none',
  'context-menu',
  'help',
  'pointer',
  'progress',
  'wait',
  'cell',
  'crosshair',
  'text',
  'vertical-text',
  'alias',
  'copy',
  'move',
  'no-drop',
  'not-allowed',
  'grab',
  'grabbing',
  'all-scroll',
  'col-resize',
  'row-resize',
  'n-resize',
  'e-resize',
  's-resize',
  'w-resize',
  'ne-resize',
  'nw-resize',
  'se-resize',
  'sw-resize',
  'ew-resize',
  'ns-resize',
  'nesw-resize',
  'nwse-resize',
  'zoom-in',
  'zoom-out',
] as const
export type Cursor = (typeof CURSORS)[number]

/** What a `CURSOR` message says; nothing when it is no cursor this screen passes on. */
export function readCursor(bytes: Uint8Array): Cursor | undefined {
  if (bytes.length > MAX_SMALL) return undefined
  try {
    const said = JSON.parse(new TextDecoder().decode(bytes)) as { cursor?: unknown } | null
    return CURSORS.find(known => known === said?.cursor)
  } catch {
    return undefined
  }
}

/** Where the agent last clicked or typed, in the picture's own pixels. */
export interface ActedPoint {
  x: number
  y: number
  act: 'click' | 'type'
}

/** What an `ACTED` message says; nothing when it is no point of the agent's. */
export function readActed(bytes: Uint8Array): ActedPoint | undefined {
  if (bytes.length > MAX_SMALL) return undefined
  try {
    const said = JSON.parse(new TextDecoder().decode(bytes)) as { x?: unknown; y?: unknown; act?: unknown } | null
    const place = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_POINT
    if (!said || !place(said.x) || !place(said.y) || (said.act !== 'click' && said.act !== 'type')) return undefined
    return { x: said.x as number, y: said.y as number, act: said.act }
  } catch {
    return undefined
  }
}

/** What kind of line: the console's own levels, and `went` for the page going to another address. */
export const CONSOLE_LEVELS = ['error', 'warning', 'info', 'log', 'debug', 'went'] as const
export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number]

/** One line of the page's console. */
export interface ConsoleLine {
  /** Its number among the lines of this browser, from 1: lines come in this order, each once. */
  n: number
  /** When it was said, in milliseconds since 1970. */
  at: number
  level: ConsoleLevel
  /** What was said; for `went`, the address. */
  text: string
  /** Where in the page's code it was said, or what could not be loaded: an address, with a line number when there is one. */
  where?: string
  /** On a `went` line, how many errors the page it went to had said already: a tab the agent came back to. */
  errors?: number
}

/** One message, as it goes on the stream. */
export function streamPart(kind: number, bytes: Uint8Array = new Uint8Array(0)): Uint8Array {
  const part = new Uint8Array(HEAD + bytes.length)
  part[0] = kind
  new DataView(part.buffer).setUint32(1, bytes.length)
  part.set(bytes, HEAD)
  return part
}

/**
 * The messages in a stream that arrives in pieces of any size. A message longer than
 * {@link MAX_PART} is no message of a screen's: the reader throws, and its caller drops the
 * stream. The pieces are kept as they came and joined once per message, so a message sent a few
 * bytes at a time costs no more to read than one sent whole.
 */
export function streamReader(): (chunk: Uint8Array) => StreamPart[] {
  let pieces: Uint8Array[] = []
  let held = 0
  /** The first `count` bytes held, taken out. */
  const take = (count: number): Uint8Array => {
    const out = new Uint8Array(count)
    let at = 0
    let whole = 0
    while (at < count) {
      const piece = pieces[whole]!
      const part = piece.subarray(0, count - at)
      out.set(part, at)
      at += part.length
      if (part.length === piece.length) whole++
      else pieces[whole] = piece.subarray(part.length)
    }
    pieces.splice(0, whole)
    held -= count
    return out
  }
  /** The first bytes held, looked at and left: a message's kind and length. */
  const peek = (): Uint8Array => {
    if (pieces[0]!.length >= HEAD) return pieces[0]!
    const head = take(HEAD)
    pieces.unshift(head)
    held += HEAD
    return head
  }
  return chunk => {
    if (chunk.length) {
      pieces.push(chunk)
      held += chunk.length
    }
    const parts: StreamPart[] = []
    while (held >= HEAD) {
      const head = peek()
      const length = new DataView(head.buffer, head.byteOffset + 1, 4).getUint32(0)
      if (length > MAX_PART) {
        pieces = []
        held = 0
        throw new Error('the stream is not a screen')
      }
      if (held < HEAD + length) break
      const kind = take(HEAD)[0]!
      parts.push({ kind, bytes: take(length) })
    }
    return parts
  }
}

/** What a `STATE` message says; nothing when it says nothing readable, or more than an address bar holds. */
export function readState(bytes: Uint8Array): ScreenState | undefined {
  if (bytes.length > MAX_STATE) return undefined
  try {
    const said = JSON.parse(new TextDecoder().decode(bytes)) as { url?: unknown; title?: unknown } | null
    return said && typeof said.url === 'string' && typeof said.title === 'string' ? { url: said.url.slice(0, MAX_URL), title: said.title.slice(0, MAX_TITLE) } : undefined
  } catch {
    return undefined
  }
}

/** What a `CONSOLE` message says; nothing when it is no line of a console, or longer than one. */
export function readConsoleLine(bytes: Uint8Array): ConsoleLine | undefined {
  if (bytes.length > MAX_CONSOLE) return undefined
  try {
    const said = JSON.parse(new TextDecoder().decode(bytes)) as { n?: unknown; at?: unknown; level?: unknown; text?: unknown; where?: unknown; errors?: unknown } | null
    if (!said || !Number.isSafeInteger(said.n) || (said.n as number) < 1 || !Number.isFinite(said.at) || typeof said.text !== 'string') return undefined
    const level = CONSOLE_LEVELS.find(known => known === said.level)
    if (!level) return undefined
    return {
      n: said.n as number,
      at: said.at as number,
      level,
      text: said.text.slice(0, MAX_CONSOLE_TEXT),
      ...(typeof said.where === 'string' && said.where ? { where: said.where.slice(0, MAX_CONSOLE_WHERE) } : {}),
      ...(level === 'went' && Number.isSafeInteger(said.errors) && (said.errors as number) > 0 ? { errors: said.errors as number } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * How large the picture in a JPEG is, read off its header without decoding it; nothing when the
 * bytes are no JPEG. A reader asks before it decodes: a small file may say it is a picture of
 * any size, and decoding is where that size is paid for.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return undefined
    const marker = bytes[at + 1]!
    // A fill byte before a marker, and the markers that carry no length.
    if (marker === 0xff) {
      at++
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!
    // The start of a frame says the size. Three markers in its range are not one and are stepped
    // over like any other; the picture's data beginning before any start of frame ends the search.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > bytes.length) return undefined
      return { height: (bytes[at + 5]! << 8) | bytes[at + 6]!, width: (bytes[at + 7]! << 8) | bytes[at + 8]! }
    }
    if (marker === 0xda || length < 2) return undefined
    at += 2 + length
  }
  return undefined
}
