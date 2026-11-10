import { execFile } from 'node:child_process'

/**
 * Running git: one `execFile`-backed runner with a per-subcommand timeout, and the two readings
 * of a failed invocation every caller wants — was it a timeout kill, and which line is worth
 * showing. Beside them, the few facts and questions about a repository more than one caller asks.
 */

/** Runs `git` in `cwd`, resolving its stdout. Rejects on a non-zero exit. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>

/**
 * A local read: the index, a ref, or objects already on disk. Kept at the budget that used to
 * cover everything, so a hung read still fails fast instead of holding the caller longer (#997).
 */
export const GIT_READ_TIMEOUT_MS = 10_000

/** A local mutation. Bounded by disk, but an index write on a large repo outlives a read. */
export const GIT_WRITE_TIMEOUT_MS = 30_000

/**
 * The network, or a whole checkout. `git worktree add` writes every tracked file and `git push`
 * uploads a packfile; on a large repo both routinely pass 10s, which is what #997 is about.
 */
export const GIT_SLOW_TIMEOUT_MS = 120_000

/** Subcommands that only read. Everything unlisted is treated as a mutation. */
const GIT_READ_OPS = new Set([
  'branch',
  'cat-file',
  'diff',
  'for-each-ref',
  'log',
  'ls-files',
  'merge-base',
  'remote',
  'rev-list',
  'rev-parse',
  'show',
  'show-ref',
  'status',
  'symbolic-ref',
])

/** Subcommands bounded by the network rather than by this machine. */
const GIT_SLOW_OPS = new Set(['clone', 'fetch', 'pull', 'push', 'ls-remote'])

/** `git branch` flags that only list or query; any other `branch` invocation writes a ref. */
const GIT_BRANCH_READ_FLAGS = new Set(['--list', '-l', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--show-current', '-r', '--remotes', '-a', '--all', '-v', '-vv', '--verbose'])

/** Global options whose value is the next word, so that word is not the subcommand. */
const GIT_GLOBAL_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/**
 * The subcommand and its own words, with the leading global options dropped. A bare flag filter
 * would read `git -C /repo push` as the subcommand `/repo`, costing `push` its slow budget.
 */
function gitWords(args: string[]): string[] {
  return gitCommand(args).filter(arg => !arg.startsWith('-'))
}

/** The subcommand and everything after it: the invocation with the leading global options dropped. */
function gitCommand(args: string[]): string[] {
  let i = 0
  while (i < args.length) {
    const arg = args[i] ?? ''
    if (!arg.startsWith('-')) break
    // The `--opt=value` form carries its value inline; the separate form eats the next word.
    i += GIT_GLOBAL_VALUE_OPTIONS.has(arg) ? 2 : 1
  }
  return args.slice(i)
}

/**
 * The timeout for one git invocation, chosen by subcommand (#997). One flat 10s budget once
 * covered every call site, so the slowest two ran under what is really a read's budget: a
 * SIGTERM'd `worktree add` drops an agent into the user's main checkout, a SIGTERM'd `push` may
 * have half-landed.
 */
export function gitTimeoutMs(args: string[]): number {
  const words = gitWords(args)
  const op = words[0] ?? ''
  if (GIT_SLOW_OPS.has(op)) return GIT_SLOW_TIMEOUT_MS
  if (op === 'worktree') {
    // Only `add` writes a checkout; `list` is a read, and remove/prune are ordinary mutations.
    if (words[1] === 'add') return GIT_SLOW_TIMEOUT_MS
    return words[1] === 'list' ? GIT_READ_TIMEOUT_MS : GIT_WRITE_TIMEOUT_MS
  }
  if (op === 'branch') {
    // A bare `branch` or one carrying a listing flag reads; `-D`, `-m`, or `branch <new> [start]` writes a ref.
    // The subcommand's own flags: a global option ahead of it (`-C <repo>`) is not one of them.
    const flags = gitCommand(args).filter(arg => arg.startsWith('-'))
    const reads = words.length === 1 || flags.some(flag => GIT_BRANCH_READ_FLAGS.has(flag))
    return reads && !flags.some(flag => !GIT_BRANCH_READ_FLAGS.has(flag) && !flag.startsWith('--format')) ? GIT_READ_TIMEOUT_MS : GIT_WRITE_TIMEOUT_MS
  }
  return GIT_READ_OPS.has(op) ? GIT_READ_TIMEOUT_MS : GIT_WRITE_TIMEOUT_MS
}

/**
 * A git killed for outrunning its timeout, as opposed to one git itself rejected (#997).
 *
 * `execFile` SIGTERMs on timeout, and a killed `git push` usually writes nothing to stderr, so
 * without this the failure surfaces as a bare "Command failed: git push ..." that reads like a
 * rejected push. The `timedOut` brand is what a caller across a package boundary checks.
 */
export class GitTimeoutError extends Error {
  readonly timedOut = true
  constructor(
    readonly args: string[],
    readonly timeoutMs: number,
  ) {
    super(`git ${args.join(' ')} timed out after ${timeoutMs}ms`)
    this.name = 'GitTimeoutError'
  }
}

/** True when a {@link GitRunner} rejection is a timeout kill rather than a non-zero exit. */
export function isGitTimeout(err: unknown): err is GitTimeoutError {
  return err instanceof Error && (err as { timedOut?: unknown }).timedOut === true
}

/**
 * A {@link GitRunner} backed by `execFile('git', ...)`. Rejects on any git error, and with a
 * {@link GitTimeoutError} when the operation outran its {@link gitTimeoutMs} budget.
 *
 * The buffer is raised well past the default because a repo crawl (`git ls-files`) prints a
 * line per file, and a large checkout overruns it.
 *
 * `env` is added to the process's own environment for each call: an account's, for a talk with a
 * remote as that account.
 */
export function nodeGitRunner(env?: Record<string, string>): GitRunner {
  return async (args, cwd) => {
    const timeoutMs = gitTimeoutMs(args)
    return new Promise<string>((resolvePromise, rejectPromise) => {
      execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, ...(env ? { env: { ...process.env, ...env } } : {}) }, (err, stdout) => {
        if (!err) return resolvePromise(String(stdout))
        // execFile kills on both timeout and a maxBuffer overrun; only the latter carries ENOBUFS.
        const killed = (err as { killed?: boolean }).killed === true
        if (killed && (err as { code?: unknown }).code !== 'ENOBUFS') {
          return rejectPromise(new GitTimeoutError(args, timeoutMs))
        }
        rejectPromise(err)
      })
    })
  }
}

/** git's well-known empty tree, there in every repository without being written first: a commit of it holds no file. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * Whether `cwd` sits inside a git working tree (#997). Lets a caller tell "this project cannot
 * host a worktree at all" from "git was there and the operation failed", which are the same
 * rejection out of `git worktree add` but call for opposite handling.
 *
 * Forgiving in one direction only: an unreadable / missing git reads as "no repo", which is the
 * conservative answer for the caller that treats a repo's failure as fatal.
 */
export async function isGitRepo(cwd: string, git: GitRunner = nodeGitRunner()): Promise<boolean> {
  return git(['rev-parse', '--is-inside-work-tree'], cwd)
    .then(out => out.trim() === 'true')
    .catch(() => false)
}

/**
 * Origin's default branch, as this clone's remote-tracking ref (`origin/main`): what origin's HEAD
 * points at, else `origin/main` or `origin/master`, whichever the clone has. Where every new agent
 * branch starts. Read locally, never fetched; undefined for a clone with none (no remote).
 */
export async function originDefaultBranch(repo: string, git: GitRunner = nodeGitRunner()): Promise<string | undefined> {
  const head = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repo).then(out => out.trim(), () => '')
  if (head) return head
  for (const ref of ['origin/main', 'origin/master']) {
    if (await git(['rev-parse', '--verify', '--quiet', `refs/remotes/${ref}`], repo).then(out => out.trim() !== '', () => false)) return ref
  }
  return undefined
}

/** The root of the checkout `cwd` is in — an agent's own, from anywhere under it. Rejects outside a repo. */
export async function checkoutRoot(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  return (await git(['rev-parse', '--show-toplevel'], cwd)).trim()
}

/** The message of a caught value, which may be anything thrown: a failed git invocation's, or any other. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The line of a failed git invocation worth showing: git's own `fatal:` / `error:` / `remote:`
 * line when there is one, else the first line, else a placeholder.
 */
export function gitReason(err: unknown): string {
  const lines = errorMessage(err).split('\n').map(line => line.trim()).filter(Boolean)
  return lines.find(line => /^(fatal|error|remote):/i.test(line)) ?? lines[0] ?? 'git failed'
}

/**
 * Push a branch to `origin`. The failure is git's own line, not a stack. No upstream is set:
 * that writes the repository's shared `.git/config`, whose lock a coding agent's own `git config`
 * or `git push -u` in another checkout of the clone would then fail on.
 */
export async function pushBranch(
  repo: string,
  branch: string,
  git: GitRunner = nodeGitRunner(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await git(['push', 'origin', branch], repo)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: gitReason(err) }
  }
}
