import { withLocalBin } from './local-bin.js'
import { refreshLoginShellPath } from './shell-path.js'
import { startDashboard, type Dashboard } from './dashboard/server.js'
import { createProjectRuntime } from './daemon-runtime.js'
import { openAgentUpdates } from './dashboard/openagent-update.js'
import { projectStateReader } from './project-state.js'
import { resolveDashboardBundle } from './dashboard/bundle.js'
import { resolveWebsite } from './dashboard/website.js'
import { registryPreferencesStore } from './registry.js'
import { readySessionsHome } from './sessions-home.js'
import { distributionHooks, localHostOf } from './distribution-hooks.js'
import type { Hooks, ProjectRef, RunHost } from '@openagt/hooks'
import { sessionsHome } from '@openagt/agent-data'
import { readSecureAddress, SECURE_PORT, type SecureAddress } from './secure-address.js'
import type { StartedProject } from './dashboard/types.js'

/**
 * The dashboard process (#302). It is a pure projection of files: a run's tool keeps the run's
 * card and diary in the run's checkout, and the dashboard *tails* them, pushing each new line to
 * connected browsers. No run<->dashboard IPC: the files are the seam. The daemon runs no agent:
 * a Start, and what a person says to a run, go to this computer's host (`run.host`, #2394), which
 * starts the run's own process, and reaches it through its inbox file, or resumes it once it has ended.
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
  /** The URL to open: the secure address's when it is answered, else the plain one. */
  url: string
  /** ISO timestamp the daemon started. */
  startedAt: string
}

/** Options for {@link runDaemon}. */
export interface RunDaemonOptions {
  /** Port to bind. Default {@link DEFAULT_DAEMON_PORT}; pass `0` for an ephemeral port. */
  port?: number
  /** Shut the daemon down when this aborts (in addition to SIGINT/SIGTERM). For tests. */
  signal?: AbortSignal
  /** Env the registry is read from. Default `process.env`; injectable for tests. */
  env?: NodeJS.ProcessEnv
  /** Called once the server has bound, before it blocks. The only way a caller learns the port. */
  onListening?: (state: DaemonState) => void
  /**
   * The folder `openagent` was typed in, made a project once the dashboard listens (`folderGiven`,
   * the projects module's): the repository it is in, added as Add project adds one. One already
   * on the list, or inside one that is, is left as it is. The dashboard adds no folder by itself:
   * this is the caller's.
   */
  project?: string
  /** Called once {@link project} was asked about: its id, which always opens its page, the address the page shows, and whether it was added now; none for a folder that is no project, outside any repository. */
  onProject?: (project: StartedProject | undefined) => void
  /** How long the teardown after Ctrl+C may take; default {@link SHUTDOWN_DEADLINE_MS}. For tests. */
  shutdownDeadlineMs?: number
  /** The modules the dashboard runs, loaded; its distribution's when unsaid (`distribution-hooks.ts`). For tests. */
  hooks?: Hooks
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
  // What a press installs is found at once, by the checks and by every run started from here.
  withLocalBin(process.env)
  // What the person's terminal runs is found by the checks and by every run started from here: the
  // service's own PATH is the one its install's terminal had.
  await refreshLoginShellPath()
  // Everything the dashboard drives per project (a run's start, project install) lives in the
  // runtime, so this body stays about the daemon's own lifecycle.
  // A run starts on this computer's host, the distribution's (#2394), which names it as it starts.
  const hooks = opts.hooks ?? (await distributionHooks(env))
  const host = await localHostOf(hooks)
  // The hosts beside it, of the modules on in a project (a CI runner): a run may be picked to run on one.
  const otherHosts = async (project?: ProjectRef): Promise<RunHost[]> => (await hooks.hosts(project)).filter(other => other.id !== host.id)
  // The folder `openagent` was typed in is made a project by the modules (`app.lifecycle`): the projects module's.
  const runtime = createProjectRuntime({ cwd, env, host, otherHosts, folderGiven: folder => hooks.folderGiven(folder) })
  // The daemon serves the built dashboard bundle (#405/#426): the SPA reads each run's files over
  // `GET /_rpc/events`, so there is no in-process event stream to feed here. The runtime's RPCs reach the browser through the
  // dashboard context the mount is wired with. A missing bundle (a broken install) surfaces as a
  // 503 from the server.
  const clientBundleDir = await resolveDashboardBundle()
  const websiteDir = await resolveWebsite()
  // A secure address that cannot be read is said, and the dashboard comes up on its plain one.
  const secure = await readSecureAddress(env).catch((err: unknown): SecureAddress | undefined => {
    console.log(`[openagent] the secure address could not be read (${err instanceof Error ? err.message : String(err)})`)
    return undefined
  })
  const dashboard: Dashboard = await startDashboard({
    port,
    context: {
      startAgent: runtime.onStart,
      startedIn: runtime.onStartedIn,
      host,
      otherHosts,
      preferences: registryPreferencesStore(env),
      openAgentUpdate: openAgentUpdates(),
      // What a project's page and row say of it beside its runs: the modules on in it say what needs setting up.
      projectState: projectStateReader({ hooks: async () => hooks }),
    },
    screen: runtime.screenOf,
    // What the modules on answer on the dashboard's address (`app.route`): host-claude-web's bridge.
    routes: () => hooks.routes(),
    ...(clientBundleDir ? { clientBundleDir } : {}),
    ...(secure ? { secure: { ...secure, port: SECURE_PORT } } : {}),
    ...(websiteDir ? { websiteDir } : {}),
  }).catch(async (err: unknown) => {
    // The port is taken (another dashboard runs there, say).
    throw err
  })

  try {
    const actualPort = Number(new URL(dashboard.url).port) || port
    opts.onListening?.({ pid: process.pid, port: actualPort, url: dashboard.secureUrl ?? dashboard.url, startedAt: new Date().toISOString() })
  } catch (err) {
    // Startup failed after the port was bound. Tear the server down, or it keeps the event loop
    // alive: a zombie process squatting the port.
    await dashboard.close()
    throw err
  }

  // The folder the caller named comes first, so its page opens before the modules start their
  // work: adding it tells the modules on in it (`projectAdded`).
  if (opts.project !== undefined) {
    const started = await runtime.onStartedIn(opts.project)
    if (started === undefined || started.ok) opts.onProject?.(started && { id: started.id, path: started.path, added: started.added, address: started.address })
    else {
      console.log(`[openagent] could not add ${opts.project}: ${started.error}`)
      opts.onProject?.(undefined)
    }
  }
  // The sessions with no project: their home made, before the modules start their work there.
  await readySessionsHome(sessionsHome(env))

  // The modules' own work (`app.lifecycle`), once the dashboard listens, so it never delays the
  // URL: the projects' schedulers. Each module on starts it, told where OpenAgent answers, and a
  // plugin kept per computer starts and stops with its switch from then on.
  const lifecycle = new AbortController()
  await hooks.started({ signal: lifecycle.signal, url: dashboard.url })

  await waitForShutdown(opts.signal)

  await stopWithin(opts.shutdownDeadlineMs ?? SHUTDOWN_DEADLINE_MS, async step => {
    step("the modules' own work")
    lifecycle.abort()
    await hooks.stopping()
    // The dashboard goes first after it: the port is free again, and an open tab sees the
    // dashboard is gone, while what is left stops behind it.
    step('the dashboard')
    await dashboard.close()
  })
}

/**
 * Run the teardown, giving up on what is left of it once `deadlineMs` has passed: one Ctrl+C
 * stops the dashboard (#2141). The teardown names each step as it starts it, so a step that hangs
 * is logged by its name and left behind, and a second Ctrl+C meanwhile stops at once.
 */
async function stopWithin(deadlineMs: number, teardown: (step: (name: string) => void) => Promise<void>): Promise<void> {
  const hurry = (): void => {
    console.log('[openagent] stopping now')
    process.exit(130)
  }
  process.on('SIGINT', hurry)
  process.on('SIGTERM', hurry)
  let step = 'starting to stop'
  let deadline: NodeJS.Timeout | undefined
  const late = new Promise<void>(resolvePromise => {
    deadline = setTimeout(() => {
      console.log(`[openagent] stopped without waiting for ${step}: stopping took longer than ${deadlineMs / 1000} s`)
      resolvePromise()
    }, deadlineMs).unref()
  })
  try {
    await Promise.race([teardown(name => void (step = name)), late])
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
