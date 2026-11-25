import { cp, readdir, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { clearRemoteAccount, DATA_BRANCH, nodeGitRunner, writeRemoteAccount, type RemoteAccount } from '@openagt/git-branches'
import { fileBranchRepo, personalFolder, projectDataDirs, withFileBranch, withPersonalFolder, writeSharing, type ProjectDataDeps } from '@openagt/store-filesystem'

// The Share switch of a project's data: its data moved from the person's own folder to the
// repository's `agent-data` branch, or back. Where the data is read and written once it is in
// either place is store-filesystem's (`project-data.ts`).

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

/** A path under the personal folder as git names it. */
function relative(path: string, folder: string): string {
  return path.slice(folder.length + 1).split(sep).join('/')
}
