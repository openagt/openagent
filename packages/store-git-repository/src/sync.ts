import { errorMessage } from '@openagt/git-branches'
import { personalFolderSyncs } from './folder-sync.js'
import { readSharing, withPersonalFolder, foldersOf } from '@openagt/store-filesystem'
import type { AppAttention, AppLifecycle } from '@openagt/hooks'

/**
 * The person's folder kept in step with their repository (#1582, #1599), the module's own work
 * (`app.lifecycle`, #2394, decision 17): a turn as the app starts, then one a minute, taking in
 * what their other computers pushed and sending what a save could not. A folder that syncs with no
 * repository has nothing to do: its first save makes it. One that does not converge needs the
 * person, said through `app.attention` until a turn goes through: about this computer, and about
 * each project whose data is kept in the folder.
 */

/** How often the folder is synced. */
export const SYNC_EVERY_MS = 60_000

/** One sync of the folder: whether it converged with its repository, and what went wrong if not. */
export type SyncFolder = () => Promise<{ ok: true } | { ok: false; error: string }>

/** What a folder that does not converge says first. */
export const NOT_SYNCING = 'Not syncing with your repository'

export interface FolderSyncDeps {
  /** Whether the folder syncs with a repository: the plugin's row, which may turn on while the app runs. */
  syncs?: () => Promise<boolean>
  /** The real one takes in the repository and sends what waits (`@openagt/agent-data`). */
  sync?: SyncFolder
  /** Whether a project keeps its data in the folder: one it does not share on its own branch. */
  keptHere?: (dir: string) => Promise<boolean>
  everyMs?: number
  now?: () => Date
  /** Where a failure is told, once for each new way it fails: the app's log. */
  log?: (line: string) => void
}

export function folderSync(deps: FolderSyncDeps = {}): { lifecycle: AppLifecycle; attention: AppAttention } {
  const syncs = deps.syncs ?? (() => personalFolderSyncs())
  const sync: SyncFolder =
    deps.sync ??
    (async () => {
      const written = await withPersonalFolder(foldersOf().personal, 'sync', async () => {})
      return written.ok ? { ok: true } : { ok: false, error: written.error }
    })
  const keptHere = deps.keptHere ?? (async dir => !(await readSharing(dir)))
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (line => console.log(line))
  /** What went wrong at the last turn, and since the first of the turns that failed in a row. */
  let failing: { error: string; since: string } | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let turn: Promise<void> | undefined

  const once = async (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return
    if (!(await syncs().catch(() => false))) {
      failing = undefined
      return
    }
    const outcome = await sync().catch((err: unknown) => ({ ok: false as const, error: errorMessage(err) }))
    if (!outcome.ok && failing?.error !== outcome.error) log(`[openagent] your agent data is not syncing: ${outcome.error}`)
    failing = outcome.ok ? undefined : { error: outcome.error, since: failing?.since ?? now().toISOString() }
  }

  return {
    lifecycle: {
      started(app) {
        clearInterval(timer)
        // One turn at a time: a turn that outlasts the minute is not run twice at once.
        const next = (): void => {
          turn ??= once(app.signal).finally(() => (turn = undefined))
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
    },
    attention: async ({ project }) => {
      const failed = failing
      // A shared project's data is on its own branch: the folder's state is not its own.
      if (!failed || (project && !(await keptHere(project.dir).catch(() => true)))) return []
      return [{ kind: 'setup', scope: 'computer', id: 'folder-sync', words: NOT_SYNCING, detail: failed.error, since: failed.since }]
    },
  }
}
