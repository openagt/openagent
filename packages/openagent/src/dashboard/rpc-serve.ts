import type { IncomingMessage, ServerResponse } from 'node:http'
import { hostnameFromHostHeader, isLoopbackHost } from '../loopback-host.js'
import { setDashboardContext } from '../dashboard-rpc/context.js'
import { RPC_HANDLERS, RPC_EVENT_STREAM } from '../dashboard-rpc/index.js'
import { followRunsChanged } from '../dashboard-rpc/runs-changed.js'
import { ELSEWHERE_FORWARDED } from '../dashboard-rpc/relay-dispatch.js'
import { isElsewhereId, type OwnProject } from './elsewhere.js'
import type { MachinesQueue } from './machine-interventions.js'
import type { ProjectSummary } from './projects.js'
import { errorMessage } from '../error-message.js'
import { PERSON_HEADER, asCaller } from './person.js'
import { sendBody } from './compress.js'
import type { OpenAgentEvent } from '../events.js'
import type { PreferencesStore } from '../registry.js'
import type { QuotaSource } from './quota.js'
import type { ModelsSource } from './models.js'
import type { AgentUpdates } from './agent-updates.js'
import type { BridgeBrowserOwner } from '../bridge-browser.js'
import type { ProjectErrorsReader } from '../project-errors.js'
import type { AddProjectResult, RemoveProjectResult, StartAgentOptions, StartAgentResult, StartedInResult } from './types.js'
import type { AgentMeta } from '../store/index.js'
import type { BringProject, RelayProject, RemoteTarget } from './remote-run.js'
import type { MachineRuns } from './machine-runs.js'

/** Wired by the daemon so `sendStart` can reach the daemon's own `startAgent` closure. */
export type StartAgentHandler = (
  prompt: string,
  options: StartAgentOptions,
  projectId?: string,
) => StartAgentResult | Promise<StartAgentResult>

/** Wired by the daemon so `sendAddProject` can install + register a repo (#433). */
export type AddProjectHandler = (path: string, share: boolean) => AddProjectResult | Promise<AddProjectResult>

/** Wired by the daemon so `sendStartedAgain` can find or add the project a second `openagent` was started in. */
export type StartedInHandler = (folder: string) => StartedInResult | Promise<StartedInResult>

/** Wired by the daemon so `sendRemoveProject` can take a project off the list, by its id, and with `files` remove what OpenAgent left in its folder. */
export type RemoveProjectHandler = (projectId: string, files: boolean) => RemoveProjectResult | Promise<RemoveProjectResult>

/** Resolve an agent to its live event stream: the relay feeds `onEvents` from its own in-memory stream
 * rather than a file on disk (#426), and the daemon feeds an agent it is relaying from a machine (#1067).
 * Returns undefined when there is no in-memory stream, so `onEvents` falls back to tailing the log. */
export type EventsSource = (projectId: string, agentId?: string) => AsyncIterable<OpenAgentEvent> | undefined

/** A saved machine as a run's row needs it: the name it was given, and its address. */
export interface SavedMachine {
  label: string
  url: string
  server?: boolean
}

/** Look up the machine a relayed agent (#1067) executes on, or undefined for an ordinary local agent. The
 *  daemon wires this from its live relayed-agent map; a run-scoped RPC uses it to forward a remote agent's
 *  read/steer/handoff to that machine instead of resolving a (nonexistent) local checkout. */
export interface RemoteAgents {
  /** The machine of a run this daemon follows, in the project when one is named: a run's id alone says nothing of its project. */
  target(agentId: string | undefined, projectId?: string): RemoteTarget | undefined
  /** A project's relayed run stubs (#1077), so `onAgents` can show a remote agent in the list and re-open it after a reload. */
  list(projectId: string): AgentMeta[]
  /** Whether a followed run is one this computer sent to its machine. Any other is followed by its record, and is listed only while that record is there. */
  sent(agentId: string): boolean
  /** Whether a run relayed from here is still at work on the machine at `url`. */
  working(url: string): boolean
  /** How the machine at `url` is reached since it was added again, for the runs kept from before. */
  rekey(url: string, key: string, pin?: string): void
  /**
   * The saved machine a run of the project runs on, whoever started it there: one this computer
   * sent, or one whose record, come through the project's shared records, names that machine's
   * computer. Undefined for a run of this computer's own, and for one of a computer that is
   * no saved machine.
   */
  home(projectId: string, agentId: string): Promise<RemoteTarget | undefined>
  /** Follow a run that runs on a saved machine, when it is not followed yet: its events then stream here, as for a run this computer sent. */
  follow(projectId: string, agentId: string): Promise<void>
  /**
   * The saved machine, by its computer's own name, as the records of its runs carry it: the name
   * it was given and its address. Asked of the machines first, when one has not said its name yet.
   */
  machineNames(): Promise<(host: string) => SavedMachine | undefined>
  /** What each saved machine says of its own runs of the project at `projectPath`, followed for a while from now on (machine-runs.ts). */
  machineRuns(projectPath: string): Promise<MachineRuns[]>
  /** Tell `changed` each time a saved machine's runs of the project at `projectPath` change, until the answer is called. */
  followRuns(projectPath: string, changed: () => void): () => void
  /** The projects of the person's other computers that this one does not have, each marked with the saved machine it is on (elsewhere.ts). */
  elsewhere(): Promise<ProjectSummary[]>
  /** What the computer another computer's project is on says of its own runs of it, followed for a while from now on. */
  elsewhereRuns(projectId: string): Promise<MachineRuns[]>
  /** Tell `changed` each time the runs of another computer's project change there, until the answer is called. */
  followElsewhereRuns(projectId: string, changed: () => void): () => void
  /** Another computer's project by its id here: the saved machine it is on, and the project as that computer said it. */
  elsewhereHome(projectId: string): Promise<{ machine: string; project: OwnProject } | undefined>
  /** Make a page's call about another computer's project on that computer, and answer what it answered. */
  forward(projectId: string, fn: string, args: unknown[]): Promise<unknown>
  /** What the person's other computers say of their Human Queues, each named as its project is here (machine-interventions.ts). */
  machinesQueue(): Promise<MachinesQueue>
  /** Where this computer's copy of the project at `address` stands; with `bring`, cloned and added when there is none, on its own. */
  bringHere(address: string, bring?: BringProject): Promise<RelayProject>
}

/**
 * What every RPC acts through.
 *
 * Every field is required (D3). These used to be optional because three hosts served this same
 * surface — the daemon, a per-session foreground dashboard, and a public relay — each wiring a
 * different subset, so every RPC carried an "absent capability" branch and the client rendered a
 * degradation matrix. There is one host now, and it wires all of it.
 */
export interface DashboardContext {
  startAgent: StartAgentHandler
  addProject: AddProjectHandler
  startedIn: StartedInHandler
  removeProject: RemoveProjectHandler
  /** The in-memory event stream for an agent relayed from a saved machine (#1067), else undefined. */
  eventsSource: EventsSource
  /** The relayed-agent lookup (#1067 slice 2), so a run-scoped RPC can tell a local agent from one
   *  running on a saved machine and forward the call there. */
  remote: RemoteAgents
  /** The user-preferences store (#410), over the registry file. */
  preferences: PreferencesStore
  /** The quota source behind the usage panel (#533). */
  quota: QuotaSource
  /** Which models each coding agent offers, for the agent and model menu. */
  models: ModelsSource
  /** Whether a newer version of a coding agent on this computer is out, and its update. */
  agentUpdates: AgentUpdates
  /** What a project currently suffers from (#1500): the daemon's error state, read per project. */
  projectErrors: ProjectErrorsReader
  /** The daemon's own bridge browser (#1332): status, and show/hide/restart on request. */
  bridgeBrowser: BridgeBrowserOwner
}

/**
 * CSRF guard for the state-changing RPCs. A browser attaches an `Origin`
 * header to every cross-site request, so we reject any POST whose Origin is not this
 * same server (or a loopback host) — otherwise a page on `evil.com` could `fetch()` the
 * localhost dashboard and start or steer a run. An absent Origin means a non-browser caller
 * (curl, the test suite) with no ambient session to abuse, so it passes. Lives here beside
 * the mount, its only caller.
 */
export function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true
  let hostname: string
  try {
    hostname = new URL(origin).hostname
  } catch {
    return false // malformed Origin: treat as cross-origin
  }
  return isLoopbackHost(hostname)
}

/**
 * The third guard: a call says its body is JSON. {@link isSameOriginRequest} lets every loopback
 * origin pass, whatever its port, so a page another program serves on this computer (an app an
 * agent previews, a dev server) is let through it. A browser sends such a page's POST without
 * asking only while its content type is one a plain form can have, and JSON is none of them:
 * with JSON it asks first, this server never says yes, and the call is not sent. So a call that
 * is not JSON is refused, and no page of another origin can make one, not even blind.
 */
export function isJsonRequest(req: IncomingMessage): boolean {
  return /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')
}

/**
 * DNS-rebinding guard, the other half of the CSRF check above. A page on `evil.com` whose DNS
 * re-answers as `127.0.0.1` is *same-origin* with this server as far as the browser is concerned,
 * so its `fetch()` takes the passing branch of {@link isSameOriginRequest} — and every RPC behind
 * the mount, `sendStart` included, is reachable from a page the user merely visited.
 *
 * The `Host` header is what still gives the attacker away: it carries the name the browser was
 * asked for (`evil.com`), not the address it resolved to. The dashboard listens on this
 * computer's own address only, so the only `Host` a real user's browser can send is a loopback
 * one — anything else is a rebound name and is rejected. An absent `Host` is rejected too:
 * HTTP/1.1 requires it, and every browser sends it.
 */
export function isExpectedHost(req: IncomingMessage): boolean {
  const header = req.headers.host
  return header !== undefined && header !== '' && isLoopbackHost(hostnameFromHostHeader(header))
}

/** Where the dashboard's RPCs live. One prefix, so the static handler can decline it by path. */
export const RPC_PREFIX = '/_rpc'

/** Read a request body, bounded so a bad caller cannot make the daemon buffer without limit. */
async function readBody(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): Promise<void> {
  return sendBody(req, res, status, { 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify(body))
}

/**
 * Stream an agent's events as Server-Sent Events (#405). One JSON value per `data:` line; the
 * response ending IS the clean close the client distinguishes from a dropped connection.
 *
 * This was a Telefunc Channel. The Channel gave serialization, reconnect and typing over a
 * WebSocket-shaped abstraction; what the dashboard actually uses is "push me lines until I go
 * away", and it brought its own reconnect-with-backoff on top (#948/#1383) because the Channel's
 * did not distinguish a dead daemon from a finished stream.
 */
async function serveEventStream(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get('projectId') ?? ''
  const agentId = url.searchParams.get('agentId') ?? undefined
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // What passes a device's request on to the daemon must not hold the lines back.
    'x-accel-buffering': 'no',
  })
  let finished = false
  const stop = await RPC_EVENT_STREAM(
    projectId,
    agentId,
    value => {
      res.write(`data: ${JSON.stringify(value)}\n\n`)
    },
    () => {
      finished = true
      res.end()
    },
  )
  if (!stop) {
    // Nothing to stream (unknown project): end cleanly, which the client reads as "done", not
    // "lost" — the same distinction the Channel's clean-vs-errored close carried.
    res.end()
    return
  }
  if (finished) return // the source was exhausted before it was even wired
  const finish = (): void => {
    stop()
    res.end()
  }
  req.on('close', finish)
  req.on('error', finish)
}

/**
 * Tell the page each time the runs of a project change, here or on a saved machine
 * (runs-changed.ts), as Server-Sent Events, until it goes away: it reads them again at once. A
 * comment line now and then keeps whatever passes the page's request on from taking it for idle.
 */
function serveChangesStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  // Said at once: the page knows it is told from here on.
  res.write(': listening\n\n')
  const stop = followRunsChanged(change => void res.write(`data: ${JSON.stringify(change)}\n\n`))
  const alive = setInterval(() => void res.write(': still\n\n'), CHANGES_ALIVE_MS)
  const finish = (): void => {
    clearInterval(alive)
    stop()
  }
  req.on('close', finish)
  res.on('close', finish)
}

/** How often the changes stream says it is still there when nothing changed. */
const CHANGES_ALIVE_MS = 25_000

/**
 * Mount the dashboard's RPC surface (#405) on the daemon's `node:http` server: `POST /_rpc/<name>`
 * for the calls, `GET /_rpc/events` for the live stream, `GET /_rpc/changes` for when to read the
 * runs again. It runs in the daemon process, so `sendStart` reaches the daemon's own `startAgent`
 * through the wired {@link DashboardContext}.
 *
 * Cross-origin POSTs are rejected (CSRF: a page on evil.com must not steer or start a session), as
 * are requests carrying someone else's `Host` (DNS rebinding: the same page must not reach us by
 * pointing its own name at `127.0.0.1`). Returns whether the request was the RPC surface's.
 *
 * This replaced Telefunc (F3), which required a build-time transform over every `.telefunc.ts`
 * file, a registration table pinning each RPC to the client-baked key of the *dashboard* source
 * path it was re-exported from, and a request-context indirection for wiring that never varied
 * per request. What it bought over this was type-safety across a package boundary that A7 removed.
 */
export function makeRpcMount(context: DashboardContext): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  setDashboardContext(context)
  return async (req, res) => {
    // A fixed base, like every other request parse here: only the path and the query are read,
    // and a request carrying an empty or malformed `Host` made this throw — outside the handler's
    // own try, so the daemon died of the unhandled rejection rather than answering the request.
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== RPC_PREFIX && !url.pathname.startsWith(`${RPC_PREFIX}/`)) return false
    if (!isSameOriginRequest(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('cross-origin request forbidden')
      return true
    }
    if (!isExpectedHost(req)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('unexpected Host header')
      return true
    }

    const name = url.pathname.slice(RPC_PREFIX.length + 1)
    try {
      if (req.method === 'GET' && name === 'events') {
        // As the person whose device asks: a run of the owner's other computer is not followed for a person the owner invited.
        await asCaller(req.headers[PERSON_HEADER], () => serveEventStream(req, res, url))
        return true
      }
      if (req.method === 'GET' && name === 'changes') {
        // As the person whose device asks, for as long as it listens: the owner's other computers' projects are no one else's to hear of.
        await asCaller(req.headers[PERSON_HEADER], async () => serveChangesStream(req, res))
        return true
      }
      const handler = RPC_HANDLERS[name]
      if (req.method !== 'POST' || !handler) {
        await sendJson(req, res, 404, { error: `no such RPC: ${name}` })
        return true
      }
      if (!isJsonRequest(req)) {
        await sendJson(req, res, 415, { error: 'a call is sent as application/json' })
        return true
      }
      const raw = await readBody(req)
      const args: unknown[] = raw ? (JSON.parse(raw) as unknown[]) : []
      if (!Array.isArray(args)) {
        await sendJson(req, res, 400, { error: 'the request body must be a JSON array of arguments' })
        return true
      }
      // A call about another computer's project is that computer's to answer (elsewhere.ts).
      const call = isElsewhereId(args[0]) && ELSEWHERE_FORWARDED.has(name) ? () => context.remote.forward(args[0] as string, name, args) : () => Promise.resolve(handler(...(args as never[])))
      await sendJson(req, res, 200, { ret: await asCaller(req.headers[PERSON_HEADER], call) })
    } catch (err) {
      // An RPC that throws is a failed call, not a dead daemon: answer it and stay up. Without
      // this a rejected promise inside the mount became an unhandled rejection.
      if (!res.headersSent) await sendJson(req, res, 500, { error: errorMessage(err) })
      else res.end()
    }
    return true
  }
}
