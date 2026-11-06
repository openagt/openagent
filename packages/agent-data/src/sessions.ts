import { readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { checkoutRoot, nodeGitRunner, type GitRunner } from './git.js'

// Sessions with no project. A session that is not tied to a project works in a folder of its own,
// `<sessions home>/<id>/`, and its record is kept in the personal folder's `sessions/` directory,
// which has the shape a project's data directory has. The home sits beside the personal folder,
// not in it: the personal folder is committed whole and synced to the person's repository, and a
// session's folder holds its work, not its record.

/** The directory, in the personal folder, holding the records of the sessions with no project. */
export const SESSIONS_DIR = 'sessions'

/** Where the sessions with no project work: `$XDG_CONFIG_HOME/openagent-sessions` when that is set, beside the personal folder, else `~/.openagent-sessions`. */
export function sessionsHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'openagent-sessions')
  return join(env.HOME || homedir(), '.openagent-sessions')
}

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
