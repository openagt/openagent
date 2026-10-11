import type { IncomingMessage, ServerResponse } from 'node:http'
import { bearerAuthorized } from './bridge-endpoints.js'
import { end, readPost, requireGet, sendJson } from './http.js'
import type { BridgeStartInput, BridgeStartRequest } from './bridge-starts.js'

/**
 * The run-facing side of the session start-queue (#1328): how a web run asks the daemon for a
 * cloud session created by the browser extension, and learns what it became.
 *
 * A run is a separate process the daemon never started, so it cannot touch the daemon's queue
 * directly; it reaches these routes at the URL it finds in its environment
 * ({@link DAEMON_URL_ENV}), presenting the bridge token it reads from the registry. The
 * extension's own side of the same queue lives on `/_bridge/start` and `/_bridge/started`.
 *
 * Nothing sets {@link DAEMON_URL_ENV} today (#1774): web runs left the launcher when the daemon
 * stopped running agents, so the only caller of these routes is gone until web runs return, and
 * then whatever line a project's start hook names will have to carry the URL. The extension's
 * side of the queue is live either way, which is why these routes stay.
 */

export const WEB_START_PREFIX = '/_web-start'

/** The environment variable a run finds its daemon's URL in. */
export const DAEMON_URL_ENV = 'OPENAGENT_DAEMON_URL'

/** What the daemon wires behind the routes. Absent when the bridge is off, which 404s them. */
export interface WebStartHandlers {
  /** The bridge token every call must present — the same one the extension holds. */
  token: string
  /** Whether an extension has spoken to this daemon recently enough to be trusted with a request. */
  extensionAlive: () => boolean
  /** Queue a request, or say what is wrong with it. */
  request: (input: BridgeStartInput) => BridgeStartRequest | string
  get: (id: string) => BridgeStartRequest | undefined
}

const MAX_BODY = 512 * 1024
const ID = /^[A-Za-z0-9-]{1,64}$/

/** Route a `/_web-start*` request. */
export async function handleWebStartRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  handlers: WebStartHandlers | undefined,
): Promise<void> {
  if (!handlers) return end(res, 404, 'bridge not enabled')
  if (!bearerAuthorized(req, handlers.token)) return end(res, 401, 'unauthorized')
  if (pathname === WEB_START_PREFIX) return handleRequest(req, res, handlers)
  const id = pathname.slice(WEB_START_PREFIX.length + 1)
  if (pathname.startsWith(`${WEB_START_PREFIX}/`) && ID.test(id)) return handleState(req, res, id, handlers)
  end(res, 404, 'not found')
}

/**
 * `POST /_web-start`: queue a session request. 409 when no extension is around to drain the
 * queue — the caller then has its answer at once rather than after a timeout, and can hand off
 * another way.
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse, handlers: WebStartHandlers): Promise<void> {
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  if (!handlers.extensionAlive()) return end(res, 409, 'no browser extension has spoken to this daemon recently')
  const body = await readPost(req, res, MAX_BODY)
  if (body === undefined) return
  if (typeof body !== 'object' || body === null) return end(res, 400, 'body must be an object')
  const { repo, branch, prompt, model } = body as Record<string, unknown>
  if (typeof repo !== 'string' || typeof branch !== 'string' || typeof prompt !== 'string') {
    return end(res, 400, 'repo, branch and prompt must be strings')
  }
  if (model !== undefined && typeof model !== 'string') return end(res, 400, 'model must be a string')
  const queued = handlers.request({ repo, branch, prompt, ...(model !== undefined ? { model } : {}) })
  if (typeof queued === 'string') return end(res, 400, queued)
  sendJson(res, { id: queued.id }, 202)
}

/** `GET /_web-start/<id>`: where the request stands. */
async function handleState(req: IncomingMessage, res: ServerResponse, id: string, handlers: WebStartHandlers): Promise<void> {
  if (!requireGet(req, res)) return
  const start = handlers.get(id)
  if (!start) return end(res, 404, 'no such start request')
  sendJson(res, {
    state: start.state,
    ...(start.sessionId ? { sessionId: start.sessionId } : {}),
    ...(start.url ? { url: start.url } : {}),
    ...(start.note ? { note: start.note } : {}),
  })
}
