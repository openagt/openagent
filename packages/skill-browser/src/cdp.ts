/**
 * The DevTools protocol, spoken to one page over Node's global WebSocket: no dependency. The
 * debugging port is reached only from this process; it is never handed to a page or a viewer.
 */

/** One page Chrome is showing, from `/json/list`. */
export interface PageTarget {
  id: string
  type: string
  url: string
  title: string
  webSocketDebuggerUrl?: string
}

export interface CdpSession {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** `size`: how long the message was as it came, in characters. */
  on(method: string, handler: (params: Record<string, unknown>, size: number) => void): void
  close(): void
  /** Whether the socket is still open. */
  readonly open: boolean
}

export async function listPages(endpoint: string): Promise<PageTarget[]> {
  const res = await fetch(`${endpoint}/json/list`)
  if (!res.ok) return []
  const body = (await res.json()) as PageTarget[]
  return Array.isArray(body) ? body : []
}

/**
 * The page the agent is on: Chrome lists pages most recently used first, so the first one with a
 * socket. A link that opens a new tab moves the agent there, and the viewer follows.
 */
export function activePage(targets: readonly PageTarget[]): PageTarget | undefined {
  return targets.find(t => t.type === 'page' && !!t.webSocketDebuggerUrl)
}

export async function connectCdp(webSocketDebuggerUrl: string): Promise<CdpSession> {
  const ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error(`could not reach the page at ${webSocketDebuggerUrl}`)), { once: true })
  })
  let open = true
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const handlers = new Map<string, ((params: Record<string, unknown>, size: number) => void)[]>()
  ws.addEventListener('close', () => {
    open = false
    for (const p of pending.values()) p.reject(new Error('the page closed'))
    pending.clear()
  })
  ws.addEventListener('message', ev => {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } }
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (typeof msg.id === 'number') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? 'DevTools error'))
      else p.resolve(msg.result)
      return
    }
    if (msg.method) for (const handler of handlers.get(msg.method) ?? []) handler(msg.params ?? {}, String(ev.data).length)
  })
  return {
    get open() {
      return open
    },
    send: <T>(method: string, params: Record<string, unknown> = {}) =>
      new Promise<T>((resolve, reject) => {
        if (!open) return reject(new Error('the page closed'))
        const id = nextId++
        pending.set(id, { resolve: v => resolve(v as T), reject })
        ws.send(JSON.stringify({ id, method, params }))
      }),
    on: (method, handler) => void handlers.set(method, [...(handlers.get(method) ?? []), handler]),
    close: () => ws.close(),
  }
}
