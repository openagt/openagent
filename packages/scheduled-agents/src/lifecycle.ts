import type { AppContext, AppLifecycle } from '@openagt/hooks'
import { cleanup } from './cleanup.js'

/** How often the projects the plugin is on in are looked at again: one it was switched on in starts its scheduler, one it was switched off in stops it. */
export const LOOK_AGAIN_MS = 60_000

export interface SchedulersDeps {
  /** Start the scheduler of the project at `repo`: `start`, which leaves one that runs as it is. */
  start: (repo: string) => Promise<unknown>
  /** Stop it: `stop`, or `stop --unless-keep-alive`. */
  stop: (repo: string, opts: { unlessKeepAlive?: boolean }) => Promise<unknown>
  log: (line: string) => void
  /** How often the projects are looked at again. */
  everyMs: number
}

/**
 * The scheduler's clock for as long as OpenAgent runs (#2394): its process (`start`, which ticks
 * every minute) runs in each project the plugin is on in. It starts as OpenAgent starts, as a
 * project is added, and within a minute of the plugin being switched on there; it stops within a
 * minute of the plugin being switched off there. As OpenAgent stops, and as a project is removed,
 * it stops unless a person set it to keep running (`stop --unless-keep-alive`); a project removed
 * with its files loses what this tool left in it then (`cleanup.ts`). A start that fails is told,
 * and tried again at the next look.
 */
export function schedulersLifecycle(deps: Partial<SchedulersDeps> = {}): AppLifecycle {
  // Read only once a scheduler is started: OpenAgent loads every plugin's module, on or not.
  const start = deps.start ?? (async repo => (await import('./scheduler.js')).startScheduler(repo))
  const stop = deps.stop ?? (async (repo, opts) => (await import('./scheduler.js')).stopScheduler(repo, opts))
  const log = deps.log ?? (line => console.log(line))
  const said = (err: unknown): string => (err instanceof Error ? err.message : String(err))
  /** The projects whose scheduler this OpenAgent started, by folder: the only ones it stops. */
  const started = new Set<string>()
  const startIn = async (repo: string): Promise<void> => {
    if (started.has(repo)) return
    started.add(repo)
    await start(repo).catch((err: unknown) => {
      started.delete(repo)
      log(`[scheduler] could not start the scheduler of ${repo}: ${said(err)}`)
    })
  }
  const stopIn = async (repo: string, opts: { unlessKeepAlive?: boolean } = {}): Promise<void> => {
    if (!started.delete(repo)) return
    await stop(repo, opts).catch((err: unknown) => log(`[scheduler] could not stop the scheduler of ${repo}: ${said(err)}`))
  }
  // One look at a time: a slow one is not joined by the next.
  let looking: Promise<void> = Promise.resolve()
  const look = (app: AppContext): Promise<void> =>
    (looking = looking
      .then(async () => {
        if (app.signal.aborted) return
        const on = new Set((await app.projects()).map(project => project.dir))
        for (const repo of on) await startIn(repo)
        // Switched off there: the person wants no scheduled agents in it, kept alive or not.
        for (const repo of [...started]) if (!on.has(repo)) await stopIn(repo)
      })
      .catch((err: unknown) => log(`[scheduler] could not read where the plugin is on: ${said(err)}`)))
  return {
    async started(app) {
      await look(app)
      const timer = setInterval(() => void look(app), deps.everyMs ?? LOOK_AGAIN_MS)
      timer.unref()
      app.signal.addEventListener('abort', () => clearInterval(timer), { once: true })
    },
    async stopping() {
      await looking
      for (const repo of [...started]) await stopIn(repo, { unlessKeepAlive: true })
    },
    async projectAdded(project) {
      await startIn(project.dir)
    },
    async projectRemoved(project, _app, { files }) {
      await stopIn(project.dir, { unlessKeepAlive: true })
      if (!files) return undefined
      // With its files: what this tool left in the project goes too, once its scheduler is stopped (`cleanup.ts`).
      const outcome = await cleanup(project.dir)
      if (!outcome.ok) throw new Error(`the scheduler is running here (pid ${outcome.pid}): stop it first with npx @openagt/scheduled-agents@0.1 stop`)
      return { removed: outcome.removed, kept: outcome.kept }
    },
  }
}
