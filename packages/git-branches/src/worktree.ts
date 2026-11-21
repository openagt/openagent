import { execFile } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { readdir, realpath, stat } from 'node:fs/promises'
import { nodeGitRunner, checkoutRoot, gitReason, originDefaultBranch, type GitRunner, BRANCHES_DIR } from '@openagt/agent-data'
import { isSafeAgentId, isAgentBranch, agentBranchName, agentIdFromWorktreeDir } from './branch-names.js'
import { publishedBranch } from '@openagt/agent-data/names'

/**
 * Git-worktree lifecycle for concurrent agents (#453/#735): give each agent its own
 * checkout so N agents on one repo never fight over the working tree. Pure plumbing
 * over the {@link GitRunner} seam: this module only knows how to add, list, remove,
 * and prune worktrees, and to read what a retention decision needs.
 */

/** The path an agent's worktree gets (#1580): `<repo>/.branches/<agent branch>`. */
export function worktreePath(repo: string, agentId: string): string {
  return join(repo, BRANCHES_DIR, agentBranchName(agentId))
}

/** One checkout on disk: where it is, and whose it is. */
export interface WorktreeDirEntry {
  path: string
  agentId: string
}

/**
 * Lists the names of the *directories* under `path` — a symlink is not one, whatever it points
 * to. A missing or unreadable directory yields `[]`.
 */
export type DirReader = (path: string) => Promise<string[]>

async function nodeReaddir(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
}

/**
 * Every checkout directory on disk (#1580): a directory under `.branches/` named as an agent
 * branch. Only directories count — the same place holds the rename links (#1589), symlinks named
 * as agent branches too, which are views, not checkouts. Forgiving: a missing root yields nothing.
 */
export async function worktreeDirEntries(repo: string, readdir: DirReader = nodeReaddir): Promise<WorktreeDirEntry[]> {
  const root = join(repo, BRANCHES_DIR)
  const entries: WorktreeDirEntry[] = []
  for (const name of await readdir(root).catch((): string[] => [])) {
    const agentId = agentIdFromWorktreeDir(name)
    if (isAgentBranch(name) && isSafeAgentId(agentId)) entries.push({ path: join(root, name), agentId })
  }
  return entries
}

/** One entry parsed from `git worktree list --porcelain`. */
export interface WorktreeInfo {
  /** Absolute worktree path (the main checkout included). */
  path: string
  /** The checked-out commit. */
  head: string
  /** The checked-out branch (short name), or absent when detached. */
  branch?: string
}

/** Inputs to {@link addWorktree}. The caller owns branch naming (#736). */
export interface AddWorktreeOptions {
  agentId: string
  /** The branch to create for the agent. */
  branch: string
  /** Base ref to branch from; defaults to origin's default branch ({@link freshStart}). A `publishedBase` is fetched first ({@link fetchedBase}). */
  base?: string
  /** Paths from the checkout's root that stay out of it ({@link leaveOut}), asked of the checkout once it is there: what it holds is what the answer is about. */
  without?: LeaveOut
}

/** What a checkout leaves out, asked of it once it is there: paths from its root. */
export type LeaveOut = (checkout: string) => Promise<readonly string[]>

/** The worktree {@link addWorktree} created. */
export interface AddedWorktree {
  path: string
  branch: string
  /** The branch was gone everywhere and was made again, from the base or origin's default branch: nothing it held before is on it. */
  again?: true
}

/** How long a new agent branch waits for origin's default branch to be fetched: Claude Code's own cap. */
export const FRESH_START_FETCH_MS = 5_000

/**
 * Where a new agent branch starts: origin's default branch, fetched first so it is current. Never
 * the project's HEAD: that is whatever the user has checked out, unpushed work included, and a
 * branch started there publishes that work when the agent's branch is pushed. The fetch is waited
 * for {@link FRESH_START_FETCH_MS} at most, and one that fails (offline) or runs longer leaves the
 * copy this clone already has; a fetch still running finishes on its own. A repository with no
 * remote has no such branch: undefined, and git starts from HEAD, the only commit there is.
 */
async function freshStart(repo: string, git: GitRunner): Promise<string | undefined> {
  const start = await originDefaultBranch(repo, git)
  if (!start) return undefined
  const fetched = git(['fetch', '--quiet', '--no-write-fetch-head', 'origin', start.slice('origin/'.length)], repo).catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = new Promise<void>(resolve => {
    timer = setTimeout(resolve, FRESH_START_FETCH_MS)
    timer.unref()
  })
  await Promise.race([fetched, capped])
  clearTimeout(timer)
  return start
}

/**
 * A base the caller named. One that names origin's copy of a branch is fetched first, whatever
 * this clone holds of it, by its full names, so a clone that follows only some of origin's
 * branches gets it too. Unlike {@link freshStart} a fetch that fails rejects: the person picked this
 * branch, and a copy from whenever this clone last saw it, or one gone from origin, is not it.
 */
async function fetchedBase(repo: string, base: string, git: GitRunner): Promise<string> {
  const branch = publishedBranch(base)
  if (branch === undefined) return base
  await git(['fetch', '--quiet', '--no-write-fetch-head', 'origin', `+refs/heads/${branch}:${base}`], repo).catch((err: unknown) => {
    throw new Error(`the branch ${branch} could not be fetched from origin: ${gitReason(err)}`)
  })
  return base
}

/**
 * Create a worktree for an agent on a fresh branch: `git worktree add --no-track -b <branch>
 * <path> <base>`, the base origin's default branch unless the caller names one. No upstream:
 * tracking writes the repository's shared `.git/config`, whose lock a running agent's own git
 * command in another checkout may hold. Git makes the leaf dir (and any missing parents) itself. The
 * `agentId` is validated as path-safe first so a caller can never traverse out of
 * `.branches/`. Rejects on any git failure (a caller that wants a
 * run needs its checkout, so failure must surface, not be swallowed).
 */
export async function addWorktree(
  repo: string,
  opts: AddWorktreeOptions,
  git: GitRunner = nodeGitRunner(),
): Promise<AddedWorktree> {
  if (!isSafeAgentId(opts.agentId)) throw new Error(`unsafe agent id: ${opts.agentId}`)
  const path = worktreePath(repo, opts.agentId)
  const base = opts.base !== undefined ? await fetchedBase(repo, opts.base, git) : await freshStart(repo, git)
  await git(['worktree', 'add', '--no-track', '-b', opts.branch, path, ...(base ? [base] : [])], repo)
  await leaveOut(path, opts.without, git)
  return { path, branch: opts.branch }
}

/**
 * Leave what `without` answers out of the checkout at `path`: git's sparse checkout, with
 * everything else in, so the files are not on disk there while the index keeps them, and nothing
 * is committed about it. A checkout's own setting: the project's other checkouts have all their
 * files. Nothing asked, or none answered, leaves the checkout as it is: a full one stays full.
 */
export async function leaveOut(path: string, without: LeaveOut | undefined, git: GitRunner = nodeGitRunner()): Promise<void> {
  const paths = without ? await without(path) : []
  if (paths.length === 0) return
  await git(['sparse-checkout', 'set', '--no-cone', '/*', ...paths.map(entry => `!/${entry.replace(/^\/+/, '')}`)], path)
}

/**
 * Check an *existing* branch out into an agent's worktree (#762). Continuing an agent puts it back
 * on the branch its work is already on, rather than branching again and stranding what it did
 * last time. The branch as this clone has it; else origin's copy, as a new local branch with no
 * upstream set, as in {@link addWorktree}; else, gone everywhere, a new branch where the agent's
 * first one started: the base the caller names, as this clone has it or else as origin does, and
 * with none, or one that is gone too, where a new agent branch starts ({@link freshStart}); the
 * answer then says the branch was made again. Every
 * branch the package deletes held no commit of its own, so nothing of the agent's is lost.
 * Anything git refuses — the branch checked out elsewhere, say —
 * rejects, like {@link addWorktree}: a continued agent needs its checkout.
 */
export async function attachWorktree(
  repo: string,
  opts: { agentId: string; branch: string; base?: string; without?: LeaveOut },
  git: GitRunner = nodeGitRunner(),
): Promise<AddedWorktree> {
  if (!isSafeAgentId(opts.agentId)) throw new Error(`unsafe agent id: ${opts.agentId}`)
  const path = worktreePath(repo, opts.agentId)
  const has = (ref: string) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo).then(out => out.trim() !== '', () => false)
  if (await has(`refs/heads/${opts.branch}`)) {
    await git(['worktree', 'add', path, opts.branch], repo)
    await leaveOut(path, opts.without, git)
    return { path, branch: opts.branch }
  }
  const theirs = `refs/remotes/origin/${opts.branch}`
  const starts = [theirs, ...(opts.base !== undefined ? [opts.base, `refs/remotes/origin/${opts.base}`] : [])]
  let start: string | undefined
  for (const ref of starts) if (start === undefined && (await has(ref))) start = ref
  const again = start !== theirs
  start ??= await freshStart(repo, git)
  await git(['worktree', 'add', '--no-track', '-b', opts.branch, path, ...(start ? [start] : [])], repo)
  await leaveOut(path, opts.without, git)
  return { path, branch: opts.branch, ...(again ? { again: true } : {}) }
}

/**
 * Every worktree registered for the repo (the main checkout included). Forgiving:
 * a non-repo / git failure yields `[]` so a reconcile scan never throws.
 */
export async function listWorktrees(repo: string, git: GitRunner = nodeGitRunner()): Promise<WorktreeInfo[]> {
  try {
    return parseWorktreeList(await git(['worktree', 'list', '--porcelain'], repo))
  } catch {
    return []
  }
}

/**
 * Parse `git worktree list --porcelain`: blank-line-separated records, each with
 * a `worktree <path>` line, a `HEAD <sha>` line, and either `branch refs/heads/...`
 * or `detached`. Extra attributes (bare/locked/prunable) are ignored. Exported so
 * the parsing is unit-testable without a real repo.
 */
export function parseWorktreeList(porcelain: string): WorktreeInfo[] {
  const entries: WorktreeInfo[] = []
  for (const block of porcelain.split(/\n\s*\n/)) {
    let path: string | undefined
    let head = ''
    let branch: string | undefined
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim()
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim()
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    }
    if (path) entries.push({ path, head, ...(branch ? { branch } : {}) })
  }
  return entries
}

/**
 * The checkouts under `.branches/`, by the branch each is on: one `git worktree list`. The
 * project's own folder is not one of them, whatever it has out. Forgiving, like
 * {@link listWorktrees}: a git that cannot answer reads as no checkout.
 */
export async function checkoutsByBranch(repo: string, git: GitRunner = nodeGitRunner()): Promise<Map<string, string>> {
  const checkouts = new Map<string, string>()
  for (const { path, branch } of await listWorktrees(repo, git)) {
    if (branch && basename(dirname(path)) === BRANCHES_DIR && !checkouts.has(branch)) checkouts.set(branch, path)
  }
  return checkouts
}

/**
 * Remove an agent's worktree. Tolerant of an already-gone / never-registered path so
 * teardown stays idempotent (a caller may run it twice).
 *
 * Plain removal first: it refuses a checkout git considers unclean, which after the
 * caller's {@link worktreeClean} check means a state we did not anticipate. Falling back to
 * `--force` keeps teardown working (an ignored build artifact must not strand a
 * worktree forever), but it says so, because forcing past unknown state is exactly
 * how uncommitted work got deleted in the first place.
 */
export async function removeWorktree(repo: string, path: string, git: GitRunner = nodeGitRunner()): Promise<void> {
  try {
    await git(['worktree', 'remove', path], repo)
    return
  } catch {
    // Unclean by git's reckoning, already removed, or never registered: try forcing.
  }
  try {
    await git(['worktree', 'remove', '--force', path], repo)
    // stderr: on a CLI run stdout carries the JSON result, and this line would corrupt it.
    console.error(`[branches] forced removal of worktree ${path} (git called it unclean)`)
  } catch (err) {
    // Already removed, or never registered: nothing to do. A checkout still on disk is another
    // matter (#1757): a caller told "removed" while it stands would drop its branch next.
    if (await stat(path).then(() => true, () => false)) throw err
  }
}

/**
 * Delete a branch that holds nothing (#1650). `-D`, because "merged" in git's eyes is the wrong
 * test: the caller proved the branch holds no commit of its own, which is the fact that counts.
 * Forgiving: the checkout is already gone by the time this runs, and a branch that would not
 * delete is a leftover name, not lost work. Says whether it went, so a caller names only the
 * branches that are actually gone (#1757).
 */
export async function deleteBranch(repo: string, branch: string, git: GitRunner = nodeGitRunner()): Promise<boolean> {
  return git(['branch', '-D', branch], repo).then(
    () => true,
    () => false,
  )
}

/**
 * Whether `path` is the root of a git worktree — the main checkout's or a linked one (#1654).
 *
 * Git answers for any directory *inside* a repository, so a `.branches/<agent>` directory that is
 * no longer a worktree (a checkout removed by hand, a marker written after teardown) makes every
 * git command run in it act on the enclosing repo: the user's own checkout, on the user's own
 * branch. The one question that tells the two apart is whether git's top level is this very
 * directory. False on any failure, and the caller leaves the directory alone.
 */
export async function isWorktreeRoot(path: string, git: GitRunner = nodeGitRunner()): Promise<boolean> {
  try {
    const top = (await git(['rev-parse', '--show-toplevel'], path)).trim()
    if (!top) return false
    // Both sides resolved: macOS's tmpdir sits behind the /var -> /private/var link, and git
    // reports the resolved path.
    return (await realpath(top)) === (await realpath(path))
  } catch {
    return false
  }
}

/**
 * The branch checked out at `path` when `path` is a worktree root (#1654), else `undefined` —
 * the read every consumer of a `.branches/<agent>` directory wants, so none of them can take the
 * enclosing repo's branch for the run's.
 */
export async function worktreeBranch(path: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  return (await isWorktreeRoot(path, git)) ? currentBranch(path, git) : undefined
}

/**
 * The agent's checkout under `.branches/` that is on `branch`, when one still is: a command that
 * acts on a branch by name holds it to that checkout's rules.
 */
export async function checkoutOn(repo: string, branch: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  for (const entry of await worktreeDirEntries(repo)) if ((await worktreeBranch(entry.path, git)) === branch) return entry.path
  return undefined
}

/**
 * The branch checked out at `path`, or `undefined` when detached / not a repo.
 * Forgiving, like {@link listWorktrees}: callers use it to decide, not to fail.
 */
export async function currentBranch(path: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  try {
    const name = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).trim()
    return name && name !== 'HEAD' ? name : undefined
  } catch {
    return undefined
  }
}

/**
 * The project a directory belongs to (#1725): the checkout whose `.branches/` holds the agent
 * checkouts. From inside an agent's checkout that is two levels up, by the layout every checkout
 * is created with; from anywhere else it is the checkout itself. Read from the layout rather than
 * from git's common dir, so a project that is itself a linked worktree, or a submodule, answers
 * with the directory the caller registered. Rejects outside a repo.
 */
export async function projectRoot(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  const checkout = await checkoutRoot(cwd, git)
  const parent = dirname(checkout)
  return basename(parent) === BRANCHES_DIR ? dirname(parent) : checkout
}

/**
 * `git worktree prune`: drop administrative entries for worktree dirs a crash left
 * behind. Never removes a live worktree, so it is always safe. Forgiving.
 */
export async function pruneWorktrees(repo: string, git: GitRunner = nodeGitRunner()): Promise<void> {
  try {
    await git(['worktree', 'prune'], repo)
  } catch {
    // Not a repo / nothing to prune: no-op.
  }
}

/** Runs `du`, resolving its stdout. Injectable so the size read can be tested without a real tree. */
export type SizeRunner = (path: string) => Promise<string>

/** A {@link SizeRunner} over `du -sk`: one process, and it does not follow the symlinked deps (#736). */
export function nodeSizeRunner(): SizeRunner {
  return path =>
    new Promise((resolvePromise, rejectPromise) => {
      execFile('du', ['-sk', path], { timeout: 5_000 }, (err, stdout) => (err ? rejectPromise(err) : resolvePromise(stdout)))
    })
}

/**
 * A worktree's size on disk in bytes, or undefined when it cannot be read (#798). Best-effort by
 * design: this only ever labels a "remove this" button, so a missing number costs nothing while a
 * throw or a hang would cost the listing it sits in. `du` is absent on Windows, which reads as
 * unknown like any other failure.
 */
export async function worktreeSize(path: string, size: SizeRunner = nodeSizeRunner()): Promise<number | undefined> {
  try {
    const kb = Number.parseInt((await size(path)).trim().split(/\s+/)[0] ?? '', 10)
    return Number.isFinite(kb) ? kb * 1024 : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a branch is on the remote, with the local tip already there.
 *
 * What a caller asks to say whether a branch's work is published yet.
 *
 * `git rev-parse` of the remote-tracking ref, then a merge-base check: the ref existing is not
 * enough, because a branch pushed and then committed to again has a tip the remote has never seen.
 * Reads only local refs (no fetch), so it is cheap enough to ask on every poll — the remote ref
 * is written by the push this is checking for, which is what makes that sound.
 *
 * Anything unreadable answers `false`, and so does a repo with no remote configured.
 */
export async function branchPushed(
  repo: string,
  branch: string,
  git: GitRunner = nodeGitRunner(),
): Promise<boolean> {
  try {
    const local = (await git(['rev-parse', '--verify', `refs/heads/${branch}`], repo)).trim()
    const remote = (await git(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], repo)).trim()
    if (!local || !remote) return false
    if (local === remote) return true
    // The remote may be ahead (someone pushed on top): what matters is that our tip is in it.
    await git(['merge-base', '--is-ancestor', local, remote], repo)
    return true
  } catch {
    return false
  }
}

/**
 * Whether the checkout has nothing uncommitted. A read, never a commit (#1638): the package
 * commits nothing on an agent's behalf, so a checkout holding uncommitted work is one the caller
 * keeps. Throws when git cannot answer, so the caller keeps the checkout rather than guessing.
 */
export async function worktreeClean(path: string, git: GitRunner = nodeGitRunner()): Promise<boolean> {
  return !(await git(['status', '--porcelain'], path)).trim()
}

/**
 * Whether the repo has any remote configured at all: with none there is nowhere to publish a
 * branch to, and a caller offers no push. Anything unreadable answers `false`, like
 * {@link branchPushed}.
 */
export async function repoHasRemote(repo: string, git: GitRunner = nodeGitRunner()): Promise<boolean> {
  try {
    return (await git(['remote'], repo)).trim().length > 0
  } catch {
    return false
  }
}
