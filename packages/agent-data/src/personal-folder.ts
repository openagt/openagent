import { mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { errorMessage, gitReason, nodeGitRunner, type GitRunner } from './git.js'
import { withLockFile, type CheckoutLockDeps } from './checkout-lock.js'
import { originUrl } from './origin.js'
import { NoRemoteAccountError, accountGit, clearRemoteAccount, readRemoteAccount, writeRemoteAccount, type RemoteAccount } from './remote-account.js'
import { commitChange, type CommitMessage, type FileBranchWrite } from './file-branch.js'

// The person's own folder on this machine, `~/.openagent`: a git repository of its own, synced
// with a repository of the person's when they give it one, so every machine of theirs has the same
// records. It holds what is the person's own (their agents, their name) and the data of every
// project they keep on this machine (`project-data.ts`).

/** The personal folder's lock file, at its root and hidden from git by its own exclude. */
const LOCK_FILE = '.lock'

/**
 * The person's own folder on this machine: `$XDG_CONFIG_HOME/openagent` when that is set (beside
 * the registry, so the one variable that moves the registry moves this too), else `~/.openagent`.
 */
export function personalFolder(env: NodeJS.ProcessEnv = process.env): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'openagent')
  return join(env.HOME || homedir(), '.openagent')
}

/** Injectable seams; production takes the defaults. `folder` stands in for the personal folder. */
export interface PersonalFolderDeps {
  git?: GitRunner
  lock?: CheckoutLockDeps
  folder?: string
}

/**
 * Make the personal folder a repository with a first commit, so a failed write always has a
 * commit to go back to. A machine whose git has no name or email (a fresh server) gets one in the
 * folder's own config: a write must never fail for it.
 */
async function ensurePersonalFolder(folder: string, git: GitRunner): Promise<void> {
  if (await stat(join(folder, '.git')).then(() => true, () => false)) return
  await mkdir(folder, { recursive: true })
  await git(['init', '-q', '-b', 'main'], folder)
  await mkdir(join(folder, '.git', 'info'), { recursive: true })
  await writeFile(join(folder, '.git', 'info', 'exclude'), `/${LOCK_FILE}\n`)
  for (const [key, value] of [['user.name', 'OpenAgent'], ['user.email', 'openagent@localhost']] as const) {
    const set = await git(['config', '--get', key], folder).then(out => out.trim() !== '', () => false)
    if (!set) await git(['config', '--local', key, value], folder)
  }
  await git(['commit', '-q', '--allow-empty', '-m', 'create the personal folder'], folder)
}

/** One write at a time per personal folder, within this process and across every other: the folder's lock file. */
function withFolderLock<T>(folder: string, deps: PersonalFolderDeps, task: () => Promise<T>): Promise<T> {
  return withLockFile(join(folder, LOCK_FILE), deps.lock, task)
}

/** The branch the personal folder is on, here and on its remote. */
const FOLDER_BRANCH = 'main'

/**
 * Take in what the remote has: fetch, then merge origin's tip, origin's side winning a line both
 * changed. A merge, not a rebase, so a commit of this machine's that never reached the remote is
 * never dropped; unrelated histories merge too, so the first sync of a folder with a remote another
 * machine already filled keeps both. A merge git cannot finish even so (a file changed here and
 * deleted there) is given up, and the folder is put at origin's tip: the remote wins.
 */
async function takeRemote(folder: string, git: GitRunner): Promise<void> {
  await git(['fetch', '-q', 'origin', FOLDER_BRANCH], folder).catch(() => {})
  const theirs = `refs/remotes/origin/${FOLDER_BRANCH}`
  if (!(await git(['rev-parse', '--verify', '--quiet', theirs], folder).then(() => true, () => false))) return
  try {
    await git(['merge', '-q', '--no-edit', '--allow-unrelated-histories', '-X', 'theirs', theirs], folder)
  } catch {
    await git(['merge', '--abort'], folder).catch(() => {})
    await git(['reset', '-q', '--hard', theirs], folder)
  }
}

/**
 * What git said went wrong, as a person reads it: its own line about it ({@link gitReason}), not
 * the command it ran nor the advice it adds after, without its `fatal:` or `error:`.
 */
function plainReason(err: unknown): string {
  return gitReason(err).replace(/^(fatal|error): /, '')
}

/**
 * Apply one change to the personal folder: run `op`, commit whatever it changed. A folder with a
 * remote first takes in what the remote has, and sends its commits after, the change's and any an
 * earlier write could not send; a push that loses a race takes the remote in again and runs `op`
 * again, once. A push that still fails keeps the commit here, and the next write or pull sends it.
 * With no account of OpenAgent's named to send it as, the change is made all the same and waits
 * here (`pushed: false`): that is the folder's state, said where it is synced, not this write's
 * failure. A failed op leaves no half-written file behind. Never throws.
 */
export async function withPersonalFolder(folder: string, message: CommitMessage, op: () => Promise<void>, deps: PersonalFolderDeps = {}): Promise<FileBranchWrite> {
  const git = accountGit(deps.git ?? nodeGitRunner())
  return withFolderLock(folder, deps, async (): Promise<FileBranchWrite> => {
    try {
      await ensurePersonalFolder(folder, git)
      const remote = (await originUrl(folder, git)) !== undefined
      for (let attempt = 0; ; attempt++) {
        if (remote) await takeRemote(folder, git)
        const before = (await git(['rev-parse', 'HEAD'], folder)).trim()
        const changed = await commitChange(folder, message, op, git)
        if (!remote) return { ok: true, changed, pushed: false }
        const ahead = await git(['rev-list', '--count', `refs/remotes/origin/${FOLDER_BRANCH}..HEAD`], folder).then(
          out => out.trim() !== '0',
          () => true,
        )
        if (!ahead) return { ok: true, changed: false, pushed: false }
        try {
          await git(['push', '-q', 'origin', `HEAD:refs/heads/${FOLDER_BRANCH}`], folder)
          return { ok: true, changed, pushed: true }
        } catch (err) {
          // No account to send it as: made all the same, it waits here until one is named.
          if (err instanceof NoRemoteAccountError) return { ok: true, changed, pushed: false }
          if (attempt >= 1) return { ok: false, committed: true, error: `the personal folder could not be sent to its remote: ${plainReason(err)}` }
          if (changed) await git(['reset', '-q', '--hard', before], folder)
        }
      }
    } catch (err) {
      await git(['merge', '--abort'], folder).catch(() => {})
      await git(['reset', '-q', '--hard'], folder).catch(() => {})
      await git(['clean', '-q', '-fd'], folder).catch(() => {})
      return { ok: false, committed: false, error: errorMessage(err) }
    }
  }).catch(err => ({ ok: false, committed: false, error: errorMessage(err) }))
}

/** How the personal folder stands: where it is, the remote it syncs with, and its commits the remote does not have yet. */
export interface PersonalFolderState {
  path: string
  remote?: string
  /** The login of OpenAgent's account it is sent as (`remote-account.ts`). */
  account?: string
  /** Commits made here that have not reached the remote. */
  unsent: number
}

/** Read how the personal folder stands, without changing it. A folder not made yet holds nothing. Never throws. */
export async function readPersonalFolder(deps: PersonalFolderDeps = {}): Promise<PersonalFolderState> {
  const git = deps.git ?? nodeGitRunner()
  const folder = deps.folder ?? personalFolder()
  const made = await stat(join(folder, '.git')).then(() => true, () => false)
  if (!made) return { path: folder, unsent: 0 }
  const remote = await originUrl(folder, git)
  const unsent = remote
    ? await git(['rev-list', '--count', `refs/remotes/origin/${FOLDER_BRANCH}..HEAD`], folder).then(
        out => Number(out.trim()) || 0,
        // Nothing on the remote yet: every commit but the first, which carries nothing, is unsent.
        async () => Math.max(0, Number((await git(['rev-list', '--count', 'HEAD'], folder).catch(() => '1')).trim()) - 1),
      )
    : 0
  const account = (await readRemoteAccount(folder, git).catch(() => undefined))?.login
  return { path: folder, ...(remote ? { remote } : {}), ...(account ? { account } : {}), unsent }
}

/**
 * Sync the personal folder with a repository, sent as `account`, one of OpenAgent's own (none for
 * a repository in a folder on this disk, which asks no login): the remote is set, what it already
 * has (another machine's records) is merged in, and every commit here is sent. A remote that cannot
 * be reached or refuses is said, and the folder is left with no remote and no account, as it was.
 */
export async function syncPersonalFolder(address: string, account: RemoteAccount | undefined, deps: PersonalFolderDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const plain = deps.git ?? nodeGitRunner()
  const git = accountGit(plain)
  const folder = deps.folder ?? personalFolder()
  if (!address.trim() || address.trim().startsWith('-')) return { ok: false, error: 'no repository address given' }
  const made = await withPersonalFolder(folder, 'sync', async () => {}, deps)
  if (!made.ok) return { ok: false, error: made.error }
  const undo = async () => {
    await plain(['remote', 'remove', 'origin'], folder).catch(() => {})
    await clearRemoteAccount(folder, plain)
  }
  await undo()
  await plain(['remote', 'add', 'origin', address.trim()], folder)
  if (account) await writeRemoteAccount(folder, account, plain)
  const reached = await git(['ls-remote', '--heads', 'origin'], folder).then(() => undefined, errorMessage)
  if (reached !== undefined) {
    await undo()
    return { ok: false, error: `the repository could not be reached: ${plainReason(reached)}` }
  }
  const sent = await withPersonalFolder(folder, 'sync', async () => {}, deps)
  if (sent.ok) return { ok: true }
  await undo()
  return { ok: false, error: sent.error }
}

/**
 * Send the personal folder as another of OpenAgent's accounts from now on, and send what waits now.
 * A send the repository refuses leaves the folder sent as it was, the reason said.
 */
export async function sendPersonalFolderAs(account: RemoteAccount, deps: PersonalFolderDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const git = deps.git ?? nodeGitRunner()
  const folder = deps.folder ?? personalFolder()
  if (!(await originUrl(folder, git))) return { ok: false, error: 'the personal folder syncs with no repository' }
  const before = await readRemoteAccount(folder, git).catch(() => undefined)
  const named = await withFolderLock(folder, deps, () => writeRemoteAccount(folder, account, git)).then(
    () => undefined,
    err => errorMessage(err),
  )
  if (named !== undefined) return { ok: false, error: named }
  const sent = await withPersonalFolder(folder, 'sync', async () => {}, deps)
  if (sent.ok) return { ok: true }
  await withFolderLock(folder, deps, () => (before ? writeRemoteAccount(folder, before, git) : clearRemoteAccount(folder, git))).catch(() => {})
  return { ok: false, error: sent.error }
}

/** Stop syncing the personal folder: the remote is forgotten, every record stays here. */
export async function stopSyncingPersonalFolder(deps: PersonalFolderDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const git = deps.git ?? nodeGitRunner()
  const folder = deps.folder ?? personalFolder()
  return withFolderLock(folder, deps, async () => {
    await git(['remote', 'remove', 'origin'], folder).catch(() => {})
    await clearRemoteAccount(folder, git)
    return { ok: true as const }
  }).catch(err => ({ ok: false as const, error: errorMessage(err) }))
}
