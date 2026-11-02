import type { LiveFeedEvent } from '../../src/dashboard-rpc/index.js'

// The dashboard's whole transport (F3): `POST /_rpc/<name>` for calls, `GET /_rpc/events` for the
// live feed. Same-origin, so there is nothing to configure.
//
// This replaced Telefunc. What Telefunc gave was type-safety across a package boundary, which A7
// removed — the signatures are now imported directly from the implementations, one package away
// rather than one network away. What it cost was a build-time transform over every `.telefunc.ts`
// file, a registration table pinning each RPC to the client-baked key of the dashboard source path
// it was re-exported from (rename a file, break every call), a re-export shim per module to keep
// those keys stable, and a dev-server plugin to undo a URL its own client wrote.

const RPC_PREFIX = '/_rpc'

/** What the mount answers with: the return value, or the reason there is none. */
type RpcResponse = { ret?: unknown; error?: string }

/**
 * A typed stub for one RPC. `F` is the implementation's own signature, so the call is checked
 * against the real thing and a rename that misses a caller is a type error rather than a 404.
 *
 * Arguments and return value go through JSON, which is what they always did — the wire has no
 * opinion about `Date` or `Map` here because none of these RPCs pass one.
 */
export function rpc<F extends (...args: never[]) => unknown>(
  name: string,
): (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>> {
  const call = async (...args: unknown[]): Promise<unknown> => {
    // An optional argument left out must arrive left out: JSON writes a trailing `undefined` as
    // `null`, which the implementation reads as a value (`--driver null`).
    let sent = args.length
    while (sent > 0 && args[sent - 1] === undefined) sent--
    const res = await fetch(`${RPC_PREFIX}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args.slice(0, sent)),
    })
    // A non-JSON body means something other than the mount answered (a proxy, an error page), and
    // reporting "unexpected token <" from deep in a component is how that used to surface.
    const text = await res.text()
    let body: RpcResponse
    try {
      body = text ? (JSON.parse(text) as RpcResponse) : {}
    } catch {
      throw new Error(`${name} got a non-JSON reply (${res.status})`)
    }
    if (!res.ok) throw new Error(body.error ?? `${name} failed (${res.status})`)
    return body.ret
  }
  return call as (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>
}

/**
 * A live feed of one agent's events.
 *
 * The contract the dashboard relies on, unchanged from the Channel it replaced: `listen` per
 * event, and `onClose` telling a clean end (the server is done — an unknown project, a finished
 * relay stream) apart from a dropped one (retry with backoff). That distinction is the whole
 * reason the feed can say "the daemon is not answering" instead of looking like a quiet agent.
 */
export interface EventChannel {
  listen(onEvent: (event: LiveFeedEvent) => void): void
  onClose(onClosed: (err?: Error) => void): void
  close(): void
}

/**
 * Subscribe to an agent's events over SSE. Rejects when the subscription itself fails, which the
 * caller retries; a stream that opens and later dies closes with an error instead.
 *
 * Read with `fetch` rather than `EventSource` because `EventSource` reconnects on its own
 * schedule, which would fight the caller's backoff and erase the clean-vs-dropped distinction —
 * it reports every end as an error and retries even the ones that meant "done".
 */
export async function openEvents(projectId: string, agentId?: string): Promise<EventChannel> {
  const params = new URLSearchParams({ projectId, ...(agentId ? { agentId: agentId } : {}) })
  const controller = new AbortController()
  const res = await fetch(`${RPC_PREFIX}/events?${params.toString()}`, { signal: controller.signal })
  if (!res.ok || !res.body) throw new Error(`could not subscribe to events (${res.status})`)

  let onEvent: ((event: LiveFeedEvent) => void) | undefined
  // What comes before anyone listens: the stream is read from the moment it opens, and a server
  // that has the run's first lines already sends them at once. Dropped, the prompt went missing.
  const held: LiveFeedEvent[] = []
  let onClosed: ((err?: Error) => void) | undefined
  let closed = false
  const finish = (err?: Error): void => {
    if (closed) return
    closed = true
    onClosed?.(err)
  }

  void (async () => {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE frames are separated by a blank line; a partial one waits for the rest.
        let split = buffer.indexOf('\n\n')
        for (; split >= 0; split = buffer.indexOf('\n\n')) {
          const frame = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          const data = frame
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())
            .join('')
          if (!data) continue
          try {
            const event = JSON.parse(data) as LiveFeedEvent
            if (onEvent) onEvent(event)
            else held.push(event)
          } catch {
            // A torn frame is one lost event, not a dead feed.
          }
        }
      }
      finish() // the server ended it: a clean close
    } catch (err) {
      // An abort is our own `close()`, which is not an outage.
      finish(controller.signal.aborted ? undefined : err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return {
    listen: cb => {
      onEvent = cb
      for (const event of held.splice(0)) cb(event)
    },
    onClose: cb => {
      onClosed = cb
      if (closed) cb()
    },
    close: () => {
      if (!closed) controller.abort()
      finish()
    },
  }
}
