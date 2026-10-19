import { startDashboard, type Dashboard } from './dashboard/index.js'
import { createProjectRuntime } from './daemon-runtime.js'
import { defaultQuotaSource } from './dashboard/quota.js'
import { defaultModelsSource } from './dashboard/models.js'
import { startBackgroundServices } from './daemon-services.js'
import { projectErrorStore } from './project-errors.js'
import { resolveDashboardBundle } from './dashboard/bundle.js'
import { ensureBridgeToken, ensureComputerId, listProjects, nodeRegistryFs, readPreferences, registryPreferencesStore, type Preferences } from './registry.js'
import { sayComputer } from './dashboard/machine-call.js'
import { bridgeSessionsFrom } from './dashboard/bridge-sessions.js'
import { bridgeQuestions } from './dashboard/bridge-store.js'
import { bridgeBrowserDir, bridgeBrowserOwner, startBridgeBrowser, type BridgeBrowser, type BridgeBrowserOptions } from './bridge-browser.js'
import { runProjectHooks } from './project-hooks.js'
import { builtInServices } from './built-in.js'
import { COMPUTER_ENV, sayOwnUrl, startPackageServices, type PackageServices, type PackageServicesOptions } from './package-services.js'
import { readAllAgents } from './store/index.js'
import { setOpenagentVersion } from './version.js'
import type { BridgeSession, StartedProject } from './dashboard/index.js'
import { personLogins } from './dashboard/copy-logins.js'
import { runComputerCommand } from './dashboard-rpc/modules.js'

/**
 * The dashboard process (#302). It is a pure projection of files: a run's tool keeps the run's
 * card and diary in the run's checkout, and the dashboard *tails* them, pushing each new line to
 * connected browsers. No run<->dashboard IPC: the files are the seam. The daemon runs no agent
 * (#1774): a Start is the project's own `start` hook line, and what a person says to a run goes
 * into the run's inbox file, or through the `resume` hook line once the run has ended.
 *
 * It runs in the foreground and only in the foreground: Ctrl-C closes the dashboard. A run is
 * not the daemon's process, so it goes on to its end. There is no detached mode, so there is no
 * liveness record, no machine-global state file, and no second process to find, reuse or stop.
 *
 * Its own `cwd` is just the home project it streams by default.
 */

/** The default dashboard port the daemon binds. */
export const DEFAULT_DAEMON_PORT = 4200

/** Where the dashboard came up, reported to {@link RunDaemonOptions.onListening}. */
export interface DaemonState {
  /** The daemon process id. */
  pid: number
  /** The port the dashboard is bound to. */
  port: number
  /** The URL to open. */
  url: string
  /** ISO timestamp the daemon started. */
  startedAt: string
}

/** True when a process with this id is still running (best-effort, signal 0). The store's
 * {@link isPidAlive} under the daemon's historical public name -- the two were byte-identical. */
export { isPidAlive as isProcessAlive } from './store/index.js'

/** Options for {@link runDaemon}. */
export interface RunDaemonOptions {
  /** Port to bind. Default {@link DEFAULT_DAEMON_PORT}; pass `0` for an ephemeral port. */
  port?: number
  /** Shut the daemon down when this aborts (in addition to SIGINT/SIGTERM). For tests. */
  signal?: AbortSignal
  /** Env the registry is read from. Default `process.env`; injectable for tests. */
  env?: NodeJS.ProcessEnv
  /** OpenAgent's version, as the package that started it says: what this computer tells its machines and a phone. `unknown` when unsaid. */
  version?: string
  /** Called once the server has bound, before it blocks. The only way a caller learns the port. */
  onListening?: (state: DaemonState) => void
  /**
   * A folder to add to the projects once the dashboard listens, as Add project does with the
   * records kept on this computer. One already on the list, or inside one that is, is left as it is.
   * The dashboard adds no folder by itself: this is the caller's.
   */
  project?: string
  /** Called once {@link project} is on the list: its id, which always opens its page, the address the page shows, and whether it was added now. */
  onProject?: (project: StartedProject) => void
  /** How the bridge browser is launched (#1332); default the real Chrome for Testing. For tests. */
  bridgeBrowser?: (opts: BridgeBrowserOptions) => Promise<BridgeBrowser>
  /** How the services of OpenAgent's own packages are started; default each as its own process. For tests. */
  packageServices?: (opts: PackageServicesOptions) => PackageServices
  /** How long the teardown after Ctrl+C may take; default {@link SHUTDOWN_DEADLINE_MS}. For tests. */
  shutdownDeadlineMs?: number
}

/** How long the teardown after Ctrl+C may take before the daemon ends without what is still running. */
const SHUTDOWN_DEADLINE_MS = 10_000

/**
 * The daemon body, run in the foreground by bare `openagent`. Serves the built dashboard bundle
 * (#405/#426): the SPA reads each run's files over an event stream, so the daemon just serves
 * the files and runs the project's hooks. Resolves on SIGINT/SIGTERM after tearing the dashboard
 * down.
 */
export async function runDaemon(cwd: string, opts: RunDaemonOptions = {}): Promise<void> {
  const port = opts.port ?? DEFAULT_DAEMON_PORT
  const env = opts.env ?? process.env
  if (opts.version !== undefined) setOpenagentVersion(opts.version)
  // The browser bridge (#1237). Opt-in, because it opens the daemon's one route reachable from
  // another origin, behind a key of its own. The key may not exist yet, hence ensure, not read.
  const bridgeOn = (await readPreferences(undefined, env).catch((): Preferences => ({}))).bridge === true
  const bridgeToken = bridgeOn ? await ensureBridgeToken(undefined, env) : undefined
  // Which computer this is, said to every machine it gets into and to its own packages' services:
  // a machine lists this computer once by it. A home file that cannot be written says nothing.
  const computer = await ensureComputerId(undefined, env).catch(() => undefined)
  sayComputer(computer)
  // Everything the dashboard drives per project (a run's start, project install, the machine
  // relay) lives in the runtime, so this body stays about the daemon's own lifecycle.
  const runtime = createProjectRuntime({ cwd, env })
  // Known only once the dashboard listens; the bridge browser is told it (#1332).
  let daemonUrl: string | undefined

  // The daemon serves the built dashboard bundle (#405/#426): the SPA reads each run's files over
  // `GET /_rpc/events`, so there is no in-process event stream to feed here. The runtime's RPCs reach the browser through the
  // dashboard context the mount is wired with. A missing bundle (a broken install) surfaces as a
  // 503 from the server.
  const clientBundleDir = await resolveDashboardBundle()
  // The long-lived meter the usage panel draws (#685), owned here so it stops with the daemon.
  const quota = defaultQuotaSource()
  // The per-project error state (#1500): the background services write it, the dashboard reads it.
  const projectErrors = projectErrorStore()
  // The bridge browser (#1332): the daemon's own Chrome for Testing with the extension installed,
  // so a web run no longer needs the user's Chrome open. Created here, launched only once the
  // dashboard listens (the extension is told the daemon's address) and the preference says so.
  // It needs the bridge: without the token there is nothing to hand the extension.
  const bridgeBrowser = bridgeBrowserOwner(async (report, signal) => {
    if (!bridgeToken || !daemonUrl) {
      // The token is minted at boot, from the bridge preference as it stood then (above). A bridge
      // switched on since is a restart away; a bridge that is off wants switching on first.
      const bridgeOnNow = (await readPreferences(undefined, env).catch((): Preferences => ({}))).bridge === true
      throw new Error(
        bridgeOnNow
          ? 'the browser bridge was switched on after the dashboard started — restart the dashboard, and the browser launches on its own'
          : 'turn the browser bridge on, then restart the dashboard',
      )
    }
    return (opts.bridgeBrowser ?? (o => startBridgeBrowser(o)))({ daemonUrl, token: bridgeToken, dir: bridgeBrowserDir(env), report, signal })
  }, console.log)
  const dashboard: Dashboard = await startDashboard({
    port,
    quota,
    // Which models each coding agent offers: asked on the menu's first read, then kept.
    models: defaultModelsSource(),
    onStart: runtime.onStart,
    onAddProject: runtime.onAddProject,
    onStartedIn: runtime.onStartedIn,
    onRemoveProject: runtime.onRemoveProject,
    // Relay an agent to/from a saved machine (#1067): the events source streams an agent this daemon
    // is relaying, `remote` lets the read RPCs forward a remote agent's reads/steer/push to its machine
    // (slice 2), and the `/_relay/*` endpoints let another daemon run + read + steer a session here.
    eventsSource: runtime.remoteEventsSource,
    remote: runtime.remoteAgents,
    // A person's own OpenAgent on a computer several people use keeps their logins there: another
    // OpenAgent of theirs hands them over through the relay.
    relay: { project: runtime.projectAt, tailEvents: runtime.tailRelayEvents, rpc: runtime.onRelayRpc, bring: runtime.bringProject, ...(env.OPENAGENT_PERSON ? { logins: personLogins(runComputerCommand) } : {}) },
    screen: runtime.screenOf,
    // The browser bridge (#1237): absent unless the preference is on, which 404s every route.
    ...(bridgeToken ? { bridgeToken, bridgeSessions: () => listBridgeSessions(env) } : {}),
    // The bridge browser follows its switch (#1332): on launches it, off closes it, without a restart.
    preferences: registryPreferencesStore(nodeRegistryFs(), env, written => {
      if (written.bridgeBrowser === true) void bridgeBrowser.start()
      if (written.bridgeBrowser === false) void bridgeBrowser.stop()
    }),
    projectErrors: projectErrors.read,
    bridgeBrowser,
    ...(clientBundleDir ? { clientBundleDir } : {}),
  }).catch(async (err: unknown) => {
    // The port is taken (another dashboard runs there, say): what was set up for it stops, or
    // its timers keep the process alive.
    quota.stop()
    await runtime.dispose()
    throw err
  })

  daemonUrl = dashboard.url
  sayOwnUrl(dashboard.url)
  try {
    const actualPort = Number(new URL(dashboard.url).port) || port
    opts.onListening?.({ pid: process.pid, port: actualPort, url: dashboard.url, startedAt: new Date().toISOString() })
  } catch (err) {
    // Startup failed after the port was bound. Tear the server down, or it keeps the event loop
    // alive: a zombie process squatting the port.
    await dashboard.close()
    throw err
  }

  // The bridge browser comes up in the background (#1332): its first launch downloads Chrome,
  // and the dashboard must not wait on that. Read here rather than with the bridge preference
  // above: the launch needs the address the dashboard only has now.
  if ((await readPreferences(undefined, env).catch((): Preferences => ({}))).bridgeBrowser === true) void bridgeBrowser.start()

  // Each project's open hooks (#1774): the lines its own `.openagent/hooks.yml` names, run in
  // the project once the dashboard listens, so a slow line never delays the URL. The daemon names
  // no tool; the file does. Bounded and logged, never a reason the daemon did not come up.
  // The folder the caller named comes first, so its page opens before the other projects' lines
  // have run. The list is read before it is added: adding runs the new project's own open lines.
  const listed = await listProjects(undefined, env).catch(() => [])
  if (opts.project !== undefined) {
    const started = await runtime.onStartedIn(opts.project)
    if (started.ok) opts.onProject?.({ id: started.id, path: started.path, added: started.added, address: started.address })
    else console.log(`[openagent] could not add ${opts.project}: ${started.error}`)
  }
  for (const record of listed) {
    await runProjectHooks(record.path, 'open', { log: console.log })
  }

  // The services of OpenAgent's own packages: each runs for as long as the daemon does, and is
  // told the daemon's address.
  const packageServices = (opts.packageServices ?? startPackageServices)({ commands: await builtInServices().catch(() => []), url: dashboard.url, env: computer !== undefined ? { ...env, [COMPUTER_ENV]: computer } : env, log: console.log })

  // Everything that runs in the background beside serving the dashboard: the data sync and the
  // cloud sweeps.
  const services = startBackgroundServices({
    env,
    projectErrors,
    log: console.log,
  })

  await waitForShutdown(opts.signal)

  // One Ctrl+C stops the dashboard (#2141): a step that hangs is logged and left behind once the
  // deadline passes, and a second Ctrl+C stops at once.
  const hurry = (): void => {
    console.log('[openagent] stopping now')
    process.exit(130)
  }
  process.on('SIGINT', hurry)
  process.on('SIGTERM', hurry)
  let step = 'starting to stop'
  const teardown = async (): Promise<void> => {
    step = "the services of OpenAgent's own packages"
    await packageServices.stop()
    // The dashboard goes first after them: the port is free again, and an open tab sees the
    // dashboard is gone, while what is left stops behind it.
    step = 'the dashboard'
    await dashboard.close()
    step = 'the background services'
    await services.quiesce()
    // Each project's close hooks (#1774), the counterpart of the open hooks above. A run in flight
    // is not the daemon's process: it goes on to its end, and the next dashboard shows it.
    for (const record of await listProjects(undefined, env).catch(() => [])) {
      step = `the close hooks of ${record.path}`
      await runProjectHooks(record.path, 'close', { log: console.log })
    }
    // Stopped here as well as by the dashboard: a broken install serves 503s without ever taking
    // ownership of the source we handed in, and that poller would go on reading by itself.
    quota.stop()
    // The daemon's browser goes with the daemon (#1332): left running it would keep serving a
    // daemon that is gone, and the next daemon would find its profile held.
    step = 'the bridge browser'
    await bridgeBrowser.stop()
    step = 'the relayed runs'
    await runtime.dispose()
  }
  const deadlineMs = opts.shutdownDeadlineMs ?? SHUTDOWN_DEADLINE_MS
  let deadline: NodeJS.Timeout | undefined
  const late = new Promise<void>(resolvePromise => {
    deadline = setTimeout(() => {
      console.log(`[openagent] stopped without waiting for ${step}: stopping took longer than ${deadlineMs / 1000} s`)
      resolvePromise()
    }, deadlineMs).unref()
  })
  try {
    await Promise.race([teardown(), late])
  } finally {
    clearTimeout(deadline)
    process.off('SIGINT', hurry)
    process.off('SIGTERM', hurry)
  }
}

/** Resolve on SIGINT/SIGTERM, or when the optional abort signal fires. */
function waitForShutdown(signal?: AbortSignal): Promise<void> {
  return new Promise(resolvePromise => {
    if (signal?.aborted) return resolvePromise()
    const done = (): void => {
      process.off('SIGINT', done)
      process.off('SIGTERM', done)
      signal?.removeEventListener('abort', done)
      resolvePromise()
    }
    process.once('SIGINT', done)
    process.once('SIGTERM', done)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * The cloud sessions the browser bridge's Driver tab should be serving (#1237, #1332).
 *
 * Across every registered project, because a cloud agent is not tied to the daemon's home
 * checkout, and best-effort per project so one unreadable repo cannot empty the list.
 */
async function listBridgeSessions(env: NodeJS.ProcessEnv): Promise<BridgeSession[]> {
  const projects = await listProjects(undefined, env).catch(() => [])
  const agents = (await Promise.all(projects.map(p => readAllAgents(p.path).catch(() => [])))).flat()
  return bridgeSessionsFrom(agents, new Date(), bridgeQuestions().pendingAnswerSessions())
}
