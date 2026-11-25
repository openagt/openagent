import { join, sep } from 'node:path'
import type { ProjectRef, Scope } from '@openagt/hooks'
import { personalFolder } from './personal-folder.js'

// Where each scope's files are on this computer. The person's own folder, `~/.openagent`, holds
// what is theirs and each project's data kept on this computer: what a git store may sync with a
// repository of theirs. This computer's folder sits beside it and is never synced, so nothing of
// this computer's can reach that repository, whatever a git store commits.

/** The two folders the store keeps its files in. */
export interface Folders {
  /** The person's own folder: `$XDG_CONFIG_HOME/openagent` when that is set, else `~/.openagent`. */
  personal: string
  /** This computer's own folder, beside the person's: `openagent-computer`, never synced. */
  computer: string
}

/** This computer's folders, from its environment. */
export function foldersOf(env: NodeJS.ProcessEnv = process.env): Folders {
  const personal = personalFolder(env)
  return { personal, computer: `${personal}-computer` }
}

/** Where the person's scope is in their folder. */
export const PERSON_DIR = 'person'

/** Where each project's scope is in the person's folder, one folder per project. */
export const PROJECTS_DIR = 'projects'

/** Where this computer's scope is in its folder. */
export const COMPUTER_DIR = 'data'

/** Where the saves' lock files are in this computer's folder. */
export const LOCKS_DIR = 'locks'

/**
 * The name of a project's folder: its repository's address (`github.com/me/shop`), the same on
 * every computer, or `local/` and its folder's path for a project with no remote.
 */
export function projectKey(project: ProjectRef): string {
  const key = project.remote ?? ['local', ...project.dir.split(sep)].join('/')
  return key
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .join('/')
}

/** The folder a scope's files are in. */
export function scopeFolder(scope: Scope, folders: Folders): string {
  if (scope.kind === 'person') return join(folders.personal, PERSON_DIR)
  if (scope.kind === 'computer') return join(folders.computer, COMPUTER_DIR)
  return join(folders.personal, PROJECTS_DIR, ...projectKey(scope.project).split('/'))
}

/** The lock file a scope's saves take: in this computer's folder, never in one a git store syncs. */
export function lockFile(scope: Scope, folders: Folders): string {
  const name = scope.kind === 'project' ? join(PROJECTS_DIR, ...projectKey(scope.project).split('/')) : scope.kind
  return join(folders.computer, LOCKS_DIR, `${name}.lock`)
}
