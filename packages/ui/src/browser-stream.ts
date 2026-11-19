/**
 * The DevTools connection to a Chrome the daemon owns: the bridge browser's (#1332). Chrome
 * refuses DevTools socket connections carrying an `Origin` header unless launched with
 * `--remote-allow-origins`, and opening that up would let any page the user happens to visit
 * drive the browser. So the debug port stays unreachable from the web, and this process is the
 * only one that talks to it.
 */

/** What a caller needs from a CDP connection, so a test can stand in for Chrome. */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  close(): void
}

/** How a caller reaches a browser or a page. Injectable: the real one speaks WebSocket to Chrome. */
export type CdpConnect = (webSocketDebuggerUrl: string) => Promise<CdpSession>

/**
 * Talk CDP to Chrome over its debugger socket. Node's global WebSocket is enough, which is
 * what keeps this dependency-free.
 */
export const connectCdp: CdpConnect = async (webSocketDebuggerUrl: string) => {
  const ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error(`could not open ${webSocketDebuggerUrl}`)), { once: true })
  })

  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  ws.addEventListener('message', ev => {
    let msg: { id?: number; result?: unknown; error?: { message?: string } }
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (typeof msg.id !== 'number') return
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message ?? 'CDP error')) : p.resolve(msg.result)
  })
  // A call Chrome never answers because the socket went (Chrome quit, or got the same Ctrl+C
  // the daemon did) fails, rather than holding whoever awaits it forever.
  const gone = (): void => {
    for (const p of pending.values()) p.reject(new Error(`the connection to ${webSocketDebuggerUrl} closed`))
    pending.clear()
  }
  ws.addEventListener('close', gone)
  ws.addEventListener('error', gone)

  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) return reject(new Error(`the connection to ${webSocketDebuggerUrl} is closed`))
        const id = nextId++
        pending.set(id, { resolve, reject })
        try {
          ws.send(JSON.stringify({ id, method, params }))
        } catch (err) {
          pending.delete(id)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      }),
    close: () => ws.close(),
  }
}
