import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BRANCHES_DIR } from './names.js'
import { EMPTY_TREE, errorMessage, nodeGitRunner, type GitRunner } from './git.js'
import { accountGit } from './remote-account.js'
import { excludeFromGit, unexcludeOnceGone } from './git-exclude.js'
import { withCheckoutLock, type CheckoutLockDeps } from './checkout-lock.js'

// A branch used as a file store: a branch of the project's repository that holds files nobody
// edits in a working tree — the way `gh-pages` holds a site — read and written by programs, and
// safe to push and pull eagerly because nothing on it is anyone's checkout. The caller names the
// branch; this module knows git, not what the files mean.
//
// Two writers, one rule. A long-lived process (a daemon, a scheduler, a run) keeps a persistent
// checkout of the branch under `.branches/<branch>` and writes through {@link withFileBranch}: one
// cycle at a time per branch, across every process on the clone — sync, apply, commit, push. A one-shot writer in any clone (a command an
// agent runs) writes through {@link writeFileBranchDetached}: a throwaway worktree on origin's
// tip, the same apply-commit-push, gone afterwards — it never touches the persistent checkout,
// which is another process's. Both treat the change as an intent: when the push loses a race,
// the cycle re-syncs and re-applies rather than force-fitting a stale commit.

/**
 * The persistent checkout of `branch` for the repository `cwd` is in: `<home>/.branches/<branch>`,
 * `<home>` being the clone's own directory ({@link fileBranchRepo}). git checks a branch out in
 * one place per clone, so every worktree of the clone shares this one checkout.
 */
export async function fileBranchPath(cwd: string, branch: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  return checkoutPath(await cloneHome(cwd, git), branch)
}

function checkoutPath(home: string, branch: string): string {
  return join(home, BRANCHES_DIR, branch)
}

/**
 * The clone's own directory, or `cwd` itself when git cannot say (not a repo). Asked of git once
 * per `cwd`: every call from one `cwd` waits on the same answer and goes on in the order it was
 * made, so writes join the one-at-a-time order in the order they were requested. An answer that
 * fell back to `cwd` is not kept, since the directory may become a repository later.
 */
const homes = new Map<string, Promise<string>>()

function cloneHome(cwd: string, git: GitRunner): Promise<string> {
  let home = homes.get(cwd)
  if (!home) {
    home = fileBranchRepo(cwd, git).then(found => {
      if (found === undefined) homes.delete(cwd)
      return found ?? cwd
    })
    homes.set(cwd, home)
  }
  return home
}

/** Injectable seams; production takes the defaults. */
export interface FileBranchDeps {
  git?: GitRunner
  log?: (message: string) => void
  lock?: CheckoutLockDeps
}

interface Resolved {
  git: GitRunner
  log: (message: string) => void
  lock: CheckoutLockDeps
}

/** Every talk with origin goes as the account kept for the repository, never as the person's own login (`remote-account.ts`). */
function resolveDeps(deps: FileBranchDeps): Resolved {
  return { git: accountGit(deps.git ?? nodeGitRunner()), log: deps.log ?? (() => {}), lock: deps.lock ?? {} }
}

/**
 * Whether the repo has `origin` to sync the branch with. Every fetch and push here names
 * `origin`, so a repo whose only remote is called something else is remote-less to this module:
 * the stated no-remote outcomes, not a push that fails twice.
 */
async function hasOrigin(cwd: string, git: GitRunner): Promise<boolean> {
  try {
    return (await git(['remote'], cwd)).split('\n').some(line => line.trim() === 'origin')
  } catch {
    return false
  }
}

/**
 * The repository's own git setting that says its branches here may leave the machine. Unset
 * reads as off: nothing is fetched from or pushed to origin until the person turns it on. It
 * lives in the repository's git config, which every checkout of the clone shares, so a
 * long-lived process and a command an agent runs in its checkout read the same answer.
 */
export const SHARE_SETTING = 'agent-data.share'

/** Whether the person turned sharing on for the repository `cwd` belongs to. */
export async function readSharing(cwd: string, git: GitRunner = nodeGitRunner()): Promise<boolean> {
  return git(['config', '--local', '--get', '--type=bool', SHARE_SETTING], cwd).then(
    out => out.trim() === 'true',
    () => false,
  )
}

/** Turn sharing on or off for the repository `cwd` belongs to. */
export async function writeSharing(cwd: string, on: boolean, git: GitRunner = nodeGitRunner()): Promise<void> {
  await git(['config', '--local', SHARE_SETTING, String(on)], cwd)
}

/** Forget the person's answer for the repository `cwd` belongs to: sharing reads as off again. Answers whether there was one. */
export async function clearSharing(cwd: string, git: GitRunner = nodeGitRunner()): Promise<boolean> {
  return git(['config', '--local', '--unset', SHARE_SETTING], cwd).then(
    () => true,
    () => false,
  )
}

/**
 * How far a branch here reaches: `origin` when the repository has one and the person shares
 * with it, else why it stays on this machine: there is no origin (`no-remote`), or the person
 * has not turned sharing on (`kept`).
 */
export type BranchReach = 'origin' | 'no-remote' | 'kept'

export async function branchReach(cwd: string, git: GitRunner = nodeGitRunner()): Promise<BranchReach> {
  if (!(await hasOrigin(cwd, git))) return 'no-remote'
  return (await readSharing(cwd, git)) ? 'origin' : 'kept'
}

/** Whether a fetch or a push may go out: the one question every sync and write here asks first. */
async function reachesOrigin(cwd: string, git: GitRunner): Promise<boolean> {
  return (await branchReach(cwd, git)) === 'origin'
}

/** Whether a ref exists locally. */
async function refExists(cwd: string, ref: string, git: GitRunner): Promise<boolean> {
  return git(['rev-parse', '--verify', '--quiet', ref], cwd).then(
    () => true,
    () => false,
  )
}

/**
 * Make the branch exist locally: origin's copy when there is one, else born here, parentless. Never
 * tracking (`--no-track`): setting up tracking writes the repository's shared `.git/config`, whose
 * lock a coding agent's own `git config` or `git push -u` in its checkout would then fail on.
 * Nothing here reads the upstream: every fetch, rebase and push names `origin` and the branch.
 */
async function ensureBranchRef(repo: string, branch: string, git: GitRunner): Promise<void> {
  if (await refExists(repo, `refs/heads/${branch}`, git)) return
  if (await reachesOrigin(repo, git)) await git(['fetch', 'origin', branch], repo).catch(() => {})
  if (await refExists(repo, `refs/remotes/origin/${branch}`, git)) {
    await git(['branch', '--no-track', branch, `origin/${branch}`], repo)
  } else {
    await git(['branch', branch, await birthCommit(repo, branch, git)], repo)
  }
}

/**
 * The commit a branch is born on: parentless, holding git's empty tree. How a branch is born with
 * no working-tree gymnastics: `git commit-tree` never touches any checkout, and no code commit is
 * ever an ancestor of the history.
 */
async function birthCommit(repo: string, branch: string, git: GitRunner): Promise<string> {
  return (await git(['commit-tree', EMPTY_TREE, '-m', `create the ${branch} branch`], repo)).trim()
}

/** The branch HEAD is attached to in a checkout, or `undefined` when HEAD is detached. */
async function attachedBranch(path: string, git: GitRunner): Promise<string | undefined> {
  const ref = await git(['symbolic-ref', '--quiet', 'HEAD'], path).catch(() => '')
  return ref.trim().replace(/^refs\/heads\//, '') || undefined
}

/**
 * Whether git holds a checkout registered at `path`: a worktree of the repo whose directory is
 * still there. A directory that is not one (never made, deleted by hand, or a stray folder no
 * worktree owns) reads as absent, and so does a registration whose directory is gone.
 */
async function checkoutRegistered(repo: string, path: string, git: GitRunner): Promise<boolean> {
  const want = await realpath(path).catch(() => undefined)
  if (!want) return false
  const list = await git(['worktree', 'list', '--porcelain'], repo).catch(() => '')
  for (const entry of list.split('\n\n')) {
    const lines = entry.split('\n')
    const at = lines[0]?.startsWith('worktree ') ? lines[0].slice('worktree '.length) : undefined
    if (!at || (await realpath(at).catch(() => at)) !== want) continue
    return !lines.some(line => line === 'prunable' || line.startsWith('prunable '))
  }
  return false
}

/**
 * Put a checkout found off its branch back on it. A rebase left half done (a process killed
 * mid-way, or the lock another process held at its last step) is abandoned first, which
 * restores the branch when git still has that rebase's state. Detached after that — the way a
 * rebase whose last step was refused leaves it, at origin's tip — the branch is moved to HEAD:
 * whatever was committed on the detached HEAD (a record a later cycle wrote there) stays and
 * goes out with the next push. On another branch (a hand's doing), the branch is checked out
 * again and the other branch is left where it is.
 */
async function attachBranch(path: string, branch: string, git: GitRunner): Promise<void> {
  await git(['rebase', '--abort'], path).catch(() => {})
  const at = await attachedBranch(path, git)
  if (at === branch) return
  await git(at ? ['checkout', '--force', branch] : ['checkout', '--force', '-B', branch], path)
}

/**
 * The unserialized ensure: branch and checkout. Split from {@link ensureFileBranch} so the
 * writer and the pull can run it inside the cycle they already hold the checkout's lock for.
 */
async function ensureCore(repo: string, branch: string, r: Resolved): Promise<void> {
  const path = checkoutPath(repo, branch)
  // Already checked out on the right branch: done. The common case, taken on every tick.
  if ((await attachedBranch(path, r.git)) === branch) return
  // The checkout is there but off its branch: back on it, never added a second time (git
  // refuses: the path exists), which is how one detached checkout once failed every write after.
  if (await checkoutRegistered(repo, path, r.git)) return attachBranch(path, branch, r.git)
  await ensureBranchRef(repo, branch, r.git)
  // A stale registration at this path (the dir was deleted by hand) blocks the add.
  await r.git(['worktree', 'prune'], repo).catch(() => {})
  await r.git(['worktree', 'add', path, branch], repo)
  // The checkout sits under `.branches/` like the agent checkouts, and is hidden the same way
  // (git's own exclude, no tracked file) — this may be the first checkout the project gets.
  await excludeFromGit(repo, '/' + BRANCHES_DIR, undefined, r.git).catch(() => {})
}

/**
 * Bring the checkout up to date with origin: fetch, then rebase whatever local commits exist (a
 * push that could not land earlier) onto origin's tip. A conflict resolves toward origin — the
 * writer re-applies the local intent afterwards, which is the "re-run on conflict" rule the whole
 * cycle is built on.
 *
 * Whatever the rebase did, the checkout ends on the branch. A rebase moves the branch onto
 * origin's tip as its last step, with HEAD detached there until then; when that step is refused
 * (another process on this clone held the branch's ref lock at that instant) git fails and
 * leaves HEAD detached, and the abort meets the same lock. A plain reset would keep it detached:
 * the next commit would land on no branch, and the push, which sends the branch, would carry
 * nothing while reporting nothing wrong. So the fallback checks the branch out again on origin's
 * tip, attached, which is the same "origin wins" outcome for a conflict.
 */
async function syncCore(repo: string, branch: string, r: Resolved): Promise<void> {
  if (!(await reachesOrigin(repo, r.git))) return
  const path = checkoutPath(repo, branch)
  await r.git(['fetch', 'origin', branch], repo).catch(() => {})
  if (!(await refExists(repo, `refs/remotes/origin/${branch}`, r.git))) return
  try {
    await r.git(['rebase', `origin/${branch}`], path)
  } catch {
    await r.git(['rebase', '--abort'], path).catch(() => {})
    await r.git(['checkout', '--force', '--no-track', '-B', branch, `origin/${branch}`], path)
  }
}

/**
 * Make sure the branch and its persistent checkout exist. Idempotent and cheap when everything is
 * in place (one `git rev-parse` against the checkout); never throws — a project this cannot be
 * set up in reports why and is left alone.
 */
export async function ensureFileBranch(cwd: string, branch: string, deps: FileBranchDeps = {}): Promise<{ ok: boolean; error?: string }> {
  const r = resolveDeps(deps)
  const repo = await cloneHome(cwd, r.git)
  return withCheckoutLock(repo, branch, r.lock, async () => {
    await ensureCore(repo, branch, r)
    return { ok: true }
  }).catch(err => ({ ok: false, error: errorMessage(err) }))
}

/** What {@link removeFileBranch} did: what went, and what stayed with the reason, each in words for a person. */
export type FileBranchRemoval =
  | { ok: true; removed: string[]; kept: { path: string; reason: string }[] }
  | { ok: false; error: string }

/**
 * Take the branch off this machine: its persistent checkout, then the local branch. For a person
 * who removes a project and asks for its files to go too. The copy on origin is never touched and
 * nothing is pushed first, so commits that never reached origin go with the branch.
 *
 * Only from the clone's own directory: from a linked worktree the branch is the whole
 * repository's, and it stays. A directory in the checkout's place that git does not know as a
 * checkout is left alone, and so is a branch git refuses to delete (checked out somewhere else).
 * Joins the one-at-a-time order, so a write or a pull under way finishes first. The checkouts
 * directory goes with the checkout when that leaves it empty, and the rule hiding it when no
 * checkout of the repository has one. Where there is neither the checkout nor the branch nothing
 * is touched, the lock included. Never throws.
 */
export async function removeFileBranch(cwd: string, branch: string, deps: FileBranchDeps = {}): Promise<FileBranchRemoval> {
  const r = resolveDeps(deps)
  const repo = await cloneHome(cwd, r.git)
  const path = checkoutPath(repo, branch)
  const rel = `${BRANCHES_DIR}/${branch}`
  const label = `branch ${branch}`
  const there = (): Promise<boolean> => lstat(path).then(() => true, () => false)
  try {
    if ((await realpath(cwd)) !== (await realpath(repo))) return { ok: true, removed: [], kept: [{ path: label, reason: `it belongs to the repository at ${repo}` }] }
    if (!(await there()) && !(await refExists(repo, `refs/heads/${branch}`, r.git))) return { ok: true, removed: [], kept: [] }
    return await withCheckoutLock(repo, branch, r.lock, async (): Promise<FileBranchRemoval> => {
      const removed: string[] = []
      const kept: { path: string; reason: string }[] = []
      if (await checkoutRegistered(repo, path, r.git)) {
        await r.git(['worktree', 'remove', '--force', path], repo)
        removed.push(rel)
      } else if (await there()) kept.push({ path: rel, reason: 'not a checkout git knows' })
      await r.git(['worktree', 'prune'], repo).catch(() => {})
      if (await refExists(repo, `refs/heads/${branch}`, r.git)) {
        const refused = await r.git(['branch', '-D', branch], repo).then(() => undefined, errorMessage)
        if (refused === undefined) removed.push(label)
        else kept.push({ path: label, reason: refused.trim().split('\n').at(-1) ?? refused })
      }
      return { ok: true, removed, kept }
    }).then(async outcome => {
      // Outside the cycle: its lock file sits in the directory until the cycle ends.
      if (outcome.ok && outcome.removed.includes(rel) && (await removeCheckoutsDir(repo, r.git))) outcome.removed.push(BRANCHES_DIR)
      return outcome
    })
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/**
 * The checkouts directory, once the checkout this module made in it is gone: removed when it is
 * empty (never with contents: an agent's checkout or anyone's file keeps it), and then the rule
 * hiding it, unless another checkout of the repository still has such a directory. Answers
 * whether the directory went.
 */
async function removeCheckoutsDir(repo: string, git: GitRunner): Promise<boolean> {
  if (!(await rmdir(join(repo, BRANCHES_DIR)).then(() => true, () => false))) return false
  await unexcludeOnceGone(repo, BRANCHES_DIR, git)
  return true
}

/**
 * What one funneled write did. `changed: false` is the clean no-op (the op wrote nothing new).
 * A failure says whether the change still landed as a local commit (`committed` — the push is
 * what failed, and the next cycle carries it out) or nothing survived at all.
 */
export type FileBranchWrite =
  | { ok: true; changed: boolean; pushed: boolean }
  | { ok: false; committed: boolean; error: string }

/** A writer's message: fixed, or resolved after the op ran (a batch only knows what it did then). */
export type CommitMessage = string | (() => string)

/**
 * Run a write's op and commit whatever it changed in the checkout at `dir`, under the write's
 * message, made once the op ran: whether the op changed anything. A change of nothing is no commit.
 */
export async function commitChange(dir: string, message: CommitMessage, op: () => Promise<void>, git: GitRunner): Promise<boolean> {
  await op()
  await git(['add', '-A'], dir)
  if (!(await git(['status', '--porcelain'], dir)).trim()) return false
  await git(['commit', '-m', typeof message === 'function' ? message() : message], dir)
  return true
}

/**
 * git's refusal when another git command holds a lock of the checkout — its index, or the
 * branch's ref: one run outside this module (a person's git in the checkout, or a process whose
 * build predates the checkout's lock file). git does not wait for a lock, so the cycle waits
 * instead and runs again.
 */
const LOCK_RETRIES = 3
const LOCK_WAIT_MS = 500
export function isGitLocked(err: unknown): boolean {
  return /\.lock['"]?: File exists/.test(errorMessage(err))
}

/**
 * Apply one change to the branch through its persistent checkout: sync with origin, run `op`
 * against the checkout, commit whatever it changed, push. The single funnel a long-lived
 * process's writes go through.
 *
 * Every process on the clone takes the checkout's lock file first, and waits while another holds
 * it (five minutes at most, then the write fails without touching the checkout). A git command
 * outside that lock holding a lock of the checkout (its `index.lock`, or the branch's ref lock)
 * is waited out too: the checkout is reset, the cycle waits half a second and runs again, three
 * times at most, before the failure is reported like any other.
 *
 * `op` must be re-runnable: when the push loses a race with another writer, the cycle re-syncs
 * and runs it again against the fresher state rather than force-fitting a stale commit — the op
 * *is* the intent, the commit is just its serialization. Two attempts; a push that still fails
 * (the network, most likely) keeps the commit local and reports the error — the next cycle's sync
 * rebases it onto whatever origin has by then, and the next push carries it.
 *
 * Never throws: callers run on background ticks with nothing to catch it.
 */
export async function withFileBranch(
  cwd: string,
  branch: string,
  message: CommitMessage,
  op: (dir: string) => Promise<void>,
  deps: FileBranchDeps = {},
): Promise<FileBranchWrite> {
  const r = resolveDeps(deps)
  const repo = await cloneHome(cwd, r.git)
  const path = checkoutPath(repo, branch)
  return withCheckoutLock(repo, branch, r.lock, async (): Promise<FileBranchWrite> => {
    for (let locked = 0; ; locked++) {
      const outcome = await cycle(repo, branch, path, message, op, r)
      if (outcome.ok || !isGitLocked(outcome.error) || locked >= LOCK_RETRIES) return outcome
      await new Promise(resolve => setTimeout(resolve, LOCK_WAIT_MS))
    }
  }).catch(err => ({ ok: false, committed: false, error: errorMessage(err) }))
}

/** One write cycle, unserialized: sync, apply, commit, push (twice on a lost race). Never throws. */
async function cycle(
  repo: string,
  branch: string,
  path: string,
  message: CommitMessage,
  op: (dir: string) => Promise<void>,
  r: Resolved,
): Promise<FileBranchWrite> {
  try {
    await ensureCore(repo, branch, r)
    const remote = await reachesOrigin(repo, r.git)
    for (let attempt = 0; ; attempt++) {
      await syncCore(repo, branch, r)
      // The tip before this op's commit: what a lost push winds back to before re-applying, so
      // the op's first serialization is dropped rather than rebased under its second run.
      const before = (await r.git(['rev-parse', 'HEAD'], path)).trim()
      const changed = await commitChange(path, message, () => op(path), r.git)
      if (!remote) return { ok: true, changed, pushed: false }
      // Unpushed commits — this cycle's, or an earlier cycle's that the sync just rebased. The
      // push is owed whenever any exist, even when this op itself wrote nothing new.
      const ahead = (await refExists(repo, `refs/remotes/origin/${branch}`, r.git))
        ? (await r.git(['rev-list', '--count', `origin/${branch}..${branch}`], repo)).trim() !== '0'
        : true
      if (!ahead) return { ok: true, changed: false, pushed: false }
      try {
        await r.git(['push', 'origin', `${branch}:${branch}`], path)
        return { ok: true, changed, pushed: true }
      } catch (err) {
        if (attempt >= 1) return { ok: false, committed: true, error: `the ${branch} branch could not be pushed: ${errorMessage(err)}` }
        if (changed) await r.git(['reset', '--hard', before], path)
      }
    }
  } catch (err) {
    // The op's half-written files must not ride a later, unrelated commit: put the checkout
    // back to its committed state before reporting.
    await r.git(['reset', '--hard'], path).catch(() => {})
    await r.git(['clean', '-fd'], path).catch(() => {})
    return { ok: false, committed: false, error: errorMessage(err) }
  }
}

/** How a pull went: how far the branch reaches once it is done, or why it could not converge. */
export type FileBranchSync = { ok: true; reach: BranchReach } | { ok: false; error: string }

/**
 * The eager pull: sync the persistent checkout with origin so this machine reads what other
 * machines and cloud sessions committed, without waiting for the next local write — and push
 * anything a failed cycle left stranded locally, via the same owed-push rule as the writer.
 * Ensures the checkout exists, so a fresh clone converges on its first tick. Never throws.
 *
 * Reports why it could not converge: a push origin rejects. A branch that stays on this machine
 * (no origin, or sharing is off) has nothing to converge with: the pull is fine and says so in
 * `reach`, so a caller may tell a repository that is not shared from a sync that broke.
 */
export async function pullFileBranch(repo: string, branch: string, deps: FileBranchDeps = {}): Promise<FileBranchSync> {
  const r = resolveDeps(deps)
  const result = await withFileBranch(repo, branch, 'sync', async () => {}, deps)
  if (!result.ok) {
    r.log(`[branches] ${branch}: ${result.error}`)
    return { ok: false, error: result.error }
  }
  return { ok: true, reach: await branchReach(repo, r.git) }
}

/**
 * The repository `cwd` belongs to: the directory holding the repo's real `.git`. From the main
 * checkout that is `cwd` itself; from an agent's worktree it is the repo the worktree was made
 * from — where the persistent checkout lives, and the address every funneled write goes to.
 * `undefined` outside any repo.
 */
export async function fileBranchRepo(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  try {
    const gitDir = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)).trim()
    return gitDir ? dirname(gitDir) : undefined
  } catch {
    return undefined
  }
}

/**
 * The refs a read looks at, in order. `fresh` fetches first and prefers origin's copy — for a
 * reader about to act on the files from a long-lived process, where the local ref may trail what
 * other writers pushed. Otherwise the local branch first, then origin's copy (a fresh clone that
 * fetched but never branched — the cloud case).
 */
async function readRefs(repo: string, branch: string, fresh: boolean | undefined, git: GitRunner): Promise<string[]> {
  const remote = fresh && (await reachesOrigin(repo, git))
  if (remote) await git(['fetch', 'origin', branch], repo).catch(() => {})
  return remote ? [`origin/${branch}`, branch] : [branch, `origin/${branch}`]
}

/**
 * Read one file off the branch, from anywhere in the repo: the persistent checkout when this
 * `cwd`'s repo has one, else `git show` against the local branch (worktrees share the repo's
 * refs, so an agent's checkout reads the same files without holding any of them), else against
 * `origin/…`. `undefined` when the file exists in none of them. Never throws.
 */
export async function readBranchFile(
  cwd: string,
  branch: string,
  rel: string,
  opts: { fresh?: boolean } = {},
  deps: FileBranchDeps = {},
): Promise<string | undefined> {
  const r = resolveDeps(deps)
  const repo = await cloneHome(cwd, r.git)
  if (!opts.fresh) {
    const path = checkoutPath(repo, branch)
    const fromCheckout = await r.git(['rev-parse', '--abbrev-ref', 'HEAD'], path).then(
      out => out.trim() === branch,
      () => false,
    )
    if (fromCheckout) {
      const md = await readFile(join(path, rel), 'utf8').catch(() => undefined)
      if (md !== undefined) return md
    }
  }
  for (const ref of await readRefs(repo, branch, opts.fresh, r.git)) {
    const md = await r.git(['show', `${ref}:${rel}`], cwd).catch(() => undefined)
    if (md !== undefined) return md
  }
  return undefined
}

/**
 * The entries of one directory on the branch, by name — a read off the ref, like
 * {@link readBranchFile}, for a reader that holds no checkout. `[]` for a directory the branch
 * does not have. Never throws.
 */
export async function listBranchDir(
  cwd: string,
  branch: string,
  dir: string,
  opts: { fresh?: boolean } = {},
  deps: FileBranchDeps = {},
): Promise<string[]> {
  const r = resolveDeps(deps)
  const repo = await cloneHome(cwd, r.git)
  for (const ref of await readRefs(repo, branch, opts.fresh, r.git)) {
    const out = await r.git(['ls-tree', '--name-only', `${ref}:${dir}`], cwd).catch(() => undefined)
    if (out !== undefined) return out.split('\n').map(line => line.trim()).filter(Boolean)
  }
  return []
}

/** Reads off one ref of the branch, for a reader that opens many files: fetched once, up front. */
export interface BranchReader {
  /** The ref every read goes to: origin's copy when the branch reaches origin, else the local branch, else the copy of origin's this clone holds. */
  ref: string
  /** One file's content, or `undefined` when the ref has no such file. */
  read: (rel: string) => Promise<string | undefined>
  /** One directory's entries by name; `[]` when the ref has no such directory. */
  list: (dir: string) => Promise<string[]>
}

/**
 * Open the branch for reading from any clone, holding no checkout: fetch origin's copy once and
 * read that (a one-shot reader — a command an agent runs — must see what other writers pushed,
 * its own detached write included, which the local ref never moves for), else the local branch
 * when the branch stays on this machine, else the copy of origin's the clone already holds. Every
 * read then goes to that one ref; nothing is fetched again.
 */
export async function openBranchReader(cwd: string, branch: string, deps: FileBranchDeps = {}): Promise<BranchReader> {
  const r = resolveDeps(deps)
  const repo = await cloneHome(cwd, r.git)
  // The first of the refs that is there: a clone that never made the branch still holds the copy
  // of origin's it was cloned with.
  let at = branch
  for (const ref of await readRefs(repo, branch, true, r.git)) {
    if (await refExists(repo, ref.startsWith('origin/') ? `refs/remotes/${ref}` : `refs/heads/${ref}`, r.git)) {
      at = ref
      break
    }
  }
  return {
    ref: at,
    read: rel => r.git(['show', `${at}:${rel}`], cwd).catch(() => undefined),
    list: dir =>
      r
        .git(['ls-tree', '--name-only', `${at}:${dir}`], cwd)
        .then(out => out.split('\n').map(line => line.trim()).filter(Boolean))
        .catch((): string[] => []),
  }
}

/** What a one-shot write did: whether the op wrote anything new. */
export interface DetachedWrite {
  changed: boolean
}

/**
 * Apply one change to the branch as a one-shot remote writer, from any clone: fetch origin's
 * tip, check it out in a throwaway worktree, run `op` against it, commit, push straight to the
 * branch, remove the worktree. A push that loses a race re-fetches, resets to origin's tip and
 * re-runs the op, twice, the same intent rule as the funnel; a push that still fails throws with
 * git's reason.
 *
 * Never the persistent checkout: that is a long-lived process's, whose funnel sweeps its
 * checkout with `git add -A` and resets it on failure, so a second writer inside it would be
 * committed under the wrong message or wiped. The local branch ref is not moved either — the
 * persistent checkout, when there is one, converges on its own next pull.
 *
 * A branch origin does not have yet is born by the write itself, parentless.
 *
 * A branch that stays on this machine (no origin, or sharing is off) has no remote to write to:
 * the change goes through the funnel instead, which every process on the clone may join, and
 * lands as a local commit. A funnel that fails throws with its reason.
 */
export async function writeFileBranchDetached(
  cwd: string,
  branch: string,
  message: CommitMessage,
  op: (dir: string) => Promise<void>,
  deps: FileBranchDeps = {},
): Promise<DetachedWrite> {
  const r = resolveDeps(deps)
  if (!(await reachesOrigin(cwd, r.git))) {
    const local = await withFileBranch(cwd, branch, message, op, deps)
    if (!local.ok) throw new Error(local.error)
    return { changed: local.changed }
  }
  // A slash in the branch name would name a directory under tmpdir that does not exist (#1762).
  const dir = await mkdtemp(join(tmpdir(), `${branch.replace(/[\\/]/g, '-')}-write-`))
  // The remote's tip, or a parentless start for a branch origin does not have yet.
  const tip = async (): Promise<string> => {
    await r.git(['fetch', 'origin', branch], cwd).catch(() => {})
    if (await refExists(cwd, `refs/remotes/origin/${branch}`, r.git)) return `origin/${branch}`
    return birthCommit(cwd, branch, r.git)
  }
  try {
    await r.git(['worktree', 'add', '--detach', dir, await tip()], cwd)
    for (let attempt = 0; ; attempt++) {
      if (!(await commitChange(dir, message, () => op(dir), r.git))) return { changed: false }
      try {
        await r.git(['push', 'origin', `HEAD:refs/heads/${branch}`], dir)
        return { changed: true }
      } catch (err) {
        if (attempt >= 1) throw err
        await r.git(['reset', '--hard', await tip()], dir)
      }
    }
  } finally {
    await r.git(['worktree', 'remove', '--force', dir], cwd).catch(() => {})
    await r.git(['worktree', 'prune'], cwd).catch(() => {})
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * The file seams an operation inside a funneled write needs — read, write, delete and list plain
 * files under the directory the funnel hands it. Injectable so an operation is unit-testable off
 * disk and git; production takes the defaults. Parents are created on write because the
 * directory itself is not a given: retiring the last file removes it (git keeps no empty dirs),
 * and a branch is born without it.
 */
export interface BranchFileFs {
  /** Read one file; rejects when it cannot — a caller reads the rejection as "absent". */
  read: (path: string) => Promise<string>
  /** Write one file, creating parents. */
  write: (path: string, content: string) => Promise<void>
  /** Delete one file. */
  remove: (path: string) => Promise<void>
  /** The files under a directory, by filename; a missing directory reads as none. */
  list: (dir: string) => Promise<string[]>
}

/** {@link BranchFileFs} over `node:fs/promises`. */
export function nodeBranchFileFs(): BranchFileFs {
  return {
    read: path => readFile(path, 'utf8'),
    write: async (path, content) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
    },
    remove: path => rm(path),
    list: dir => readdir(dir).catch((): string[] => []),
  }
}
