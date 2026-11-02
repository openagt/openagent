import { existsSync } from 'node:fs'
import { hostname } from 'node:os'
import { nodeGitRunner, originDefaultBranch, type GitRunner } from '@openagt/agent-data'
import type { MergeLookup, ModuleServerHost } from '@openagt/dashboard/module-server'
import { listFiles } from './list.js'
import { cutToPreview, readFileContent, safeRepoPath, type FileContent } from './read.js'

// A run's files, for the agent page's Files pane, for as long as git still has them. The run's
// checkout while it exists; once it is reclaimed, the run's branch, local or on origin; once the
// branch is gone too, the commit its pull request merged as, or, for a run its main agent landed,
// the last commit its record kept. A run that ended `done`, `failed` or `stopped` on this machine
// and left no checkout, no branch and no pull request changed nothing: its branch went with its
// checkout because the remote already had everything on it, so the pane shows the project as it
// is. Any other run is never judged so: one from another machine may simply not have its branch
// here. Every source is read through git by ref in the project's own repository, never copied, and
// never fetched: the pane polls, and a fetch on a poll is a network call. A run none of them is
// left for is gone, and says so.

/** Where a run's files are read from. */
export type AgentFilesAt =
  | { source: 'checkout'; path: string }
  | { source: 'branch'; branch: string; ref: string }
  | { source: 'merge'; number: number; ref: string }
  /** The run's work was landed and its branch went: the last commit of its work. */
  | { source: 'landed'; ref: string }
  /** The run changed nothing: the project's default branch. */
  | { source: 'unchanged'; ref: string }
  /** The run is starting here, its checkout not made yet: the commit it will be made from. */
  | { source: 'starting'; ref: string }
  /** The run is recorded running elsewhere, or its pull request is still being looked up: a later read knows. */
  | { source: 'pending' }
  | { source: 'gone' }

/** What the pane shows for a run: its files at their last state, and where they were read from. */
export type AgentTree =
  | { source: 'checkout' | 'landed' | 'unchanged' | 'starting'; files: string[] }
  | { source: 'branch'; branch: string; files: string[] }
  | { source: 'merge'; number: number; files: string[] }
  | { source: 'pending' }
  | { source: 'gone' }

/** Ask git, answering `''` for a refusal: every read here is one where "no" is an answer. */
function asker(git: GitRunner, cwd: string): (args: string[]) => Promise<string> {
  return async args => (await git(args, cwd).catch(() => '')).trim()
}

/** The commit `ref` names, when this machine has it. */
async function commitOf(ask: (args: string[]) => Promise<string>, ref: string): Promise<string | undefined> {
  return (await ask(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) || undefined
}

/** The project's default branch: origin's HEAD, else a local `main` or `master`. */
async function defaultBranch(ask: (args: string[]) => Promise<string>): Promise<string | undefined> {
  const head = await ask(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head) return head
  for (const name of ['main', 'master']) if (await commitOf(ask, `refs/heads/${name}`)) return name
  return undefined
}

/**
 * Where the run `agentId` of the project the host reads has its files: its checkout, else its
 * recorded branch (local, then origin's copy), else the commit its recorded pull request merged
 * as, else the commit its record kept when it was landed, else, for a run the host says changed
 * nothing, the default branch, else gone.
 */
export async function resolveAgentFiles(host: Pick<ModuleServerHost, 'root' | 'run' | 'mergeCommit'>, agentId: string, git: GitRunner = nodeGitRunner(), thisHost: string = hostname()): Promise<AgentFilesAt> {
  const root = host.root
  const ask = asker(git, root)
  const run = await host.run(agentId).catch(() => undefined)
  // A checkout listed a moment ago may have been reclaimed since, as the run ended: then it is no
  // source, and the run is not starting either: it just ended, and its record may not say so yet.
  const reclaimed = run?.checkout !== undefined && !existsSync(run.checkout)
  if (run?.checkout && !reclaimed) return { source: 'checkout', path: run.checkout }
  // Nothing known of the run yet: it is starting. A run writes its record, then makes its checkout
  // from origin's default branch, seconds after the page that started it opened: those are its files.
  const record = run?.record
  if (!record) return reclaimed ? { source: 'pending' } : starting(ask, root, git, undefined)
  const branch = record.branch

  if (branch !== undefined) {
    for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
      const tip = await commitOf(ask, ref)
      if (tip) return { source: 'branch', branch, ref: tip }
    }
  }
  if (record.pr && branch !== undefined) {
    const lookup = await host.mergeCommit(branch, record.pr.number).catch((): MergeLookup => ({ pending: false }))
    if (lookup.pending) return { source: 'pending' }
    const ref = lookup.commit ? await commitOf(ask, lookup.commit) : undefined
    if (ref) return { source: 'merge', number: record.pr.number, ref }
  }
  // Landed: its branch went once its work was merged into its main agent's, and its record kept the last commit.
  const landed = record.landed !== undefined ? await commitOf(ask, record.landed) : undefined
  if (landed) return { source: 'landed', ref: landed }
  // Its branch is gone and nothing else holds its work: the one rule for a run that changed nothing.
  if (run.changedNothing) {
    const main = await defaultBranch(ask)
    const ref = main && (await commitOf(ask, main))
    if (ref) return { source: 'unchanged', ref }
  }
  // Recorded running, with no checkout and no branch here yet: still starting, not gone. Here, its
  // checkout is being made from the branch its record names, or origin's default branch; elsewhere,
  // its branch is not here yet.
  if (record.status === 'running') return record.host === thisHost && !reclaimed ? starting(ask, root, git, record.base) : { source: 'pending' }
  return { source: 'gone' }
}

/**
 * A run starting here: the branch its record says it was told to start from, else origin's default
 * branch, which its checkout is made from (the project's HEAD in a repository with no remote);
 * pending when there is none, or when the branch named is not here.
 */
async function starting(ask: (args: string[]) => Promise<string>, root: string, git: GitRunner, base: string | undefined): Promise<AgentFilesAt> {
  const ref = await commitOf(ask, base ?? (await originDefaultBranch(root, git)) ?? 'HEAD')
  return ref ? { source: 'starting', ref } : { source: 'pending' }
}

/** Every path in a commit's tree. */
async function treeAt(git: GitRunner, cwd: string, ref: string): Promise<string[]> {
  const out = await git(['ls-tree', '-r', '--name-only', '-z', ref], cwd).catch(() => '')
  return out.split('\0').filter(Boolean)
}

/**
 * The Files pane's answer for a resolved source: every file git sees in a checkout, or the tree of
 * the commit a branch, a merge, a landed run, an unchanged or a starting one is read at.
 */
export async function readAgentTree(root: string, at: AgentFilesAt, git: GitRunner = nodeGitRunner()): Promise<AgentTree> {
  if (at.source === 'pending' || at.source === 'gone') return at
  if (at.source === 'checkout') return { source: 'checkout', files: await listFiles(at.path, git) }
  const files = await treeAt(git, root, at.ref)
  if (at.source === 'branch') return { source: 'branch', branch: at.branch, files }
  return at.source === 'merge' ? { source: 'merge', number: at.number, files } : { source: at.source, files }
}

/** One file's contents, from the same source the tree was read from. */
export async function readAgentFileContent(root: string, at: AgentFilesAt, path: string, git: GitRunner = nodeGitRunner()): Promise<FileContent | null> {
  if (at.source === 'pending' || at.source === 'gone') return null
  if (at.source === 'checkout') return readFileContent(at.path, path)
  if (!safeRepoPath(path)) return null
  const raw = await git(['show', `${at.ref}:${path}`], root).catch(() => undefined)
  if (raw === undefined) return null
  if (raw.includes('\0')) return { path, text: '', truncated: false, binary: true }
  const { body, truncated } = cutToPreview(raw.replace(/\n$/, ''))
  return { path, text: body, truncated, binary: false }
}
