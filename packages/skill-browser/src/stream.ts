/**
 * What the screen's stream carries, and how: one message after the other, each its kind (one
 * byte), its length (four bytes, big-endian) and its bytes. A picture is a whole JPEG; what the
 * address bar says is JSON. Nothing here is the machine's own: the browser's process writes the
 * stream, and the page that shows it, on whatever computer, reads it.
 */

/** Nothing: sent now and then on a stream that would else stand still, so no hop between takes it for dead. */
export const PULSE = 0
/** A picture of the page: a JPEG. */
export const FRAME = 1
/** What the address bar says: `{ url, title }` as JSON. */
export const STATE = 2

/** The longest message a reader takes: a picture of the page is a few hundred kilobytes. */
export const MAX_PART = 2 * 1024 * 1024
/** The longest `STATE` a reader takes, and the longest address and title a writer sends. */
export const MAX_STATE = 16 * 1024
export const MAX_URL = 2048
export const MAX_TITLE = 256

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
