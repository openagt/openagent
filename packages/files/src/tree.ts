import { existsSync } from 'node:fs'
import { hostname } from 'node:os'
import { nodeGitRunner, originDefaultBranch, type GitRunner } from '@openagt/agent-data'
import type { MergeLookup, ModuleServerHost } from '@openagt/dashboard/module-server'
import { listFiles } from './list.js'
import { readFileStatuses, type FileGitStatus } from './status.js'
import { readFileDiff, type FileDiff } from './diff.js'
import { cutToPreview, readFileContent, safeRepoPath, type FileContent } from './read.js'

// A run's files, for the agent page's Files pane, for as long as git still has them. The run's
// checkout while it exists; once it is reclaimed, the run's branch, local or on origin; once the
// branch is gone too, the commit its pull request merged as, or, for a run its main agent landed,
// the last commit its record kept. A run's record says the commit its own work begins at. A run
// started from a branch other than the default one (a subagent starts from its main agent's) is
// measured from it: measured from the default branch, the other branch's work would read as its
// own. So is a run whose work the default branch already contains: measured from that branch,
// nothing would be left of it.
// A run that ended `done`, `failed`
// or `stopped` on this machine and left no checkout, no branch and no pull request changed nothing:
// its branch went with its checkout because the remote already had everything on it, so the pane
// shows the project as it is, nothing marked. Any other run is never judged so: one from another
// machine may simply not have its branch here. Every source is read through git by ref in the
// project's own repository, never copied, and never fetched: the pane polls, and a fetch on a poll
// is a network call. A run none of them is left for is gone, and says so.

/**
 * Where a run's files are read from, the commit its changes are measured from (`base`), and
 * whether its committed work is merged: the default branch already has it, or its pull request
 * merged it. A merge commit and a landed commit are merged by what they are.
 */
export type AgentFilesAt =
  | { source: 'checkout'; path: string; base?: string; merged: boolean }
  | { source: 'branch'; branch: string; ref: string; base?: string; merged: boolean }
  | { source: 'merge'; number: number; ref: string; base?: string }
  /** The run's work was landed and its branch went: the last commit of its work. */
  | { source: 'landed'; ref: string; base?: string }
  /** The run changed nothing: the project's default branch, where no path is marked. */
  | { source: 'unchanged'; ref: string }
  /** The run is starting here, its checkout not made yet: the commit it will be made from, where no path is marked. */
  | { source: 'starting'; ref: string }
  /** The run is recorded running elsewhere, or its pull request is still being looked up: a later read knows. */
  | { source: 'pending' }
  | { source: 'gone' }

/** One changed path: what changed, and whether it is committed or only on disk in the checkout. */
export interface FileMark {
  status: FileGitStatus
  committed: boolean
}

/**
 * What the module shows for a run: the tree at its last state and the paths it changed. `merged`
 * says the run changed something and all of it is merged, nothing left uncommitted: the Files pane
 * then marks nothing, since its marks say what is not merged yet, and the Changes pane still lists
 * the changes. The tree of merged work holds no deleted path.
 */
export type AgentTree =
  | { source: 'checkout'; files: string[]; changes: Record<string, FileMark>; merged: boolean }
  | { source: 'branch'; branch: string; files: string[]; changes: Record<string, FileMark>; merged: boolean }
  | { source: 'merge'; number: number; files: string[]; changes: Record<string, FileMark>; merged: boolean }
  | { source: 'landed'; files: string[]; changes: Record<string, FileMark>; merged: boolean }
  | { source: 'unchanged'; files: string[]; changes: Record<string, FileMark> }
  | { source: 'starting'; files: string[]; changes: Record<string, FileMark> }
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
 * What the run's changes are measured from: where `tip` left the default branch, or where it left
 * `from`, the commit the run's record says its own work begins at, when it names one this machine
 * has. The default branch's answer stands while the run left it at or after that commit and its
 * work is not in it yet: what the run took in from the default branch since is then not marked
 * as its own. The record's commit answers otherwise: for work the default branch already
 * contains, where nothing would be left to mark, and for a run that left the default branch
 * before that commit, which is one started from another branch.
 */
async function forkPoint(ask: (args: string[]) => Promise<string>, tip: string, from: string | undefined): Promise<string | undefined> {
  const main = await defaultBranch(ask)
  const start = from !== undefined ? await commitOf(ask, from) : undefined
  const fromMain = main ? (await ask(['merge-base', main, tip])) || undefined : undefined
  if (!start) return fromMain
  const fromStart = (await ask(['merge-base', start, tip])) || undefined
  if (!fromMain || !fromStart) return fromStart ?? fromMain
  if (fromMain === (await commitOf(ask, tip))) return fromStart
  return (await ask(['merge-base', fromStart, fromMain])) === fromStart ? fromMain : fromStart
}

/** Whether the default branch already has `tip`: everything on it is merged. */
async function inDefaultBranch(ask: (args: string[]) => Promise<string>, tip: string): Promise<boolean> {
  const main = await defaultBranch(ask)
  const commit = await commitOf(ask, tip)
  return Boolean(main && commit && (await ask(['merge-base', main, commit])) === commit)
}

/**
 * Where the run `agentId` of the project the host reads has its files: its checkout, else its
 * recorded branch (local, then origin's copy), else the commit its recorded pull request merged
 * as, else the commit its record kept when it was landed, else, for a run the host says changed
 * nothing, the default branch, else gone. A branch the
 * default branch already contains (a true merge) shows no change when the run's record names no
 * start, so there the merge commit is preferred when this machine has it.
 *
 * A checkout and a branch also say whether their committed work is merged: the default branch
 * has their last commit, or, for a branch, its pull request merged at that very commit (a squash
 * leaves the branch outside the default branch; a commit made after the merge is not merged).
 */
export async function resolveAgentFiles(host: Pick<ModuleServerHost, 'root' | 'run' | 'mergeCommit'>, agentId: string, git: GitRunner = nodeGitRunner(), thisHost: string = hostname()): Promise<AgentFilesAt> {
  const root = host.root
  const ask = asker(git, root)
  const run = await host.run(agentId).catch(() => undefined)
  // A checkout listed a moment ago may have been reclaimed since, as the run ended: then it is no
  // source, and the run is not starting either: it just ended, and its record may not say so yet.
  const reclaimed = run?.checkout !== undefined && !existsSync(run.checkout)
  if (run?.checkout && !reclaimed) {
    const inCheckout = asker(git, run.checkout)
    const base = await forkPoint(inCheckout, 'HEAD', run.record?.baseCommit)
    return { source: 'checkout', path: run.checkout, ...(base ? { base } : {}), merged: await inDefaultBranch(inCheckout, 'HEAD') }
  }
  // Nothing known of the run yet: it is starting. A run writes its record, then makes its checkout
  // from origin's default branch, seconds after the page that started it opened: those are its files.
  const record = run?.record
  if (!record) return reclaimed ? { source: 'pending' } : starting(ask, root, git, undefined)
  const branch = record.branch

  const lookup: MergeLookup | undefined = record.pr && branch !== undefined ? await host.mergeCommit(branch, record.pr.number).catch((): MergeLookup => ({ pending: false })) : undefined
  let onBranch: AgentFilesAt | undefined
  if (branch !== undefined) {
    for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
      const tip = await commitOf(ask, ref)
      if (!tip) continue
      const base = await forkPoint(ask, tip, record.baseCommit)
      const merged = (await inDefaultBranch(ask, tip)) || (lookup !== undefined && !lookup.pending && lookup.commit !== undefined && lookup.head === tip)
      onBranch = { source: 'branch', branch, ref: tip, ...(base ? { base } : {}), merged }
      if (base !== tip) return onBranch
      break
    }
  }

  if (record.pr && lookup) {
    const number = record.pr.number
    if (lookup.pending && !onBranch) return { source: 'pending' }
    const ref = !lookup.pending && lookup.commit ? await commitOf(ask, lookup.commit) : undefined
    if (ref) {
      const base = await commitOf(ask, `${ref}^1`)
      return { source: 'merge', number, ref, ...(base ? { base } : {}) }
    }
  }
  if (onBranch) return onBranch
  // Landed: its branch went once its work was merged into its main agent's, and its record kept the last commit.
  const landed = record.landed !== undefined ? await commitOf(ask, record.landed) : undefined
  if (landed) {
    const base = await forkPoint(ask, landed, record.baseCommit)
    return { source: 'landed', ref: landed, ...(base ? { base } : {}) }
  }
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

/** `git diff --name-status` between two commits, as marks; a rename reads as a deletion and an addition. */
async function committedChanges(git: GitRunner, cwd: string, from: string, to: string): Promise<Record<string, FileMark>> {
  const out = await git(['diff', '--name-status', '--no-renames', '-z', from, to], cwd).catch(() => '')
  const parts = out.split('\0')
  const changes: Record<string, FileMark> = {}
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i]!
    const path = parts[i + 1]!
    if (!code || !path) continue
    changes[path] = { status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified', committed: true }
  }
  return changes
}

/** Every path in a commit's tree. */
async function treeAt(git: GitRunner, cwd: string, ref: string): Promise<string[]> {
  const out = await git(['ls-tree', '-r', '--name-only', '-z', ref], cwd).catch(() => '')
  return out.split('\0').filter(Boolean)
}

/** The tree plus the paths a change deleted, which the tree no longer holds but the pane still shows. */
function withDeleted(files: string[], changes: Record<string, FileMark>): string[] {
  const all = new Set(files)
  for (const [path, mark] of Object.entries(changes)) if (mark.status === 'deleted') all.add(path)
  return [...all].sort()
}

/**
 * The Files pane's answer for a resolved source. A checkout lists every file git sees in it and
 * marks both what the run committed since it forked and what is on disk uncommitted, the
 * uncommitted mark winning a path marked both: it is what the file is now. A branch, a merge or a
 * landed commit lists the commit's tree and marks what it changed, all committed. A run that changed nothing
 * lists the default branch's tree and marks nothing.
 */
export async function readAgentTree(root: string, at: AgentFilesAt, git: GitRunner = nodeGitRunner()): Promise<AgentTree> {
  if (at.source === 'pending' || at.source === 'gone') return at
  if (at.source === 'checkout') {
    const [files, committed, pending] = await Promise.all([
      listFiles(at.path, git),
      at.base ? committedChanges(git, at.path, at.base, 'HEAD') : ({} as Record<string, FileMark>),
      readFileStatuses(at.path, git),
    ])
    const changes: Record<string, FileMark> = { ...committed }
    for (const [path, status] of Object.entries(pending)) changes[path] = { status, committed: false }
    // Merged only with nothing left on disk: uncommitted work is not in the default branch.
    const merged = at.merged && Object.keys(committed).length > 0 && Object.keys(pending).length === 0
    return { source: 'checkout', files: merged ? files : withDeleted(files, changes), changes, merged }
  }
  if (at.source === 'unchanged' || at.source === 'starting') return { source: at.source, files: await treeAt(git, root, at.ref), changes: {} }
  const [files, changes] = await Promise.all([treeAt(git, root, at.ref), at.base ? committedChanges(git, root, at.base, at.ref) : ({} as Record<string, FileMark>)])
  // A run that changed nothing has nothing merged: it reads as any tree with no mark.
  const merged = (at.source === 'branch' ? at.merged : true) && Object.keys(changes).length > 0
  const tree = { files: merged ? files : withDeleted(files, changes), changes, merged }
  if (at.source === 'landed') return { source: 'landed', ...tree }
  return at.source === 'branch' ? { source: 'branch', branch: at.branch, ...tree } : { source: 'merge', number: at.number, ...tree }
}

/**
 * One changed file's diff, from the same source the tree was read from. In a checkout an
 * uncommitted file diffs as it always has (against its last commit); a committed one diffs from
 * the fork point to the checkout's last commit. On a branch, a merge or a landed commit it is the
 * commit's own change. Null for a path that is unsafe or not changed there.
 */
export async function readAgentFileDiff(root: string, at: AgentFilesAt, path: string, git: GitRunner = nodeGitRunner()): Promise<FileDiff | null> {
  if (at.source === 'pending' || at.source === 'gone' || at.source === 'unchanged' || at.source === 'starting' || !safeRepoPath(path)) return null
  if (at.source === 'checkout') {
    const pending = (await readFileStatuses(at.path, git))[path]
    if (pending) return readFileDiff(at.path, path, pending, git)
    if (!at.base) return null
    const mark = (await committedChanges(git, at.path, at.base, 'HEAD'))[path]
    return mark ? readFileDiff(at.path, path, mark.status, git, { from: at.base, to: 'HEAD' }) : null
  }
  if (!at.base) return null
  const mark = (await committedChanges(git, root, at.base, at.ref))[path]
  return mark ? readFileDiff(root, path, mark.status, git, { from: at.base, to: at.ref }) : null
}

/** One unchanged file's contents, from the same source the tree was read from. */
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

/** One commit of a run's work. */
export interface AgentCommit {
  sha: string
  /** Short sha, for display. */
  short: string
  subject: string
  author: string
  /** When it was committed, ISO 8601. */
  date: string
}

/** The most commits a run's list holds: the newest ones. */
const MAX_COMMITS = 200

/** A tree with no file in it, as git names it: what a commit with no parent is measured from. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * Where a source's commits are read: the repository, the commit its changes are measured from and
 * its last commit. None for a source with nothing measured: a run that changed nothing, one
 * starting, pending or gone, and one whose start is not known.
 */
function spanOf(root: string, at: AgentFilesAt): { cwd: string; from: string; to: string } | undefined {
  if (at.source === 'checkout') return at.base ? { cwd: at.path, from: at.base, to: 'HEAD' } : undefined
  if (at.source === 'branch' || at.source === 'merge' || at.source === 'landed') return at.base ? { cwd: root, from: at.base, to: at.ref } : undefined
  return undefined
}

/**
 * The commits of a run's work, newest first, from the same source its tree is read from: the ones
 * between the commit its changes are measured from and its last commit. Uncommitted work is in no
 * commit, so a checkout's list may be shorter than what its tree marks.
 */
export async function readAgentCommits(root: string, at: AgentFilesAt, git: GitRunner = nodeGitRunner()): Promise<AgentCommit[]> {
  const span = spanOf(root, at)
  if (!span) return []
  const out = await git(['log', `--max-count=${MAX_COMMITS}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cI', `${span.from}..${span.to}`], span.cwd).catch(() => '')
  const commits: AgentCommit[] = []
  for (const line of out.split('\n')) {
    const [sha, short, subject, author, date] = line.split('\x1f')
    if (sha && short && subject !== undefined && author !== undefined && date) commits.push({ sha, short, subject, author, date })
  }
  return commits
}

/**
 * One commit of the run's work as a range, or undefined for a commit that is not one of them: a
 * read names a commit by the id the list gave, and no other commit of the repository is shown.
 */
async function commitRange(root: string, at: AgentFilesAt, sha: string, git: GitRunner): Promise<{ cwd: string; from: string; to: string } | undefined> {
  const span = spanOf(root, at)
  if (!span || !/^[0-9a-f]{40}$/.test(sha)) return undefined
  const ask = asker(git, span.cwd)
  if (!(await ask(['rev-list', `${span.from}..${span.to}`])).split('\n').includes(sha)) return undefined
  return { cwd: span.cwd, from: (await commitOf(ask, `${sha}^`)) ?? EMPTY_TREE, to: sha }
}

/** What one commit of the run's work changed, against the commit before it; null for a commit that is not the run's. */
export async function readAgentCommitChanges(root: string, at: AgentFilesAt, sha: string, git: GitRunner = nodeGitRunner()): Promise<Record<string, FileMark> | null> {
  const range = await commitRange(root, at, sha, git)
  return range ? committedChanges(git, range.cwd, range.from, range.to) : null
}

/** One file's diff in one commit of the run's work; null for a commit that is not the run's, or a path it did not change. */
export async function readAgentCommitFileDiff(root: string, at: AgentFilesAt, sha: string, path: string, git: GitRunner = nodeGitRunner()): Promise<FileDiff | null> {
  if (!safeRepoPath(path)) return null
  const range = await commitRange(root, at, sha, git)
  if (!range) return null
  const mark = (await committedChanges(git, range.cwd, range.from, range.to))[path]
  return mark ? readFileDiff(range.cwd, path, mark.status, git, { from: range.from, to: range.to }) : null
}
