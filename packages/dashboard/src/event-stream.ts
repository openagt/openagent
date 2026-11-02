/**
 * A replayable, multi-consumer stream of events: buffer every event, hand out live async
 * iterators, and replay history from an offset (tail=N replay).
 *
 * Absorbed from `@gemstack/ai-autopilot` when that package was deleted (A2). Its element type
 * used to default to the supervisor's event; the only caller here passes `OpenAgentEvent`, so
 * the parameter is now required.
 */
export class EventStream<E> {
  private readonly buffer: E[] = []
  private readonly waiters: Array<() => void> = []
  private closed = false

  /** Append an event. Wire this in as an `onEvent` sink. Ignored once closed. */
  readonly push = (event: E): void => {
    if (this.closed) return
    this.buffer.push(event)
    for (const wake of this.waiters.splice(0)) wake()
  }

  /** Alias for {@link push}, reads well at the `onEvent:` call site. */
  get sink(): (event: E) => void {
    return this.push
  }

  /** Events buffered so far, from `fromOffset` (default 0) — Flue-style tail replay. */
  history(fromOffset = 0): E[] {
    return this.buffer.slice(fromOffset)
  }

  /** Number of events buffered. */
  get length(): number {
    return this.buffer.length
  }

  /** True once {@link close} has run. */
  get isClosed(): boolean {
    return this.closed
  }

  /** End the stream: live iterators drain their backlog, then finish. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const wake of this.waiters.splice(0)) wake()
  }

  /**
   * A fresh async iterator that replays every buffered event, then yields new
   * ones as they arrive, and finishes once the stream is closed and drained.
   * Independent iterators each keep their own cursor, so late consumers still
   * see the full history.
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<E> {
    let index = 0
    let done = false
    let pending: (() => void) | undefined
    const stream = this
    return {
      [Symbol.asyncIterator]() {
        return this
      },
      next(): Promise<IteratorResult<E>> {
        if (done) return Promise.resolve({ value: undefined, done: true })
        if (index < stream.buffer.length) {
          return Promise.resolve({ value: stream.buffer[index++]!, done: false })
        }
        if (stream.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise(resolve => {
          const wake = (): void => {
            pending = undefined
            if (done) return resolve({ value: undefined, done: true })
            if (index < stream.buffer.length) return resolve({ value: stream.buffer[index++]!, done: false })
            if (stream.closed) return resolve({ value: undefined, done: true })
            // Woken with nothing left for us (a concurrent next() on this iterator took the
            // event): the stream is still open, so wait again rather than resolve a false done.
            pending = wake
            stream.waiters.push(wake)
          }
          pending = wake
          stream.waiters.push(wake)
        })
      },
      // Cancel this iterator (e.g. an SSE client disconnected): drop its waiter so
      // it does not linger in `waiters` until the next push, and settle any pending
      // `next()`. Without this, a disconnected consumer leaks until the stream ends.
      return(): Promise<IteratorResult<E>> {
        done = true
        if (pending) {
          const i = stream.waiters.indexOf(pending)
          if (i >= 0) stream.waiters.splice(i, 1)
          const wake = pending
          pending = undefined
          wake()
        }
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  }
}
