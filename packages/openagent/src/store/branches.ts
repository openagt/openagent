import { runPackageCommand, type ProvidedCommand } from '@openagt/agent-data'
import { providedCommand } from '../built-in.js'
import { isRunId } from './runs.js'

/**
 * The checkouts and the branches, as OpenAgent reads and acts on them (#1774). OpenAgent
 * keeps no checkout and imports no branches package: a project's checkouts come from whichever of
 * its packages declares that it provides them — `"openagent": { "branches": "<command>" }` in the
 * package's own package.json — and OpenAgent reads and moves them by running that command.
 * Swap the package for another that answers the same command line and prints the same shapes,
 * and nothing here changes. No package declares it: the project has no checkouts, so no run with
 * one, no branch to hand off, nothing to remove.
 *
 * The command line a provider answers, each printing one JSON document and exiting 0 (a refusal
 * exits 1 with its reason on stderr):
 *   `<command> list [--sizes]`                          every checkout, as an array of {@link Checkout}
 *   `<command> show [--from <commit>] <branch>...`      what each branch holds and where it stands, as an array of {@link BranchState}, in the order asked;
 *                                                       measured from `<commit>`, where the branches started, in place of the default branch;
 *                                                       a full commit id in place of a branch is read as a branch that ends there
 *   `<command> ahead [--from <commit>] <branch>...`     how far each branch is past the base, whether the remote has it, and what its checkout left uncommitted,
 *                                                       as an array of {@link BranchAhead}: no file lists, so every run's branch can be asked on a poll
 *   `<command> merge <b>`                               merge the branch into the default branch, on this machine, then delete it
 *   `<command> push --branch <b>`                       push the branch to the remote; a branch only the remote has is answered as it is
 *   `<command> remove <id> [--from <commit>] [--discard]`  reclaim a run's checkout once its branch holds everything, pushing nothing, its branch measured from the commit it started from; `--discard` drops uncommitted work
 * `list`, `show` and `ahead` read this machine, no network: OpenAgent polls. `show` answers the branch's
 * git facts only; its pull request is the git host provider's (`git-host.ts`), as every pull request is.
 *
 * That is the whole contract: git, and nothing beyond it (#1820). OpenAgent reads checkouts to
 * find the runs that have one, and a branch's state for what it composes: the run page's handoff,
 * the Human Queue's unpushed rows. Opening a pull request is the push here, then the git host
 * provider's `open`. What a checkout is, where it lives, how a branch is pushed is the package's.
 *
 * The shapes, owned here: {@link Checkout}, {@link BranchState}, {@link BranchAhead}.
 */

/** A run's checkout: where it works, as a provider lists it. */
export interface Checkout {
  /** The run's id. */
  id: string
  /** The checkout's directory, absolute. */
  path: string
  /** The branch it is on; absent for a checkout on none, or one git no longer knows. */
  branch?: string
  /** The name the agent gave its work, as the provider answers it; absent while the run has not named it. Drawn where a branch would be drawn as a name. */
  name?: string
  /** Its size on disk, when sizes were asked for. */
  sizeBytes?: number
}

/** One commit a branch holds beyond its base. */
export interface BranchCommit {
  sha: string
  subject: string
}

/** One file a branch changed against its base. */
export interface BranchFile {
  path: string
  insertions: number
  deletions: number
  /** A binary file, where line counts mean nothing. */
  binary: boolean
}

/** What a branch holds and where it stands, as a provider answers `show`: git facts, no pull request. */
export interface BranchState {
  branch: string
  /** The name the agent gave its work, as the provider answers it; absent while the run has not named it. */
  name?: string
  /** The branch exists on this machine. Gone: every list below is empty, and only the remote can say more. */
  exists: boolean
  /** What it is measured against: the commit asked with `--from`, else the project's default branch, when one was found. */
  base?: string
  /** The branch's own commits beyond the base, newest first. */
  commits: BranchCommit[]
  /** What it changed since it left the base. */
  files: BranchFile[]
  /** The project has a remote to push to. */
  hasRemote: boolean
  /** The remote has the branch at this same tip. */
  pushed: boolean
  /** The base already contains it. */
  merged: boolean
  /** The uncommitted paths in the checkout that is on this branch; absent when no checkout is. */
  pendingFiles?: string[]
}

/** How far a branch is past its base and whether the remote has it, as a provider answers `ahead`: counts, no files. */
export interface BranchAhead {
  branch: string
  /** The branch exists on this machine. */
  exists: boolean
  /** A branch the provider made for a run, not one of the person's own. */
  agent: boolean
  /** How many commits of its own it has beyond the base. */
  ahead: number
  /** The project has a remote to push to. */
  hasRemote: boolean
  /** The remote has the branch at this same tip. */
  pushed: boolean
  /** It was pushed, and the remote's copy is gone since, as a merged pull request's is. */
  gone: boolean
  /** The project's default branch already contains it. */
  merged: boolean
  /** How many paths the run's checkout on it left uncommitted; 0 with no checkout. */
  uncommitted: number
}

/** What pushing a branch did: `pushed` is false when only the remote had it, so there was nothing here to push. */
export type PushOutcome = { ok: true; pushed: boolean } | { ok: false; error: string }

/**
 * What merging a branch into the project's default branch did: `into` names that branch, `commit`
 * is the merged branch's last commit and `from` the commit its work began at, and `deleted` says
 * the branch went once its work was in.
 */
export type MergeOutcome = { ok: true; into: string; commit: string; from: string; deleted: boolean } | { ok: false; error: string }

/** What reclaiming a checkout did: done, with the branches that went with it when any did, or the provider's reason it stayed. */
export type RemoveOutcome = { ok: true; branchesDeleted?: string[] } | { ok: false; error: string }

/** A project's checkouts and branches: what a provider answers, read and moved by OpenAgent. */
export interface BranchesSource {
  /**
   * Every checkout; `[]` when none can be read. `fresh` asks past a list read within the window:
   * the caller is looking for a checkout that may have just appeared. A list read less than
   * {@link FRESH_MS} ago still answers, so a caller asking every second for a run that has no
   * checkout is not a process every second.
   */
  list(opts?: { sizes?: boolean; fresh?: boolean }): Promise<Checkout[]>
  /**
   * Each branch's state, in the order asked; a branch the provider did not answer for is missing.
   * `[]` when nothing can be read. `from` is the commit the branches started from, which their
   * commits and files are then measured from. A full commit id in place of a branch reads what a
   * branch that ended there held.
   */
  show(branches: readonly string[], from?: string): Promise<BranchState[]>
  /** How far each branch is past its base and whether the remote has it, in the order asked; `[]` when nothing can be read. `from` as for {@link show}. */
  ahead(branches: readonly string[], from?: string): Promise<BranchAhead[]>
  /** Push a branch to the remote: the checkout on it under its clean rule, else the branch itself. */
  push(branch: string): Promise<PushOutcome>
  /** Merge a branch into the project's default branch, on this machine, then delete it; a merge that conflicts changes nothing. */
  merge(branch: string): Promise<MergeOutcome>
  /**
   * Reclaim a run's checkout, or why it stayed. `from` is the commit the run's branch started
   * from, when that is not the default branch: what tells a branch with nothing of its own.
   * `discard` drops its uncommitted work instead of refusing over it.
   */
  remove(id: string, opts?: { discard?: boolean; from?: string }): Promise<RemoveOutcome>
}

/** The checkouts of the project at `root`, or `undefined` when none of its packages provides them. */
export type BranchesFor = (root: string) => Promise<BranchesSource | undefined>

/** A {@link BranchesFor} that also forgets what it read of one project, for when a module or a run just wrote there. */
export type BranchesReader = BranchesFor & { changed(root: string): void }

/** How long a read is reused: the dashboard polls several reads of every project's checkouts every few seconds, and each is a process. */
const CACHE_MS = 5_000

/** How recent a list read still answers a `fresh` ask: younger than this, the checkout the caller looks for was not there a moment ago either. */
const FRESH_MS = 1_000

/** The rows read back from a provider's `list`: the objects with an id and a path, everything else as printed; anything else is no checkout. */
export function parseCheckouts(output: unknown): Checkout[] {
  if (!Array.isArray(output)) return []
  const rows: Checkout[] = []
  for (const value of output) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    const id = row['agentId'] ?? row['id']
    if (typeof id !== 'string' || !isRunId(id) || typeof row['path'] !== 'string' || row['path'] === '') continue
    rows.push({
      id,
      path: row['path'],
      ...(typeof row['branch'] === 'string' && row['branch'] !== '' ? { branch: row['branch'] } : {}),
      ...(typeof row['name'] === 'string' && row['name'] !== '' ? { name: row['name'] } : {}),
      ...(typeof row['sizeBytes'] === 'number' ? { sizeBytes: row['sizeBytes'] } : {}),
    })
  }
  return rows
}

/** The states read back from a provider's `show`: the objects with a branch and the three verdicts, lists cleaned; anything else is no state. */
export function parseBranchStates(output: unknown): BranchState[] {
  if (!Array.isArray(output)) return []
  const states: BranchState[] = []
  for (const value of output) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    if (typeof row['branch'] !== 'string' || row['branch'] === '' || typeof row['exists'] !== 'boolean' || typeof row['pushed'] !== 'boolean' || typeof row['merged'] !== 'boolean') continue
    states.push({
      branch: row['branch'],
      ...(typeof row['name'] === 'string' && row['name'] !== '' ? { name: row['name'] } : {}),
      exists: row['exists'],
      ...(typeof row['base'] === 'string' && row['base'] !== '' ? { base: row['base'] } : {}),
      commits: commitsOf(row['commits']),
      files: filesOf(row['files']),
      hasRemote: row['hasRemote'] === true,
      pushed: row['pushed'],
      merged: row['merged'],
      ...(Array.isArray(row['pendingFiles']) ? { pendingFiles: row['pendingFiles'].filter((path): path is string => typeof path === 'string') } : {}),
    })
  }
  return states
}

/** The counts read back from a provider's `ahead`: the objects with a branch and every verdict; anything else is no answer. */
export function parseBranchesAhead(output: unknown): BranchAhead[] {
  if (!Array.isArray(output)) return []
  return output.flatMap(value => {
    const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    const flags = ['exists', 'agent', 'hasRemote', 'pushed', 'gone', 'merged'] as const
    if (typeof row['branch'] !== 'string' || row['branch'] === '' || typeof row['ahead'] !== 'number' || typeof row['uncommitted'] !== 'number' || flags.some(flag => typeof row[flag] !== 'boolean')) return []
    const flag = (name: (typeof flags)[number]): boolean => row[name] === true
    return [{ branch: row['branch'], exists: flag('exists'), agent: flag('agent'), ahead: row['ahead'], hasRemote: flag('hasRemote'), pushed: flag('pushed'), gone: flag('gone'), merged: flag('merged'), uncommitted: row['uncommitted'] }]
  })
}

function commitsOf(value: unknown): BranchCommit[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    const commit = entry as Record<string, unknown> | null
    return commit && typeof commit['sha'] === 'string' && commit['sha'] !== '' ? [{ sha: commit['sha'], subject: typeof commit['subject'] === 'string' ? commit['subject'] : '' }] : []
  })
}

function filesOf(value: unknown): BranchFile[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    const file = entry as Record<string, unknown> | null
    if (!file || typeof file['path'] !== 'string' || file['path'] === '') return []
    return [
      {
        path: file['path'],
        insertions: typeof file['insertions'] === 'number' ? file['insertions'] : 0,
        deletions: typeof file['deletions'] === 'number' ? file['deletions'] : 0,
        binary: file['binary'] === true,
      },
    ]
  })
}

/** The branches source over one provider command: each read one run of the command, cached per {@link CACHE_MS}; each write drops the reads. */
function commandBranches(root: string, command: ProvidedCommand, now: () => number): BranchesSource & { drop(): void } {
  const listed = new Map<string, { at: number; rows: Promise<Checkout[]> }>()
  const read = new Map<string, { at: number; answer: Promise<unknown[]> }>()
  const drop = (): void => {
    listed.clear()
    read.clear()
  }
  // A read of branches by name, `show` or `ahead`: concurrent and recent asks of the same branches share one process; a read that failed is not kept.
  const branchRead = <T>(verb: 'show' | 'ahead', parse: (output: unknown) => T[], branches: readonly string[], from: string | undefined): Promise<T[]> => {
    const asked = branches.filter(branch => branch !== '')
    if (asked.length === 0) return Promise.resolve([])
    const key = [verb, from ?? '', ...asked].join('\0')
    const known = read.get(key)
    if (known && now() - known.at < CACHE_MS) return known.answer as Promise<T[]>
    const entry: { at: number; answer: Promise<T[]> } = { at: now(), answer: Promise.resolve([]) }
    entry.answer = runPackageCommand(root, command, [verb, ...(from ? ['--from', from] : []), ...asked]).then(result => {
      if (!result.ok || !Array.isArray(result.output)) {
        if (read.get(key) === entry) read.delete(key)
        return []
      }
      return parse(result.output)
    })
    read.set(key, entry)
    return entry.answer
  }
  return {
    drop,
    list(opts = {}) {
      // Concurrent reads share one process; a read that failed is not kept.
      const key = opts.sizes ? 'sizes' : 'plain'
      const known = listed.get(key)
      if (known && now() - known.at < (opts.fresh ? FRESH_MS : CACHE_MS)) return known.rows
      const read: { at: number; rows: Promise<Checkout[]> } = { at: now(), rows: Promise.resolve([]) }
      read.rows = runPackageCommand(root, command, ['list', ...(opts.sizes ? ['--sizes'] : [])]).then(result => {
        if (!result.ok || !Array.isArray(result.output)) {
          if (listed.get(key) === read) listed.delete(key)
          return []
        }
        return parseCheckouts(result.output)
      })
      listed.set(key, read)
      return read.rows
    },
    show: (branches, from) => branchRead('show', parseBranchStates, branches, from),
    ahead: (branches, from) => branchRead('ahead', parseBranchesAhead, branches, from),
    async push(branch) {
      const result = await runPackageCommand(root, command, ['push', '--branch', branch])
      drop()
      if (!result.ok) return { ok: false, error: result.error }
      const pushed = result.output && typeof result.output === 'object' ? (result.output as Record<string, unknown>)['pushed'] : undefined
      return { ok: true, pushed: pushed !== false }
    },
    async merge(branch) {
      const result = await runPackageCommand(root, command, ['merge', branch])
      drop()
      if (!result.ok) return { ok: false, error: result.error }
      const out = (result.output && typeof result.output === 'object' ? result.output : {}) as Record<string, unknown>
      const { into, commit, from } = out
      if (typeof into !== 'string' || typeof commit !== 'string' || typeof from !== 'string') return { ok: false, error: 'the branches provider answered no merge' }
      return { ok: true, into, commit, from, deleted: out['deleted'] === true }
    },
    async remove(id, opts = {}) {
      if (!isRunId(id)) return { ok: false, error: `not a run id: ${id}` }
      const result = await runPackageCommand(root, command, ['remove', id, ...(opts.discard ? ['--discard'] : opts.from ? ['--from', opts.from] : [])])
      drop()
      if (!result.ok) return { ok: false, error: result.error }
      const gone = result.output && typeof result.output === 'object' ? (result.output as Record<string, unknown>)['branchesDeleted'] : undefined
      const branchesDeleted = Array.isArray(gone) ? gone.filter((branch): branch is string => typeof branch === 'string') : []
      return branchesDeleted.length ? { ok: true, branchesDeleted } : { ok: true }
    },
  }
}

/**
 * The production {@link BranchesReader}: the project's provider, looked up among the packages the project has (`built-in.ts`),
 * one source per project kept while the same command provides — so the cache holds across the
 * many reads of one poll, and a project that installs, swaps or drops its provider is read the new
 * way within {@link CACHE_MS}. `changed(root)` forgets that project's reads, so the next read runs
 * the command again: a run just started there, or a module's command just ran, and a checkout may
 * have come or gone.
 */
export function providedBranches(now: () => number = Date.now): BranchesReader {
  const sources = new Map<string, { at: number; command?: ProvidedCommand; source?: ReturnType<typeof commandBranches> }>()
  const reader: BranchesFor = async root => {
    let known = sources.get(root)
    if (!known || now() - known.at >= CACHE_MS) {
      const command = await providedCommand(root, 'branches').catch(() => undefined)
      const same = known?.command && command && known.command.bin === command.bin
      known = { at: now(), ...(command ? { command, source: same ? known!.source! : commandBranches(root, command, now) } : {}) }
      sources.set(root, known)
    }
    return known.source
  }
  return Object.assign(reader, { changed: (root: string) => sources.get(root)?.source?.drop() })
}

/** OpenAgent's one reader of the checkouts, shared by every caller so they share its cache. */
export const projectBranches: BranchesReader = providedBranches()

/** A {@link BranchesFor} for a project with no provider: no checkouts. */
export const noBranches: BranchesFor = async () => undefined
