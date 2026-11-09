import { cp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { DATA_BRANCH } from './names.js'
import { errorMessage, nodeGitRunner, type GitRunner } from './git.js'
import { repositoryAddress } from './origin.js'
import { clearRemoteAccount, writeRemoteAccount, type RemoteAccount } from './remote-account.js'
import { SESSIONS_DIR, sessionsHomeOf } from './sessions.js'
import { personalFolder, withPersonalFolder, type PersonalFolderDeps } from './personal-folder.js'
import {
  branchReach,
  fileBranchPath,
  fileBranchRepo,
  listBranchDir,
  openBranchReader,
  pullFileBranch,
  readBranchFile,
  readSharing,
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

// Where a project's agent data lives. By default in the person's own folder on this machine
// (`personal-folder.ts`), each project's data under `projects/<project>/`, so adding a project puts
// nothing in its repository. A project the person shares writes to its own repository's
// `agent-data` branch instead (`file-branch.ts`), which goes to its remote. One place per project
// at a time: switching moves the data over.

/** The directory, in the personal folder, holding one directory per project. */
export const PROJECTS_DIR = 'projects'

/** Injectable seams; production takes the defaults. A project's data is in either place, so it takes the seams of both. */
export type ProjectDataDeps = FileBranchDeps & PersonalFolderDeps

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
