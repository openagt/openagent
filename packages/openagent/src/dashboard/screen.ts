import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { eventsOf, isRunId, type AnyDiaryLine } from '../store/index.js'
import { liveScreen } from '../screens.js'
import { end, readJsonBody } from './http.js'
import { machineFetch } from './machine-call.js'
import type { RemoteTarget } from './remote-run.js'

/**
 * A run's live screen, for whoever watches the run from this OpenAgent: on this computer, on a
 * phone that got in, or on another computer that follows the run. A `screen` line in the run's
 * diary names where the screen answers, on the loopback of the computer the run is on. That
 * address is reached by nothing but the OpenAgent of that computer, which passes on two calls
 * and no other:
 *
 * - `GET  /_screen/stream?project=<id>&run=<id>`: what the screen shows, as the screen's own bytes.
 * - `POST /_screen/input?project=<id>&run=<id>`: what the person did on it, as JSON.
 *
 * For a run this computer follows on another machine, both are asked of that machine
 * (`/_relay/screen/…`), with this computer's key there.
 *
 * What a screen answers is written by whatever the agent ran, and for a run on another machine
 * it comes from that machine. So it is never a page here: the bytes are answered as bytes no
 * browser renders or runs, and the answer to an input is its status alone. What draws the screen
 * is this OpenAgent's own.
 */
export const SCREEN_PREFIX = '/_screen'

/** The two calls a screen takes. */
export type ScreenCall = 'stream' | 'input'

export interface ScreenHandlers {
  /** Where the live screen of a run on this computer answers; nothing when the run has none. */
  local: (projectId: string, agentId: string) => Promise<string | undefined>
  /** The machine a run this computer follows is on; nothing for a run of this computer's own. */
  remote: (agentId: string) => RemoteTarget | undefined
}

/** A person's click or a few typed letters, generously. */
const MAX_INPUT = 16 * 1024
/** How long a screen gets to take an input. */
const INPUT_TIMEOUT_MS = 15_000

/** The headers of every answer: bytes, kept by nobody, that no browser takes for a page or runs. */
const INERT = {
  'content-type': 'application/octet-stream',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "sandbox; default-src 'none'",
}

/** The call a path names, when it names one. */
export function screenCallOf(pathname: string, prefix: string): ScreenCall | undefined {
  const rest = pathname.slice(prefix.length + 1)
  return pathname.startsWith(`${prefix}/`) && (rest === 'stream' || rest === 'input') ? rest : undefined
}

/**
 * The address one call to a screen goes to. Only a screen on this computer's own loopback is
 * called, at its own two paths: the line that names it was written by whatever the agent ran.
 */
export function screenCallAddress(screen: string, call: ScreenCall): string | undefined {
  let at: URL
  try {
    at = new URL(screen)
  } catch {
    return undefined
  }
  if (at.protocol !== 'http:' || at.hostname !== '127.0.0.1' || !at.port || at.pathname !== '/') return undefined
  return `http://127.0.0.1:${at.port}/${call}${at.search}`
}

/**
 * Where the live screen of the run whose diary is the file at `diary` answers; nothing when it
 * has none, or no diary. Only the lines that can say so are read as JSON, a screen's and a run's
 * end: a diary is as long as the run, and this is asked for as long as someone looks.
 */
export async function screenInDiary(diary: string): Promise<string | undefined> {
  const text = await readFile(diary, 'utf8').catch(() => '')
  const lines = text.split('\n').flatMap(line => {
    if (!line.includes('"screen"') && !line.includes('"ended"')) return []
    try {
      return [JSON.parse(line) as AnyDiaryLine]
    } catch {
      return []
    }
  })
  return liveScreen(eventsOf(lines))
}

/** How long an answer of {@link kept} is good for: a person's clicks come in bursts, and each would read the whole diary. */
const KEPT_MS = 2_000

/**
 * `find`, asked at most once in a while for the same run, and once for all who ask at the same
 * moment: where a screen answers changes only when a browser opens or closes. Only a run's own
 * screen is kept: an ask that found none is asked again, and keeps nothing.
 */
export function kept(find: ScreenHandlers['local'], now: () => number = Date.now): ScreenHandlers['local'] {
  const answers = new Map<string, { screen: Promise<string | undefined>; until: number }>()
  return (projectId, agentId) => {
    const key = `${projectId}\n${agentId}`
    const answer = answers.get(key)
    if (answer && answer.until > now()) return answer.screen
    for (const [old, { until }] of answers) if (until <= now()) answers.delete(old)
    const screen = find(projectId, agentId)
    answers.set(key, { screen, until: now() + KEPT_MS })
    void screen.then(
      found => {
        if (found === undefined && answers.get(key)?.screen === screen) answers.delete(key)
      },
      () => {
        if (answers.get(key)?.screen === screen) answers.delete(key)
      },
    )
    return screen
  }
}

/** Route a `/_screen/*` request of this computer's own dashboard, or of a device that got in. */
export async function handleScreenRequest(req: IncomingMessage, res: ServerResponse, pathname: string, handlers: ScreenHandlers | undefined): Promise<void> {
  const call = screenCallOf(pathname, SCREEN_PREFIX)
  if (!handlers || !call) return end(res, 404, 'not found')
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams
  const projectId = query.get('project')
  const agentId = query.get('run')
  if (!projectId || !agentId) return end(res, 400, 'missing project or run')
  if (!isRunId(agentId)) return end(res, 400, 'not a run')
  const remote = handlers.remote(agentId)
  if (!remote) return passToScreen(req, res, call, await handlers.local(projectId, agentId).catch(() => undefined))
  const at = `${remote.url.replace(/\/+$/, '')}/_relay/screen/${call}?run=${encodeURIComponent(agentId)}&project=${encodeURIComponent(remote.project)}`
  await pass(req, res, call, init => machineFetch(at, remote.pin, { ...init, headers: { ...init.headers, authorization: `Bearer ${remote.key}` } }))
}

/** Pass one call on to the screen at `screen`, on this computer; a 404 when there is none. */
export async function passToScreen(req: IncomingMessage, res: ServerResponse, call: ScreenCall, screen: string | undefined): Promise<void> {
  const at = screen === undefined ? undefined : screenCallAddress(screen, call)
  if (at === undefined) return end(res, 404, 'no screen')
  await pass(req, res, call, init => fetch(at, { ...init, redirect: 'error' }))
}

interface PassedCall {
  method: string
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
}

/** Make the call with `ask`, and answer what it came to: a stream as inert bytes, an input as its status alone. */
async function pass(req: IncomingMessage, res: ServerResponse, call: ScreenCall, ask: (init: PassedCall) => Promise<Response>): Promise<void> {
  const method = call === 'stream' ? 'GET' : 'POST'
  if (req.method !== method) return end(res, 405, 'method not allowed', { allow: method })
  // Whoever asked going away ends the call: a screen nobody watches is asked for nothing.
  const gone = new AbortController()
  res.once('close', () => gone.abort())

  if (call === 'input') {
    let body: unknown
    try {
      body = await readJsonBody(req, MAX_INPUT)
    } catch {
      return end(res, 400, 'invalid request body')
    }
    const answer = await ask({
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([gone.signal, AbortSignal.timeout(INPUT_TIMEOUT_MS)]),
    }).catch(() => undefined)
    void answer?.body?.cancel().catch(() => {})
    if (!answer) return end(res, 502, 'the screen did not answer')
    if (answer.status === 404) return end(res, 404, 'no screen')
    return end(res, answer.ok ? 204 : answer.status === 400 ? 400 : 502, '')
  }

  const answer = await ask({ method, headers: {}, signal: gone.signal }).catch(() => undefined)
  if (res.destroyed) return void answer?.body?.cancel().catch(() => {})
  if (!answer?.ok || !answer.body) {
    void answer?.body?.cancel().catch(() => {})
    return end(res, answer?.status === 404 ? 404 : 502, answer?.status === 404 ? 'no screen' : 'the screen did not answer')
  }
  res.writeHead(200, INERT)
  // The first picture may be a while away: the headers go now.
  res.flushHeaders()
  const bytes = Readable.fromWeb(answer.body as import('node:stream/web').ReadableStream<Uint8Array>)
  // A screen that went away mid-stream ends the answer, so the watcher asks again instead of waiting for ever.
  bytes.once('error', () => res.destroy())
  bytes.pipe(res)
}
