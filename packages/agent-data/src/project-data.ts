import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { DATA_BRANCH } from './names.js'
import { errorMessage, nodeGitRunner, type GitRunner } from './git.js'
import { withLockFile } from './checkout-lock.js'
import { originUrl, repositoryAddress } from './origin.js'
import { NoRemoteAccountError, accountGit, clearRemoteAccount, readRemoteAccount, writeRemoteAccount, type RemoteAccount } from './remote-account.js'
import { SESSIONS_DIR, sessionsHomeOf } from './sessions.js'
import {
  branchReach,
  fileBranchPath,
  fileBranchRepo,
  listBranchDir,
  openBranchReader,
  pullFileBranch,
  readBranchFile,
  readSharing,
  resolveMessage,
  withFileBranch,
  writeFileBranchDetached,
  writeSharing,
  type BranchReader,
  type CommitMessage,
  type DetachedWrite,
  type FileBranchDeps,
  type FileBranchSync,
  type FileBranchWrite,
} from './file-branch.js'

// Where a project's agent data lives. By default in the person's own folder on this machine,
// `~/.openagent`: a git repository of its own, synced with a repository of the person's when they
// give it one (so every machine of theirs has the same records), each project's data under
// `projects/<project>/`, so adding a project puts nothing in its repository. A project the person
// shares writes to its own repository's `agent-data` branch instead (`file-branch.ts`), which
// goes to its remote. One place per project at a time: switching moves the data over.

/** The directory, in the personal folder, holding one directory per project. */
export const PROJECTS_DIR = 'projects'

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
export interface ProjectDataDeps extends FileBranchDeps {
  folder?: string
}

/**
 * Where one project's data is: its directory in the personal folder, or the persistent checkout of
 * its `agent-data` branch when the person shares the project. `repo` is the clone's own directory,
 * the same from any of its worktrees.
 */
export type DataPlace = { kind: 'personal'; repo: string; folder: string; dir: string } | { kind: 'branch'; repo: string; dir: string }

/**
 * The name a project's directory has in the personal folder: its repository's address
 * (`github.com/me/shop`), so the same project has the same directory on every machine; a
 * project with no address is named by its folder on this disk (`local/Users/me/notes`).
 */
export async function projectKey(repo: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  const address = await repositoryAddress(repo, git)
  const parts = (address ?? ['local', ...repo.split(sep)].join('/')).split('/').filter(part => part && part !== '.' && part !== '..')
  return parts.join('/')
}

/** Where the project `cwd` is in writes and reads its data right now; for the sessions home, where the sessions with no project keep theirs. Never throws. */
export async function projectDataPlace(cwd: string, deps: ProjectDataDeps = {}): Promise<DataPlace> {
  const git = deps.git ?? nodeGitRunner()
  // The sessions with no project keep their records together, in the personal folder.
  const sessions = await sessionsHomeOf(cwd)
  if (sessions !== undefined) {
    const folder = deps.folder ?? personalFolder()
    return { kind: 'personal', repo: sessions, folder, dir: join(folder, SESSIONS_DIR) }
  }
  const repo = (await fileBranchRepo(cwd, git)) ?? cwd
  if (await readSharing(repo, git)) return { kind: 'branch', repo, dir: await fileBranchPath(repo, DATA_BRANCH, git) }
  const folder = deps.folder ?? personalFolder()
  return { kind: 'personal', repo, folder, dir: join(folder, PROJECTS_DIR, await projectKey(repo, git)) }
}

/** Both places a project's data may be, whichever it is in now: its directory in the personal folder, and its branch's checkout. */
export async function projectDataDirs(cwd: string, deps: ProjectDataDeps = {}): Promise<{ personal: string; branch: string }> {
  const git = deps.git ?? nodeGitRunner()
  const repo = (await fileBranchRepo(cwd, git)) ?? cwd
  return { personal: join(deps.folder ?? personalFolder(), PROJECTS_DIR, await projectKey(repo, git)), branch: await fileBranchPath(repo, DATA_BRANCH, git) }
}

/** The directory a long-lived process reads the project's data off. */
export async function projectDataDir(cwd: string, deps: ProjectDataDeps = {}): Promise<string> {
  return (await projectDataPlace(cwd, deps)).dir
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
function withFolderLock<T>(folder: string, deps: ProjectDataDeps, task: () => Promise<T>): Promise<T> {
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

/** What git said went wrong, as a person reads it: its last line, not the command it ran. */
function gitReason(err: unknown): string {
  const said = errorMessage(err).trim()
  return (said.split('\n').at(-1) ?? said).replace(/^(fatal|error): /, '')
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
export async function withPersonalFolder(folder: string, message: CommitMessage, op: () => Promise<void>, deps: ProjectDataDeps = {}): Promise<FileBranchWrite> {
  const git = accountGit(deps.git ?? nodeGitRunner())
  return withFolderLock(folder, deps, async (): Promise<FileBranchWrite> => {
    try {
      await ensurePersonalFolder(folder, git)
      const remote = (await originUrl(folder, git)) !== undefined
      for (let attempt = 0; ; attempt++) {
        if (remote) await takeRemote(folder, git)
        const before = (await git(['rev-parse', 'HEAD'], folder)).trim()
        await op()
        await git(['add', '-A'], folder)
        const staged = (await git(['status', '--porcelain'], folder)).trim()
        if (staged) await git(['commit', '-q', '-m', resolveMessage(message)], folder)
        if (!remote) return { ok: true, changed: Boolean(staged), pushed: false }
        const ahead = await git(['rev-list', '--count', `refs/remotes/origin/${FOLDER_BRANCH}..HEAD`], folder).then(
          out => out.trim() !== '0',
          () => true,
        )
        if (!ahead) return { ok: true, changed: false, pushed: false }
        try {
          await git(['push', '-q', 'origin', `HEAD:refs/heads/${FOLDER_BRANCH}`], folder)
          return { ok: true, changed: Boolean(staged), pushed: true }
        } catch (err) {
          // No account to send it as: made all the same, it waits here until one is named.
          if (err instanceof NoRemoteAccountError) return { ok: true, changed: Boolean(staged), pushed: false }
          if (attempt >= 1) return { ok: false, committed: true, error: `the personal folder could not be sent to its remote: ${gitReason(err)}` }
          if (staged) await git(['reset', '-q', '--hard', before], folder)
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
export async function readPersonalFolder(deps: ProjectDataDeps = {}): Promise<PersonalFolderState> {
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
export async function syncPersonalFolder(address: string, account: RemoteAccount | undefined, deps: ProjectDataDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
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
    return { ok: false, error: `the repository could not be reached: ${gitReason(reached)}` }
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
export async function sendPersonalFolderAs(account: RemoteAccount, deps: ProjectDataDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
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
export async function stopSyncingPersonalFolder(deps: ProjectDataDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const git = deps.git ?? nodeGitRunner()
  const folder = deps.folder ?? personalFolder()
  return withFolderLock(folder, deps, async () => {
    await git(['remote', 'remove', 'origin'], folder).catch(() => {})
    await clearRemoteAccount(folder, git)
    return { ok: true as const }
  }).catch(err => ({ ok: false as const, error: errorMessage(err) }))
}

/**
 * Apply one change to the project's data from a long-lived process, `op` handed the project's
 * directory: the personal folder's write, or the branch's sync-commit-push cycle. Never throws.
 */
export async function withProjectData(cwd: string, message: CommitMessage, op: (dir: string) => Promise<void>, deps: ProjectDataDeps = {}): Promise<FileBranchWrite> {
  const place = await projectDataPlace(cwd, deps)
  if (place.kind === 'branch') return withFileBranch(place.repo, DATA_BRANCH, message, op, deps)
  return withPersonalFolder(place.folder, message, () => op(place.dir), deps)
}

/**
 * Apply one change as a one-shot writer (a command an agent runs): the branch's detached write
 * when the project is shared, else the personal folder's own write. Throws with the reason when
 * the change could not land.
 */
export async function writeProjectDataDetached(cwd: string, message: CommitMessage, op: (dir: string) => Promise<void>, deps: ProjectDataDeps = {}): Promise<DetachedWrite> {
  const place = await projectDataPlace(cwd, deps)
  if (place.kind === 'branch') return writeFileBranchDetached(cwd, DATA_BRANCH, message, op, deps)
  const written = await withPersonalFolder(place.folder, message, () => op(place.dir), deps)
  if (!written.ok) throw new Error(written.error)
  return { changed: written.changed }
}

/** One file of the project's data, by its path in the project's directory; `undefined` when absent. Never throws. */
export async function readProjectFile(cwd: string, rel: string, opts: { fresh?: boolean } = {}, deps: ProjectDataDeps = {}): Promise<string | undefined> {
  const place = await projectDataPlace(cwd, deps)
  if (place.kind === 'branch') return readBranchFile(cwd, DATA_BRANCH, rel, opts, deps)
  return readFile(join(place.dir, rel), 'utf8').catch(() => undefined)
}

/** The entries of one directory of the project's data, by name; `[]` when absent. Never throws. */
export async function listProjectDir(cwd: string, dir: string, opts: { fresh?: boolean } = {}, deps: ProjectDataDeps = {}): Promise<string[]> {
  const place = await projectDataPlace(cwd, deps)
  if (place.kind === 'branch') return listBranchDir(cwd, DATA_BRANCH, dir, opts, deps)
  return readdir(join(place.dir, dir)).catch((): string[] => [])
}

/** Reads of the project's data for a reader that opens many files. */
export type ProjectReader = Pick<BranchReader, 'read' | 'list'>

/**
 * Open the project's data for reading from any clone: the branch fetched once (see
 * `openBranchReader`), or the personal folder's directory as it is on disk.
 */
export async function openProjectReader(cwd: string, deps: ProjectDataDeps = {}): Promise<ProjectReader> {
  const place = await projectDataPlace(cwd, deps)
  if (place.kind === 'branch') return openBranchReader(cwd, DATA_BRANCH, deps)
  return {
    read: rel => readFile(join(place.dir, rel), 'utf8').catch(() => undefined),
    list: dir => readdir(join(place.dir, dir)).catch((): string[] => []),
  }
}

/**
 * The eager pull: a shared project's branch synced with its remote; for the personal folder,
 * nothing to sync, only the folder made on the first call. Never throws.
 */
export async function pullProjectData(cwd: string, deps: ProjectDataDeps = {}): Promise<FileBranchSync> {
  const place = await projectDataPlace(cwd, deps)
  if (place.kind === 'branch') return pullFileBranch(place.repo, DATA_BRANCH, deps)
  const made = await withPersonalFolder(place.folder, 'sync', async () => {}, deps)
  if (!made.ok) return { ok: false, error: made.error }
  return { ok: true, reach: await branchReach(place.repo, deps.git) }
}

/** Copy every file under `from` into `to`, the checkout's own `.git` aside. Nothing at `from` copies nothing. */
async function copyData(from: string, to: string): Promise<void> {
  const entries = await readdir(from).catch((): string[] => [])
  for (const name of entries) {
    if (name === '.git') continue
    await cp(join(from, name), join(to, name), { recursive: true, force: true })
  }
}

/** Delete every file under `dir`, the checkout's own `.git` aside. */
async function emptyData(dir: string): Promise<void> {
  for (const name of await readdir(dir).catch((): string[] => [])) {
    if (name !== '.git') await rm(join(dir, name), { recursive: true, force: true })
  }
}

/**
 * The person's switch: share the project, or keep it on this machine. The project's data moves to
 * the other place, so it is never kept in two: on, from the personal folder to the branch, pushed
 * at once, so a remote that refuses is said at once and the switch goes back to off with the data
 * where it was; off, from the branch's checkout back to the personal folder, nothing pushed (the
 * copy on the remote stays as it was). The branch is always locked before the personal folder.
 * On, it is sent as `account`, one of OpenAgent's own (none for a remote in a folder on this disk,
 * which asks no login); off, the account is forgotten with the switch.
 */
export async function shareProjectData(cwd: string, on: boolean, account: RemoteAccount | undefined, deps: ProjectDataDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const git = deps.git ?? nodeGitRunner()
  const repo = (await fileBranchRepo(cwd, git)) ?? cwd
  const folder = deps.folder ?? personalFolder()
  const { personal } = await projectDataDirs(repo, deps)
  if (on) {
    await writeSharing(repo, true, git)
    if (account) await writeRemoteAccount(repo, account, git)
    const sent = await withFileBranch(repo, DATA_BRANCH, 'move the records here from the personal folder', dir => copyData(personal, dir), deps)
    if (!sent.ok) {
      await writeSharing(repo, false, git)
      await clearRemoteAccount(repo, git)
      return { ok: false, error: sent.error }
    }
    const moved = await withPersonalFolder(folder, `move ${relative(personal, folder)} to its repository`, () => rm(personal, { recursive: true, force: true }), deps)
    return moved.ok ? { ok: true } : { ok: false, error: moved.error }
  }
  await writeSharing(repo, false, git)
  const kept = await withFileBranch(
    repo,
    DATA_BRANCH,
    'move the records to the personal folder',
    async dir => {
      const copied = await withPersonalFolder(folder, `move ${relative(personal, folder)} here from its repository`, () => copyData(dir, personal), deps)
      if (!copied.ok) throw new Error(copied.error)
      await emptyData(dir)
    },
    deps,
  )
  if (kept.ok) {
    await clearRemoteAccount(repo, git)
    return { ok: true }
  }
  await writeSharing(repo, true, git)
  return { ok: false, error: kept.error }
}

/** Send the shared project's data as another of OpenAgent's accounts from now on: what was not sent yet goes with the next write. */
export async function shareProjectDataAs(cwd: string, account: RemoteAccount, deps: ProjectDataDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const git = deps.git ?? nodeGitRunner()
  const repo = (await fileBranchRepo(cwd, git)) ?? cwd
  if (!(await readSharing(repo, git))) return { ok: false, error: 'the project is not shared' }
  return writeRemoteAccount(repo, account, git).then(
    () => ({ ok: true as const }),
    err => ({ ok: false as const, error: errorMessage(err) }),
  )
}

/**
 * Take the project's directory out of the personal folder, as one commit: for a person who removes
 * a project and asks for its files to go too. Answers the directory when it was there. Never throws.
 */
export async function removePersonalData(cwd: string, deps: ProjectDataDeps = {}): Promise<{ ok: true; removed?: string } | { ok: false; error: string }> {
  const folder = deps.folder ?? personalFolder()
  const { personal } = await projectDataDirs(cwd, deps)
  if (!(await stat(personal).then(() => true, () => false))) return { ok: true }
  const removed = await withPersonalFolder(folder, `remove ${relative(personal, folder)}`, () => rm(personal, { recursive: true, force: true }), deps)
  return removed.ok ? { ok: true, removed: personal } : { ok: false, error: removed.error }
}

/** A path under the personal folder as git names it. */
function relative(path: string, folder: string): string {
  return path.slice(folder.length + 1).split(sep).join('/')
}
