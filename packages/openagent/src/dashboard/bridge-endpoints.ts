import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BridgeOption, BridgeQuestion } from './bridge-question.js'
import { end, readPost, requireGet, sendJson } from './http.js'

export type { BridgeOption, BridgeQuestion } from './bridge-question.js'

/**
 * The browser bridge (#1237): the one endpoint an extension running in the user's own Claude
 * session posts to, so a question a cloud agent is parked on becomes visible in the dashboard.
 *
 * **Why this route carries its own token, unlike every other one.** What protects the daemon,
 * which listens on its own computer only, is the same-origin check on `/_rpc`: a page on another
 * origin is refused outright. This route is the first that is *meant* to be reached from another
 * origin, so that check does not protect it, and it demands `Authorization: Bearer <bridgeToken>`
 * unconditionally instead.
 *
 * **No CORS headers, on purpose.** An extension's service worker holding `host_permissions`
 * fetches without a preflight, so the bridge does not need `Access-Control-Allow-Origin` and
 * must not have it: a wildcard here would let any page the user visits post to their daemon.
 * The cost is that the extension has to post from its background worker rather than from the
 * content script, which is a line in the extension and a much better trade.
 *
 * **What it accepts is deliberately tiny.** One shape, fully validated, with no path, command,
 * prompt or free text anywhere in it. The worst a stolen token buys is a bogus question card in
 * someone's dashboard, which is the point: this is attached to a daemon that spawns processes.
 */
export const BRIDGE_PREFIX = '/_bridge'

/**
 * The extension version this daemon speaks (#1519). The extension states its own version on
 * every call, in this header, and a daemon expecting another refuses outright: a version-skewed
 * extension does not fail loudly, it half-works — missed messages, silently ignored fields —
 * which reads as an OpenAgent bug and burns a debugging session. The extension's manifest must
 * carry the same number; a test keeps the two in lockstep.
 */
export const EXPECTED_EXTENSION_VERSION = '0.13.0'

/** The header the extension states its version in. Lowercase, as node presents all headers. */
export const EXTENSION_VERSION_HEADER = 'x-oa-extension-version'

/**
 * One thing a cloud session did, as scraped from its page (#1237).
 *
 * `seq` is the message's position in the transcript, assigned by the extension, and it is what
 * makes this idempotent: the page is re-read on every DOM change, so the same message arrives
 * many times and the daemon keeps one copy per position rather than a growing pile of repeats.
 */
export interface BridgeEvent {
  sessionId: string
  seq: number
  role: 'agent' | 'user'
  text: string
  receivedAt: string
}

/** What the page half of the bridge reports about itself, for diagnosis. */
export interface BridgeHello {
  version: string
  sessionId?: string | undefined
  note: string
  at: string
}

/** A cloud session the extension's Driver tab should be serving (#1237, #1332). */
export interface BridgeSession {
  id: string
  url: string
  /**
   * Whether the dashboard holds an answer for it waiting to be typed. Such a session is visited
   * whatever the session list says about it.
   */
  answerQueued: boolean
}

/**
 * What claude.ai's own session list says a session is doing, as the Driver tab reads it (#1332).
 *
 * The list's status icon carries a text label, and these are its words: `awaiting` ("Awaiting
 * input": the session stopped to ask its user), `unread` ("Unread response": it finished a turn
 * nobody has read), `idle`, `running`, `landed` (the label is the session's pull request and
 * its state), `missing` (the list does not show the session at all) and `unknown` — a label
 * the extension does not know, carried verbatim so it can be named rather than guessed at.
 */
export type BridgeListStatus = 'awaiting' | 'unread' | 'idle' | 'running' | 'landed' | 'missing' | 'unknown'

/** One session's list status, stamped when the daemon took it. */
export interface BridgeSessionStatus {
  sessionId: string
  status: BridgeListStatus
  /** The list's own label, kept only for `unknown`. */
  label?: string | undefined
  at: string
}

/**
 * A session the daemon wants the extension to create on claude.ai (#1328).
 *
 * The one shape that travels *out* of the bridge carrying free text, and that direction is what
 * keeps the "deliberately tiny input" rule intact: the daemon writes it, the extension reads it,
 * and what comes back is only an id, a boolean and a session id.
 */
export interface BridgeStart {
  id: string
  /** `owner/name`, as the repo picker lists it. */
  repo: string
  branch: string
  prompt: string
  /** The model to pick in claude.ai's model menu before sending (#1697); absent leaves the page's own. */
  model?: string
}

/** What the daemon wires behind the bridge. Absent when the feature is off, which 404s it. */
export interface BridgeHandlers {
  /** The shared secret every bridge call must present. */
  token: string
  /**
   * The extension version to insist on (#1519). When set, every route past the token demands a
   * matching {@link EXTENSION_VERSION_HEADER} and answers 426 otherwise — no degraded mode,
   * ping included, so the only path forward from a stale extension is updating it.
   */
  expectedExtensionVersion?: string
  /** What version the caller claimed and whether it was turned away, for the dashboard. */
  extensionVersion?: (got: string, blocked: boolean) => void
  record: (question: BridgeQuestion) => void
  /** Record what the session said, keyed by its position in the transcript. */
  recordEvent?: (event: BridgeEvent) => void
  /** Note that something reached the bridge, including when it was refused. */
  contact?: (route: string, status: number) => void
  /** What the injected page script reports about itself. */
  hello?: (hello: BridgeHello) => void
  /**
   * The cloud sessions worth watching, newest first. The extension cannot know an agent started:
   * it only sees pages the user is already on, so without this the bridge works only when
   * somebody happens to be looking at claude.ai. This is how a tab gets opened for them.
   */
  sessions?: () => Promise<BridgeSession[]>
  /**
   * What the Driver tab read off claude.ai's session list for the watched sessions (#1332): the
   * read-back a web run's own record cannot give, since the run ends at its hand-off.
   */
  statuses?: (statuses: BridgeSessionStatus[]) => void
  /**
   * The answer queued in the dashboard for that session, waiting to be delivered (#1237): `text`
   * is exactly what the extension types into the composer, composed by the daemon from labels the
   * session itself offered (#1554).
   */
  answer?: (sessionId: string) => { id: string; text: string } | undefined
  /** The extension's word on what a delivery attempt did. */
  answered?: (sessionId: string, id: string, ok: boolean, note?: string) => void
  /**
   * The next session the daemon wants created, claimed for whoever is asking (#1328). Claiming is
   * the callee's job: two tabs polling must not both be handed the same request, because a
   * duplicate here is a duplicate cloud session on the user's account.
   */
  start?: () => BridgeStart | undefined
  /** The extension's word on what a creation attempt did (#1328). */
  started?: (id: string, ok: boolean, sessionId?: string, note?: string) => void
  now?: () => Date
}

const MAX_BODY = 64 * 1024
const SESSION_ID = /^session_[A-Za-z0-9]{1,128}$/
const MAX_TITLE = 500
const MAX_LABEL = 300
const MAX_DETAIL = 500
const MAX_OPTIONS = 20
const MAX_EVENTS_BODY = 512 * 1024
const MAX_EVENT_BATCH = 50
const MAX_EVENT_TEXT = 8000
const MAX_SEQ = 10_000
const LIST_STATUSES: ReadonlySet<string> = new Set<BridgeListStatus>(['awaiting', 'unread', 'idle', 'running', 'landed', 'missing', 'unknown'])
const MAX_STATUSES = 500
const MAX_STATUS_LABEL = 80

/** Route a `/_bridge/*` request. A daemon with the bridge off 404s every route. */
export async function handleBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  handlers: BridgeHandlers | undefined,
): Promise<void> {
  if (!handlers) return end(res, 404, 'bridge not enabled')
  seen(handlers, pathname, res)
  if (!bearerAuthorized(req, handlers.token)) return end(res, 401, 'unauthorized')
  // The version gate (#1519), behind the token so an unauthenticated caller learns nothing.
  if (handlers.expectedExtensionVersion !== undefined) {
    const raw = req.headers[EXTENSION_VERSION_HEADER]
    const got = (typeof raw === 'string' && raw ? raw : 'unknown').slice(0, 32)
    const blocked = got !== handlers.expectedExtensionVersion
    handlers.extensionVersion?.(got, blocked)
    if (blocked) {
      return end(
        res,
        426,
        `extension v${got} does not match the v${handlers.expectedExtensionVersion} this daemon expects: update the extension (pull the repo, then reload it at chrome://extensions) and retry`,
      )
    }
  }
  if (pathname === `${BRIDGE_PREFIX}/ping`) {
    if (!requireGet(req, res)) return
    return end(res, 200, 'ok')
  }
  if (pathname === `${BRIDGE_PREFIX}/question`) return handleQuestion(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/sessions`) return handleAgents(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/events`) return handleEvents(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/hello`) return handleHello(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/statuses`) return handleStatuses(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/answer`) return handleAnswer(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/answered`) return handleAnswered(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/start`) return handleStart(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/started`) return handleStarted(req, res, handlers)
  end(res, 404, 'not found')
}

/**
 * `Authorization: Bearer <token>`, compared in constant time. Rejects before the body is read,
 * so an unauthenticated caller cannot make the daemon buffer anything.
 */
export function bearerAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(token)
  // timingSafeEqual throws on a length mismatch, which would itself leak the length.
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

/** When the daemon says it is; injectable so a test can pin the timestamps it records. */
function now(handlers: BridgeHandlers): Date {
  return (handlers.now ?? (() => new Date()))()
}

/** `POST /_bridge/question`: validate hard, record, answer 204. */
async function handleQuestion(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  const body = await readPost(req, res, MAX_BODY)
  if (body === undefined) return
  const question = validate(body, now(handlers))
  if (typeof question === 'string') return end(res, 400, question)
  handlers.record(question)
  end(res, 204, '')
}

/**
 * The session a posted body names, or the reason it names none. Both bodies the extension posts
 * are addressed to one cloud session and are refused the same way when they are not — one rule,
 * one message, so a caller cannot learn a different thing from each route.
 */
function bodySessionId(body: unknown): { sessionId: string; raw: Record<string, unknown> } | string {
  if (typeof body !== 'object' || body === null) return 'body must be an object'
  const raw = body as Record<string, unknown>
  const sessionId = raw.sessionId
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return 'sessionId must look like session_<id>'
  return { sessionId, raw }
}

/**
 * Every field checked, with a reason on rejection. Unknown keys are dropped rather than
 * refused, so a newer extension posting an extra field still works against an older daemon.
 */
function validate(body: unknown, now: Date): BridgeQuestion | string {
  const named = bodySessionId(body)
  if (typeof named === 'string') return named
  const { sessionId, raw } = named
  const title = raw.title
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE) return `title must be a string of 1 to ${MAX_TITLE} characters`
  if (!Array.isArray(raw.options) || raw.options.length === 0) return 'options must be a non-empty array'
  if (raw.options.length > MAX_OPTIONS) return `options must hold at most ${MAX_OPTIONS} entries`
  const options: BridgeOption[] = []
  for (const entry of raw.options) {
    if (typeof entry !== 'object' || entry === null) return 'each option must be an object'
    const { label, detail, default: preset, stop } = entry as Record<string, unknown>
    if (typeof label !== 'string' || !label.trim() || label.length > MAX_LABEL) return `each option needs a label of 1 to ${MAX_LABEL} characters`
    if (detail !== undefined && (typeof detail !== 'string' || detail.length > MAX_DETAIL)) return `an option detail must be a string of at most ${MAX_DETAIL} characters`
    if (preset !== undefined && typeof preset !== 'boolean') return 'an option default must be a boolean'
    if (stop !== undefined && typeof stop !== 'boolean') return 'an option stop must be a boolean'
    options.push({
      label,
      ...(typeof detail === 'string' && detail ? { detail } : {}),
      ...(preset === true ? { default: true } : {}),
      ...(stop === true ? { stop: true } : {}),
    })
  }
  if (new Set(options.map(o => o.label)).size !== options.length) return 'option labels must be distinct'
  const multi = raw.multi
  if (multi !== undefined && typeof multi !== 'boolean') return 'multi must be a boolean'
  const recommended = raw.recommended
  if (recommended !== undefined && (typeof recommended !== 'string' || recommended.length > MAX_LABEL)) {
    return 'recommended must be a string naming one of the option labels'
  }
  // A recommendation that names no option would render a default the user cannot see.
  if (typeof recommended === 'string' && recommended && !options.some(o => o.label === recommended)) {
    return 'recommended must match one of the option labels'
  }
  return {
    sessionId,
    title,
    options,
    ...(typeof recommended === 'string' && recommended ? { recommended } : {}),
    ...(multi === true ? { multi: true } : {}),
    receivedAt: now.toISOString(),
  }
}

/**
 * `POST /_bridge/hello`: what the page half of the bridge is doing.
 *
 * Diagnosis kept needing a screenshot of a panel, which meant every wrong guess cost a round
 * trip through a person. This lets the extension say for itself which version is injected and
 * what its last scrape found, so the daemon can be asked instead.
 */
async function handleHello(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  const body = await readPost(req, res, MAX_BODY)
  if (body === undefined) return
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  handlers.hello?.({
    version: typeof raw.version === 'string' ? raw.version.slice(0, 32) : 'unknown',
    sessionId: typeof raw.sessionId === 'string' && SESSION_ID.test(raw.sessionId) ? raw.sessionId : undefined,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 300) : '',
    at: now(handlers).toISOString(),
  })
  end(res, 204, '')
}

/** `POST /_bridge/events`: record a batch of transcript entries. */
async function handleEvents(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  // The method is checked here rather than left to `readPost`, so that a wrong method is refused
  // ahead of the un-wired 404: a GET on a daemon with events off is still a wrong method.
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  if (!handlers.recordEvent) return end(res, 404, 'events not enabled')
  const body = await readPost(req, res, MAX_EVENTS_BODY)
  if (body === undefined) return
  const events = validateEvents(body, now(handlers))
  if (typeof events === 'string') return end(res, 400, events)
  for (const event of events) handlers.recordEvent(event)
  end(res, 204, '')
}

/**
 * A batch, validated entry by entry. Rejects the whole batch on a bad entry rather than taking
 * the good ones: a partial accept would leave gaps in the sequence the reader cannot distinguish
 * from a message that has not arrived yet.
 */
function validateEvents(body: unknown, now: Date): BridgeEvent[] | string {
  const named = bodySessionId(body)
  if (typeof named === 'string') return named
  const { sessionId, raw } = named
  if (!Array.isArray(raw.events) || raw.events.length === 0) return 'events must be a non-empty array'
  if (raw.events.length > MAX_EVENT_BATCH) return `events must hold at most ${MAX_EVENT_BATCH} entries`
  const out: BridgeEvent[] = []
  for (const entry of raw.events) {
    if (typeof entry !== 'object' || entry === null) return 'each event must be an object'
    const { seq, role, text } = entry as Record<string, unknown>
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) return 'each event needs an integer seq'
    if (role !== 'agent' && role !== 'user') return 'each event needs a role of agent or user'
    if (typeof text !== 'string' || !text.trim()) return 'each event needs text'
    out.push({ sessionId, seq, role, text: text.slice(0, MAX_EVENT_TEXT), receivedAt: now.toISOString() })
  }
  return out
}

/** `POST /_bridge/statuses`: what claude.ai's session list says about each watched session (#1332). */
async function handleStatuses(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  const body = await readPost(req, res, MAX_BODY)
  if (body === undefined) return
  const statuses = validateStatuses(body, now(handlers))
  if (typeof statuses === 'string') return end(res, 400, statuses)
  handlers.statuses?.(statuses)
  end(res, 204, '')
}

/** A batch of list statuses, validated entry by entry; one bad entry refuses the batch. */
function validateStatuses(body: unknown, now: Date): BridgeSessionStatus[] | string {
  if (typeof body !== 'object' || body === null) return 'body must be an object'
  const raw = (body as Record<string, unknown>).statuses
  if (!Array.isArray(raw) || raw.length === 0) return 'statuses must be a non-empty array'
  if (raw.length > MAX_STATUSES) return `statuses must hold at most ${MAX_STATUSES} entries`
  const out: BridgeSessionStatus[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return 'each status must be an object'
    const { sessionId, status, label } = entry as Record<string, unknown>
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return 'each status needs a sessionId that looks like session_<id>'
    if (typeof status !== 'string' || !LIST_STATUSES.has(status)) return `each status must be one of ${[...LIST_STATUSES].join(', ')}`
    if (label !== undefined && typeof label !== 'string') return 'label must be a string'
    out.push({
      sessionId,
      status: status as BridgeListStatus,
      ...(typeof label === 'string' && label ? { label: label.slice(0, MAX_STATUS_LABEL) } : {}),
      at: now.toISOString(),
    })
  }
  return out
}

/**
 * `GET /_bridge/answer?sessionId=...`: the answer the dashboard queued for that session (#1237).
 *
 * Always 200 with `{answer: ...}`, null when there is nothing to deliver, so the extension can
 * poll it blindly. Degrades to null on a daemon that wired no answer source, same as `sessions`.
 */
async function handleAnswer(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (!requireGet(req, res)) return
  const sessionId = new URL(req.url ?? '', 'http://bridge.invalid').searchParams.get('sessionId')
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return end(res, 400, 'sessionId must look like session_<id>')
  sendJson(res, { answer: handlers.answer?.(sessionId) ?? null })
}

/** `POST /_bridge/answered`: what the extension's delivery attempt did. */
async function handleAnswered(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  const body = await readPost(req, res, MAX_BODY)
  if (body === undefined) return
  if (typeof body !== 'object' || body === null) return end(res, 400, 'body must be an object')
  const { sessionId, id, ok, note } = body as Record<string, unknown>
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return end(res, 400, 'sessionId must look like session_<id>')
  if (typeof id !== 'string' || !id || id.length > 64) return end(res, 400, 'id must be the answer id')
  if (typeof ok !== 'boolean') return end(res, 400, 'ok must be a boolean')
  if (note !== undefined && typeof note !== 'string') return end(res, 400, 'note must be a string')
  handlers.answered?.(sessionId, id, ok, typeof note === 'string' ? note.slice(0, 300) : undefined)
  end(res, 204, '')
}

/**
 * `GET /_bridge/start`: the next session the daemon wants created, claimed by this call (#1328).
 *
 * Always 200 with `{start: ...}`, null when there is nothing to do, so the extension polls it
 * blindly alongside `/answer`; null too on a daemon that wired no queue. A GET that mutates, and
 * the mutation is the point: handing the same request to two polling tabs would create two cloud
 * sessions, so taking it off the queue has to happen in the same step as reading it.
 */
async function handleStart(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (!requireGet(req, res)) return
  sendJson(res, { start: handlers.start?.() ?? null })
}

/** `POST /_bridge/started`: what the extension's creation attempt did (#1328). */
async function handleStarted(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  const body = await readPost(req, res, MAX_BODY)
  if (body === undefined) return
  if (typeof body !== 'object' || body === null) return end(res, 400, 'body must be an object')
  const { id, ok, sessionId, note } = body as Record<string, unknown>
  if (typeof id !== 'string' || !id || id.length > 64) return end(res, 400, 'id must be the start request id')
  if (typeof ok !== 'boolean') return end(res, 400, 'ok must be a boolean')
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId))) {
    return end(res, 400, 'sessionId must look like session_<id>')
  }
  if (note !== undefined && typeof note !== 'string') return end(res, 400, 'note must be a string')
  // A failure's note is the only diagnosis the run gets, so it may carry the page's controls.
  handlers.started?.(id, ok, typeof sessionId === 'string' ? sessionId : undefined, typeof note === 'string' ? note.slice(0, 1500) : undefined)
  end(res, 204, '')
}

/**
 * `GET /_bridge/sessions`: the cloud sessions the extension's Driver tab should be serving.
 *
 * Answers an empty list rather than a 404 when the daemon wired no lister, so an extension
 * polling an older daemon degrades to doing nothing instead of reporting a fault.
 */
async function handleAgents(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (!requireGet(req, res)) return
  sendJson(res, { sessions: handlers.sessions ? await handlers.sessions().catch(() => []) : [] })
}

/** Wrap a route so its outcome is recorded whatever it was. */
function seen(handlers: BridgeHandlers, pathname: string, res: ServerResponse): void {
  if (!handlers.contact) return
  res.once('finish', () => handlers.contact?.(pathname, res.statusCode))
}
