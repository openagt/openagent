import { mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { accountGit, errorMessage, gitReason, missingIdentity, NoRemoteAccountError, nodeGitRunner, withLockFile, type CheckoutLockDeps } from '@openagt/git-branches'
import { originUrl, type GitRunner } from '@openagt/hooks'
import { commitChange, type CommitMessage, type FileBranchWrite } from './file-branch.js'

// The person's own folder on this machine, `~/.openagent`: a git repository of its own, synced
// with a repository of the person's when they give it one (store-git-repository's
// `folder-sync.ts`), so every machine of theirs has the same records. It holds what is the
// person's own (their agents, their name) and the data of every project they keep on this machine
// (`project-data.ts`). Every write here takes in what that repository has first and sends its
// commits after.

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
  for (const [key, value] of await missingIdentity(folder, git)) await git(['config', '--local', key, value], folder)
  await git(['commit', '-q', '--allow-empty', '-m', 'create the personal folder'], folder)
}

/** One write at a time per personal folder, within this process and across every other: the folder's lock file. */
export function withPersonalFolderLock<T>(folder: string, deps: PersonalFolderDeps, task: () => Promise<T>): Promise<T> {
  return withLockFile(join(folder, LOCK_FILE), deps.lock, task)
}

/** The branch the personal folder is on, here and on its remote. */
export const FOLDER_BRANCH = 'main'

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
export function plainReason(err: unknown): string {
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
  return withPersonalFolderLock(folder, deps, async (): Promise<FileBranchWrite> => {
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
