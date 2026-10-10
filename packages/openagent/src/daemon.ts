import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { OPENAGENT_DIR } from './openagent-dir.js'
import { startDashboard, type Dashboard } from './dashboard/index.js'
import { createProjectRuntime } from './daemon-runtime.js'
import { defaultQuotaSource } from './dashboard/quota.js'
import { defaultModelsSource } from './dashboard/models.js'
import { startBackgroundServices } from './daemon-services.js'
import { projectErrorStore } from './project-errors.js'
import { resolveDashboardBundle } from './dashboard/bundle.js'
import { ensureDaemonToken, listProjects, nodeRegistryFs, readPreferences, registryPreferencesStore, type Preferences } from './registry.js'
import { isLoopbackHost } from './loopback-host.js'
import { bridgeSessionsFrom } from './dashboard/bridge-sessions.js'
import { bridgeQuestions } from './dashboard/bridge-store.js'
import { bridgeBrowserDir, bridgeBrowserOwner, startBridgeBrowser, type BridgeBrowser, type BridgeBrowserOptions } from './bridge-browser.js'
import { runProjectHooks } from './project-hooks.js'
import { readAllAgents } from './store/index.js'
import type { BridgeSession } from './dashboard/index.js'

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

/** The default bind host (#1051): localhost only, so the daemon is unreachable off the machine. */
export const DEFAULT_DAEMON_HOST = '127.0.0.1'

/**
 * True when `host` is a loopback address the browser reaches without leaving the machine (#1051).
 * Defined in its own leaf module so the dashboard's RPC mount can share the one definition without
 * importing this one back (a cycle); re-exported here for the callers that already had it.
 */
export { isLoopbackHost }

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
  /** The host the dashboard is bound to (#1051). */
  host?: string
}

/** The `.openagent/` directory for a workspace. */
function daemonDir(cwd: string): string {
  return join(cwd, OPENAGENT_DIR)
}

/** True when a process with this id is still running (best-effort, signal 0). The store's
 * {@link isPidAlive} under the daemon's historical public name -- the two were byte-identical. */
export { isPidAlive as isProcessAlive } from './store/index.js'

/** Options for {@link runDaemon}. */
export interface RunDaemonOptions {
  /** Port to bind. Default {@link DEFAULT_DAEMON_PORT}; pass `0` for an ephemeral port. */
  port?: number
  /** Host to bind (#1051). Default {@link DEFAULT_DAEMON_HOST}; a non-loopback address generates and
   * requires the shared token, and every route is then gated behind it. */
  host?: string
  /** Shut the daemon down when this aborts (in addition to SIGINT/SIGTERM). For tests. */
  signal?: AbortSignal
  /** Env the registry is read from. Default `process.env`; injectable for tests. */
  env?: NodeJS.ProcessEnv
  /** Called once the server has bound, before it blocks. The only way a caller learns the port. */
  onListening?: (state: DaemonState) => void
  /** How the bridge browser is launched (#1332); default the real Chrome for Testing. For tests. */
  bridgeBrowser?: (opts: BridgeBrowserOptions) => Promise<BridgeBrowser>
}

/**
 * The daemon body, run in the foreground by bare `openagent`. Serves the built dashboard bundle
 * (#405/#426): the SPA reads each run's files over an event stream, so the daemon just serves
 * the files and runs the project's hooks. Resolves on SIGINT/SIGTERM after tearing the dashboard
 * down.
 */
export async function runDaemon(cwd: string, opts: RunDaemonOptions = {}): Promise<void> {
  const port = opts.port ?? DEFAULT_DAEMON_PORT
  const host = opts.host ?? DEFAULT_DAEMON_HOST
  const env = opts.env ?? process.env
  // #1051: a non-loopback bind reaches the network, where a daemon that spawns processes is RCE for
  // anyone who finds the port, so generate + persist the shared token the request guard requires. A
  // loopback bind needs none, so the local zero-config path stays byte-identical.
  const token = isLoopbackHost(host) ? undefined : await ensureDaemonToken(undefined, env)
  // The browser bridge (#1237). Opt-in, because it opens the daemon's one route reachable from
  // another origin. It reuses the same shared token (#1051) rather than minting a second one: the two
  // guard the same daemon, so a second secret would be another thing to rotate and leak without
  // narrowing anything. On a loopback bind that secret may not exist yet, hence ensure, not read.
  const bridgeOn = (await readPreferences(undefined, env).catch((): Preferences => ({}))).bridge === true
  const bridgeToken = bridgeOn ? await ensureDaemonToken(undefined, env) : undefined
  // The project's own `.openagent/` — where its hooks file sits, and where a run's tool keeps
  // the run's card and diary inside the run's checkout. Created up front so the daemon works as the
  // very first command in a fresh workspace, before any run has made the directory.
  await mkdir(daemonDir(cwd), { recursive: true })

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
  const bridgeBrowser = bridgeBrowserOwner(async report => {
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
    return (opts.bridgeBrowser ?? (o => startBridgeBrowser(o)))({ daemonUrl, token: bridgeToken, dir: bridgeBrowserDir(env), report })
  }, console.log)
  const dashboard: Dashboard = await startDashboard({
    host,
    port,
    quota,
    // Which models each coding agent offers: asked on the menu's first read, then kept.
    models: defaultModelsSource(),
    onStart: runtime.onStart,
    onAddProject: runtime.onAddProject,
    onRemoveProject: runtime.onRemoveProject,
    // Relay an agent to/from a saved machine (#1067): the events source streams an agent this daemon
    // is relaying, `remote` lets the read RPCs forward a remote agent's reads/steer/push to its machine
    // (slice 2), and the `/_relay/*` endpoints let another daemon run + read + steer a session here.
    eventsSource: runtime.remoteEventsSource,
    remote: runtime.remoteAgents,
    relay: { project: runtime.projectAt, tailEvents: runtime.tailRelayEvents, rpc: runtime.onRelayRpc },
    // The browser bridge (#1237): absent unless the preference is on, which 404s every route.
    ...(bridgeToken ? { bridgeToken, bridgeSessions: () => listBridgeSessions(env) } : {}),
    // The bridge browser follows its switch (#1332): on launches it, off closes it, without a restart.
    preferences: registryPreferencesStore(nodeRegistryFs(), env, written => {
      if (written.bridgeBrowser === true) void bridgeBrowser.start()
      if (written.bridgeBrowser === false) void bridgeBrowser.stop()
    }),
    projectErrors: projectErrors.read,
    bridgeBrowser,
    ...(token ? { token } : {}),
    ...(clientBundleDir ? { clientBundleDir } : {}),
  })

  daemonUrl = dashboard.url
  try {
    const actualPort = Number(new URL(dashboard.url).port) || port
    opts.onListening?.({ pid: process.pid, port: actualPort, host, url: dashboard.url, startedAt: new Date().toISOString() })
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
  for (const record of await listProjects(undefined, env).catch(() => [])) {
    await runProjectHooks(record.path, 'open', { log: console.log })
  }

  // Everything that runs in the background beside serving the dashboard: the data sync and the
  // cloud sweeps.
  const services = startBackgroundServices({
    env,
    projectErrors,
    log: console.log,
  })

  await waitForShutdown(opts.signal)

  await services.quiesce()
  // Each project's close hooks (#1774), the counterpart of the open hooks above. A run in flight
  // is not the daemon's process: it goes on to its end, and the next dashboard shows it.
  for (const record of await listProjects(undefined, env).catch(() => [])) {
    await runProjectHooks(record.path, 'close', { log: console.log })
  }
  // Stopped here as well as by the dashboard: a broken install serves 503s without ever taking
  // ownership of the source we handed in, and that poller would go on reading by itself.
  quota.stop()
  // The daemon's browser goes with the daemon (#1332): left running it would keep serving a
  // daemon that is gone, and the next daemon would find its profile held.
  await bridgeBrowser.stop()
  await runtime.dispose()
  await dashboard.close()
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
