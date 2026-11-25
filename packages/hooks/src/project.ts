/** A project, as a hook is given it. */
export interface ProjectRef {
  /** The registry's id for it. */
  id: string
  /** Its name, as a person reads it. */
  name: string
  /** Its folder on this computer: the clone's own, never one of its worktrees. */
  dir: string
  /**
   * Its repository's address, origin's, as OpenAgent names a repository on every computer:
   * `host/path` in lower case (`github.com/me/shop`). None for a project with no remote, which
   * stays on this computer.
   */
  remote?: string
}

/**
 * The directory, under a project root, that holds OpenAgent's own files on this machine: a run's
 * live files, a module's own. Hidden from git by an ignore file of its own, written when the folder
 * becomes a project (projects' `install.ts`).
 */
export const OPENAGENT_DIR = '.openagent'
