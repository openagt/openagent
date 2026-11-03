import { useEffect, useRef, useState } from 'react'

// A text that grows in chunks, shown growing at a steady pace, a word at a time, as Claude Code on
// the web writes a message: about 300 characters a second, faster only when it falls far behind. How
// far each message got, and when each of its words came, is kept here by its opening words: the row
// being written and the whole message that takes its place, or a row drawn again, go on from the
// same point, so nothing jumps, starts over or fades in twice, and two messages never mix. A reader who asked for less
// motion gets it whole.

const CHARS_PER_SECOND = 300
/** How long what has arrived may take at most to show, however much it is. */
const MOST_SECONDS = 4
/** How much of a message's opening says it is the same message. */
const SAME_CHARS = 40

/** Each message being shown at its pace: how far it got and when each of its words first showed, the newest last. */
const messages: { text: string; shown: number; wordsAt: number[] }[] = []
/** How many messages are remembered: a few are written one after another. */
const KEPT = 8

/** The message this text is, as far as it has been written: the same opening words. */
function messageOf(text: string): { text: string; shown: number; wordsAt: number[] } | undefined {
  return messages.find(one => {
    const opening = Math.min(SAME_CHARS, text.length, one.text.length)
    return opening > 0 && text.slice(0, opening) === one.text.slice(0, opening)
  })
}

/** Start remembering a message, from how far it has been shown. */
function remember(text: string, shown: number): void {
  messages.push({ text, shown, wordsAt: [] })
  if (messages.length > KEPT) messages.shift()
}

/** When the word at this place of this message first showed: now, the first time it is asked. */
export function wordShownAt(text: string, at: number): number {
  const words = messageOf(text)?.wordsAt
  if (words === undefined) return performance.now()
  return (words[at] ??= performance.now())
}

/** How far to show `text`, given that `at` characters may: on to the end of the word that reaches. */
export function toWordEnd(text: string, at: number): number {
  if (at <= 0) return 0
  if (at >= text.length) return text.length
  const space = text.slice(at).search(/\s/)
  return space === -1 ? text.length : at + space
}

/** Whether the reader asked for less motion. */
function still(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * How much of `text` to show now. `fresh`: a message being written, shown from its start; else a
 * message shown whole, unless it is the one being written a moment ago, which goes on from where it was.
 */
export function useSteadyText(text: string, fresh: boolean): { shown: string; done: boolean } {
  const [length, setLength] = useState(() => {
    if (still()) return text.length
    const known = messageOf(text)
    if (known) return Math.min(known.shown, text.length)
    // Shown whole: drawn again, from the record or from the live line, it stays whole.
    if (!fresh) {
      remember(text, text.length)
      return text.length
    }
    remember(text, 0)
    return 0
  })
  const at = useRef(length)
  useEffect(() => {
    if (still() || at.current >= text.length) {
      at.current = text.length
      setLength(text.length)
      return
    }
    if (!messageOf(text)) remember(text, at.current)
    let frame = 0
    let last = performance.now()
    const step = (now: number) => {
      const behind = text.length - at.current
      // A frame's time may be a moment before the pace began: it never goes back.
      at.current = Math.min(text.length, at.current + (Math.max(CHARS_PER_SECOND, behind / MOST_SECONDS) * Math.max(0, now - last)) / 1000)
      last = Math.max(last, now)
      const shown = toWordEnd(text, Math.floor(at.current))
      const known = messageOf(text)
      if (known) Object.assign(known, { text, shown })
      setLength(shown)
      if (shown < text.length) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [text])
  return { shown: text.slice(0, length), done: length >= text.length }
}
