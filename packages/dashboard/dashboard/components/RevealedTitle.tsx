import { useState } from 'react'

// A run just started: its title comes in letter by letter, each out of a light blur, as Claude
// Code on the web shows a new session's. The stand-in row starts it; the run's own row, taking that
// row's place a moment later, goes on from where it was, so the title neither restarts nor jumps
// to whole. Kept by the title's words, for as long as a reveal lasts.
const REVEAL_STEP_MS = 30
const REVEAL_LETTERS = 24
const REVEAL_MS = REVEAL_STEP_MS * REVEAL_LETTERS + 90
const revealedSince = new Map<string, number>()

export function RevealedTitle({ text, start }: { text: string; start: boolean }) {
  // How far into its reveal the title is, read once, when the row is drawn first.
  const [elapsed] = useState(() => {
    const now = Date.now()
    for (const [words, since] of revealedSince) if (now - since > REVEAL_MS) revealedSince.delete(words)
    const since = revealedSince.get(text)
    if (since !== undefined) return now - since
    if (!start) return REVEAL_MS
    revealedSince.set(text, now)
    return 0
  })
  if (elapsed >= REVEAL_MS) return text
  const letters = [...text]
  const delay = (at: number) => ({ animationDelay: `${Math.min(at, REVEAL_LETTERS) * REVEAL_STEP_MS - elapsed}ms` })
  return (
    <>
      {letters.slice(0, REVEAL_LETTERS).map((letter, at) => (
        <span key={at} className="letter-in" style={delay(at)}>
          {letter}
        </span>
      ))}
      {letters.length > REVEAL_LETTERS && (
        <span className="letter-in" style={delay(REVEAL_LETTERS)}>
          {letters.slice(REVEAL_LETTERS).join('')}
        </span>
      )}
    </>
  )
}
