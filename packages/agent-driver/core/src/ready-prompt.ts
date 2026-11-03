import type { DriverTurn, ReadyPrompt } from './types.js'

/**
 * A {@link ReadyPrompt} around a turn that is started at once: `start` spawns the process and is
 * handed the words as a promise, to write when they come, and a signal that ends the process when
 * the prompt is cancelled. The turn runs from the start; `prompt` only lets its words go.
 */
export function readyPrompt(start: (words: Promise<string>, stop: AbortSignal) => Promise<DriverTurn>): ReadyPrompt {
  const stop = new AbortController()
  let give: (text: string) => void = () => {}
  const words = new Promise<string>(resolve => {
    give = resolve
  })
  let asked = false
  let ended = false
  const turn = start(words, stop.signal).finally(() => {
    ended = true
  })
  // A process cancelled, or one that died while it waited, is a turn nobody awaits.
  turn.catch(() => {})
  return {
    prompt(text) {
      if (asked) return Promise.reject(new Error('a ready prompt takes one prompt'))
      asked = true
      if (ended) return Promise.reject(new Error('the ready prompt ended before it was asked'))
      give(text)
      return turn
    },
    get waiting() {
      return !asked && !ended && !stop.signal.aborted
    },
    cancel() {
      stop.abort()
    },
  }
}
