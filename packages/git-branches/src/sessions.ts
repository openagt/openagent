import { readdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { sessionsHome, type GitRunner } from '@openagt/hooks'
import { checkoutRoot, nodeGitRunner } from './git.js'

// Sessions with no project. A session that is not tied to a project works in a folder of its own,
// `<sessions home>/<id>/` (the home is the kernel's, `@openagt/hooks`' `sessionsHome`), which holds
// copies of the repos it picked (`session-folder.ts`), and its record is kept in the personal
// folder's `sessions/` directory (store-filesystem's `project-data.ts`), which has the shape a
// project's data directory has.

/** One session's own folder in the home. */
export function sessionFolder(home: string, id: string): string {
  return join(home, id)
}

/** A path as the disk names it, the links in it followed; as given when it is not there. */
function onDisk(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path))
}

/** The sessions home when `cwd` is it or is in it, as {@link sessionsHome} names it; nothing for any other folder. Never throws. */
export async function sessionsHomeOf(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const home = sessionsHome(env)
  const [at, of] = await Promise.all([onDisk(cwd), onDisk(home)])
  return at === of || at.startsWith(of + sep) ? home : undefined
}

/** The folder whose runs a command started in `cwd` is about: the sessions home when `cwd` is in it, else the root of the git checkout `cwd` is in. Throws git's error outside both. */
export async function runsRootOf(cwd: string, git: GitRunner = nodeGitRunner()): Promise<string> {
  return (await sessionsHomeOf(cwd)) ?? checkoutRoot(cwd, git)
}

/** Every session folder in the home, by the session's id: its directories, the hidden ones aside. `[]` when there is no home yet. */
export async function listSessionFolders(home: string): Promise<{ id: string; path: string }[]> {
  const entries = await readdir(home, { withFileTypes: true }).catch(() => [])
  return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => ({ id: entry.name, path: sessionFolder(home, entry.name) }))
}
