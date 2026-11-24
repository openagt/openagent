import { createContext, useContext } from 'react'
import type { ProjectSummary } from '../../src/index.js'

// The projects the shell lists, as a module's piece reads them (the project picker): the list the
// sidebar shows, given by the app around every page. A module that changes the list (the projects
// module, adding or removing one) says so here, and the shell reads it again at once rather than at
// its next poll; a project removed while its page is shown sends the page to every project's.

/** The projects the shell lists, in the list's order, each with what its row says of it. */
export const ShellProjectsContext = createContext<readonly ProjectSummary[]>([])

/** The projects the shell lists now. */
export function useProjects(): readonly ProjectSummary[] {
  return useContext(ShellProjectsContext)
}

/** What changed in the list: a project removed, by its id, or one added. */
export type ProjectsChange = { removed: string } | { added: true }

const listeners = new Set<(change: ProjectsChange) => void>()

/** Tell the shell the list of projects changed: it reads the list again, and leaves the page of a project removed. */
export function projectsChanged(change: ProjectsChange): void {
  for (const listener of [...listeners]) listener(change)
}

/** For the shell: be told each time a module changed the list of projects. */
export function onProjectsChanged(listener: (change: ProjectsChange) => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
