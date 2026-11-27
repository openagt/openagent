import type { AppContext, AppLifecycle, AppRoute } from '@openagt/hooks'
import { bridgeBrowserDir, bridgeBrowserOwner, startBridgeBrowser, type BridgeBrowserLauncher, type BridgeBrowserOwner } from './bridge-browser.js'
import { BRIDGE_PREFIX, EXPECTED_EXTENSION_VERSION, handleBridgeRequest, type BridgeHandlers, type BridgeSession } from './bridge-endpoints.js'
import { bridgeSessionsFrom } from './bridge-sessions.js'
import { bridgeStarts } from './bridge-starts.js'
import { bridgeQuestions } from './bridge-store.js'
import { passProject, type PassDeps } from './passes.js'
import { BROWSER } from './settings.js'
import { claudeWebDir, ensureToken } from './token.js'
import { SESSION_WINDOW_MS, projectWebRuns } from './web-runs.js'

/**
 * The bridge while the plugin is on (#1237, #1332): its key, the browser OpenAgent runs for the
 * extension when the person picked it, and the pass over the web runs. Started with the plugin
 * (`app.lifecycle`), the extension's address (`app.route`) answering only while it is.
 */

/** How often the web runs are passed over (`passes.ts`): a session lives minutes to hours. */
export const PASS_EVERY_MS = 10 * 60_000

/** What the bridge works with; the real one when absent. */
export interface BridgeDeps {
  env?: NodeJS.ProcessEnv
  /** The browser's launch, for a test. */
  launch?: (opts: { daemonUrl: string; token: string; dir: string; report: (detail: string) => void; signal: AbortSignal }) => ReturnType<BridgeBrowserLauncher>
  pass?: PassDeps
  passEveryMs?: number
  log?: (line: string) => void
}

/** The bridge as it runs. */
interface Running {
  app: AppContext
  token: string
  browser: BridgeBrowserOwner
  timer: NodeJS.Timeout
}

let running: Running | undefined

/** The browser OpenAgent runs for the extension, while the plugin is on. */
export function bridgeBrowser(): BridgeBrowserOwner | undefined {
  return running?.browser
}

/** The plugin's life: the bridge starts with it and stops with it. */
export function bridgeLifecycle(deps: BridgeDeps = {}): AppLifecycle {
  const env = deps.env ?? process.env
  const log = deps.log ?? (line => console.log(line))
  return {
    async started(app) {
      const token = await ensureToken(claudeWebDir(env))
      const launch = deps.launch ?? (opts => startBridgeBrowser(opts))
      const browser = bridgeBrowserOwner(async (report, signal) => {
        if (!app.url) throw new Error('OpenAgent has no address yet for the extension to call')
        return launch({ daemonUrl: app.url, token, dir: bridgeBrowserDir(env), report, signal })
      }, log)
      const pass = (): void => {
        void app.projects().then(
          projects => Promise.all(projects.map(project => passProject(project, { log, ...deps.pass }))),
          () => {},
        )
      }
      const timer = setInterval(pass, deps.passEveryMs ?? PASS_EVERY_MS)
      timer.unref()
      running = { app, token, browser, timer }
      pass()
      if ((await app.settings.get(BROWSER)) === 'app') void browser.start()
    },
    async stopping() {
      const was = running
      running = undefined
      if (!was) return
      clearInterval(was.timer)
      await was.browser.stop()
    },
  }
}

/** The extension's address (`/_bridge`): every call shows the bridge's key, and none is answered while the plugin is off. */
export const bridgeRoute: AppRoute = {
  path: BRIDGE_PREFIX,
  callers: 'own',
  handle: (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://bridge.invalid').pathname
    return handleBridgeRequest(req, res, pathname, running ? handlersOf(running) : undefined)
  },
}

/** What the bridge's routes do, while it runs. */
function handlersOf({ app, token }: Running): BridgeHandlers {
  const store = bridgeQuestions()
  return {
    token,
    // The version gate (#1519): a stale extension is refused loudly rather than half-working.
    expectedExtensionVersion: EXPECTED_EXTENSION_VERSION,
    extensionVersion: (got, blocked) => store.recordVersion(got, EXPECTED_EXTENSION_VERSION, blocked),
    record: question => store.record(question),
    contact: (route, status) => store.recordContact(route, status),
    recordEvent: event => store.recordEvent(event),
    hello: hello => store.recordHello(hello),
    statuses: statuses => {
      for (const status of statuses) store.recordStatus(status)
    },
    // Claimed on read (#1332), like a start: two Drivers asking must not both type it.
    answer: sessionId => {
      const pending = store.claimAnswer(sessionId)
      return pending ? { id: pending.id, text: pending.text } : undefined
    },
    answered: (sessionId, id, ok, note) => store.resolveAnswer(sessionId, id, ok, note),
    // The start queue (#1328). The claim happens inside claimNext, not in the route: two polling
    // tabs handed the same request would make two cloud sessions.
    start: () => {
      const next = bridgeStarts().claimNext()
      return next ? { id: next.id, repo: next.repo, branch: next.branch, prompt: next.prompt, ...(next.model ? { model: next.model } : {}) } : undefined
    },
    started: (id, ok, sessionId, note) => bridgeStarts().resolve(id, ok, sessionId, note),
    sessions: () => sessionsOf(app),
  }
}

/** The cloud sessions the extension's Driver tab serves: every project's web runs of the session window, and every session an answer waits for. */
async function sessionsOf(app: AppContext): Promise<BridgeSession[]> {
  const now = new Date()
  const projects = await app.projects()
  const runs = (await Promise.all(projects.map(project => projectWebRuns(project, { since: now.getTime() - SESSION_WINDOW_MS })))).flat()
  return bridgeSessionsFrom(runs, now, bridgeQuestions().pendingAnswerSessions())
}
