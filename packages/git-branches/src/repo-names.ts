// How a session's repos are named in its folder, by whoever writes the run's options: the launcher's
// Context picker in the browser, the `run --repos` command. Node-free, so both name them alike.

/** A repo a session has as context: the folder it is copied from, and the name of its copy in the session's folder. */
export interface SessionRepo {
  name: string
  from: string
}

/** A folder's own name, the last part of its path. */
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
}

/** Whether `name` can name a copy in a session's folder: one folder's own name, never a path, none of the folder's dot-entries (the run's live record is one). */
export function isCopyName(name: unknown): name is string {
  return typeof name === 'string' && /^[^./\\][^/\\]*$/.test(name)
}

/**
 * The repos for these top folders of repositories, each named by its folder's name, a name two of
 * them share told apart by a number (`app`, `app-2`). The same folders in the same order answer
 * the same names; a folder given twice counts once.
 */
export function nameRepos(folders: readonly string[]): SessionRepo[] {
  const repos: SessionRepo[] = []
  for (const from of folders) {
    if (repos.some(repo => repo.from === from)) continue
    const name = folderName(from)
    let shown = name
    for (let n = 2; repos.some(repo => repo.name === shown); n++) shown = `${name}-${n}`
    repos.push({ name: shown, from })
  }
  return repos
}
