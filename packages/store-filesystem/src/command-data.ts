import { checkoutRoot } from '@openagt/git-branches'
import { inRepo } from '@openagt/hooks/command'
import type { GitRunner } from '@openagt/hooks'
import type { CommitMessage } from './file-branch.js'
import { listProjectDir, openProjectReader, readProjectFile, writeProjectDataDetached, type ProjectReader } from './project-data.js'

// A module's command reading and writing the project's data, from wherever in the repository it
// runs, as the command conventions say (`@openagt/hooks/command`): outside a repository, the
// not-a-repo refusal.

/**
 * The project's data opened for a command's reads, from wherever in the repository the command
 * runs; outside one, the not-a-repo refusal. Origin's copy, fetched first, so a command sees what
 * every writer pushed; or with `local` this machine's copy with no fetch, for the dashboard's polling.
 */
export async function commandReader(cwd: string, local: boolean | undefined, git: GitRunner): Promise<ProjectReader> {
  await inRepo(() => checkoutRoot(cwd, git))
  if (!local) return openProjectReader(cwd, { git })
  return { read: rel => readProjectFile(cwd, rel, {}, { git }), list: dir => listProjectDir(cwd, dir, {}, { git }) }
}

/**
 * One write by a command, as a one-shot writer: to origin when the project is shared, else a local
 * commit; outside a repository, the not-a-repo refusal. Answers what `op` found the last time it
 * ran: a write that loses a race runs it again on the new tip, and only that run's finding landed.
 */
export async function commandWrite<T>(cwd: string, message: CommitMessage, op: (dir: string) => Promise<T>, git: GitRunner): Promise<T> {
  await inRepo(() => checkoutRoot(cwd, git))
  let found: T | undefined
  await writeProjectDataDetached(cwd, message, async dir => {
    found = await op(dir)
  }, { git })
  return found as T
}
