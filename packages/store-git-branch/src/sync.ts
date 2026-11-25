import { pullProjectData } from '@openagt/store-filesystem'
import type { AppAttention, AppLifecycle, ProjectRef } from '@openagt/hooks'

/**
 * The shared projects' data kept in step with their remotes (#1582, #1599), the module's own work
 * (`app.lifecycle`, #2394, decision 17): a turn as the app starts, then one a minute, each pulling
 * the `agent-data` branch of every project the module is on in, what other computers pushed coming
 * in and what a write could not send going out. A project whose data does not converge needs the
 * person, and is said through `app.attention` until a turn goes through.
 */

/** How often the shared projects' data is pulled. */
export const SYNC_EVERY_MS = 60_000

/** One project's pull: whether its data converged with its remote, and what went wrong if not. */
export type PullData = (dir: string) => Promise<{ ok: true } | { ok: false; error: string }>

/** What a project whose data does not converge says first, on its page and in its row. */
export const NOT_SYNCING = 'Not syncing with the remote'

export interface DataSyncDeps {
  /** The real one pulls the project's data branch (`@openagt/agent-data`). */
  pull?: PullData
  everyMs?: number
  now?: () => Date
  /** Where a failure is told, once for each new way it fails: the app's log. */
  log?: (line: string) => void
}

export function dataSync(deps: DataSyncDeps = {}): { lifecycle: AppLifecycle; attention: AppAttention } {
  const pull: PullData = deps.pull ?? (dir => pullProjectData(dir))
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (line => console.log(line))
  /** The projects whose data did not converge, by folder: what went wrong, and since when. */
  const failing = new Map<string, { error: string; since: string }>()
  /** Projects taken off the list: no turn makes their data's checkout again, right after a person asked for it to go. */
  const removed = new Set<string>()
  let timer: ReturnType<typeof setInterval> | undefined
  let turn: Promise<void> | undefined

  const once = async (projects: () => Promise<ProjectRef[]>, signal: AbortSignal): Promise<void> => {
    const on = await projects().catch((): ProjectRef[] => [])
    // A project no longer shared, or gone, has nothing more to say.
    for (const dir of failing.keys()) if (!on.some(project => project.dir === dir)) failing.delete(dir)
    for (const project of on) {
      if (signal.aborted) return
      if (removed.has(project.dir)) continue
      const outcome = await pull(project.dir).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
      const was = failing.get(project.dir)
      if (outcome.ok) failing.delete(project.dir)
      else {
        if (was?.error !== outcome.error) log(`[openagent] the data of ${project.name} is not syncing: ${outcome.error}`)
        failing.set(project.dir, { error: outcome.error, since: was?.since ?? now().toISOString() })
      }
    }
  }

  return {
    lifecycle: {
      started(app) {
        clearInterval(timer)
        // One turn at a time: a turn that outlasts the minute is not run twice at once.
        const next = (): void => {
          turn ??= once(() => app.projects(), app.signal).finally(() => (turn = undefined))
        }
        next()
        timer = setInterval(next, deps.everyMs ?? SYNC_EVERY_MS)
        timer.unref?.()
      },
      async stopping() {
        clearInterval(timer)
        timer = undefined
        // The turn under way commits and pushes: it ends before the app does.
        await turn
      },
      projectAdded(project) {
        removed.delete(project.dir)
      },
      projectRemoved(project) {
        removed.add(project.dir)
        failing.delete(project.dir)
      },
    },
    attention: ({ project }) => {
      const failed = project ? failing.get(project.dir) : undefined
      return failed ? [{ kind: 'setup', scope: 'project', id: 'data-sync', words: NOT_SYNCING, detail: failed.error, since: failed.since }] : []
    },
  }
}
