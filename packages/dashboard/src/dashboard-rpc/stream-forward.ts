/**
 * Forward an async-iterable of events to a `send` sink until the source is exhausted or
 * the returned stop function is called (#426). This is the bridge behind a relayed
 * run's live feed: the agent is an `AsyncIterable` that replays its buffered history then follows
 * live, and each value becomes one `send(event)`. Transport-agnostic on purpose — a plain
 * callback, so the pump is driven and tested on its own, and the mount decides what a value
 * becomes on the wire.
 *
 * `onDone` fires when the source runs out on its own — a relayed agent that finished. Without it a
 * consumer cannot tell "nothing more is coming" from "nothing has happened yet", so an SSE
 * response would stay open forever on a stream that was already over.
 *
 * Returns a stop function that halts forwarding and cancels the iterator, releasing the
 * follower waiting on the next event. Idempotent. An absent source is a no-op.
 */
export function forwardStream<T>(
  iterable: AsyncIterable<T> | undefined,
  send: (value: T) => void,
  onDone?: () => void,
): () => void {
  if (!iterable) return () => {}
  const iterator = iterable[Symbol.asyncIterator]()
  let stopped = false
  void (async () => {
    try {
      for (let next = await iterator.next(); !next.done && !stopped; next = await iterator.next()) {
        send(next.value)
      }
    } catch {
      // the stream closed or the consumer went away
    }
    if (!stopped) onDone?.()
  })()
  return () => {
    stopped = true
    void iterator.return?.()
  }
}
