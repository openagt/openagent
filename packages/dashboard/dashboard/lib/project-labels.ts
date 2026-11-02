import { createContext, useContext } from 'react'

// How the dashboard names a project wherever it lists one or says which is picked (#2142). A
// project's name is its folder's, so two clones called `shop` both read "shop": where names clash,
// each says as many of its parent folders as it takes to tell it from the others (`work/shop`,
// `clients/shop`). A name no other project has stays as it is. Only how a project is shown: its
// address tells the clones apart its own way (`src/project-address.ts`).

/** A registered project as far as its label goes. */
export interface Labeled {
  id: string
  name: string
  path: string
}

/** Each project's label, by id: its name, or the end of its path that no other project of the same name shares. */
export function projectLabels(projects: readonly Labeled[]): Map<string, string> {
  const byName = new Map<string, Labeled[]>()
  for (const project of projects) byName.set(project.name, [...(byName.get(project.name) ?? []), project])
  const labels = new Map<string, string>()
  for (const project of projects) {
    const others = byName.get(project.name)!.filter(other => other !== project)
    labels.set(project.id, others.length === 0 ? project.name : distinctEnd(project, others))
  }
  return labels
}

/** The fewest last folders of `project`'s path that none of `others` ends with, else its whole path. */
function distinctEnd(project: Labeled, others: readonly Labeled[]): string {
  const own = folders(project.path)
  const theirs = others.map(other => folders(other.path))
  for (let depth = 2; depth <= own.length; depth++) {
    const end = own.slice(-depth).join('/')
    if (theirs.every(path => path.slice(-depth).join('/') !== end)) return end
  }
  return project.path
}

/** A path's folders, Windows' or POSIX's. */
function folders(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean)
}

/** The labels of the registered projects, worked out once by the shell. */
export const ProjectLabelsContext = createContext<ReadonlyMap<string, string>>(new Map())

/** How to name a project: its label, or `name` for a project the shell has no label for. */
export function useProjectLabel(): (projectId: string, name: string) => string {
  const labels = useContext(ProjectLabelsContext)
  return (projectId, name) => labels.get(projectId) ?? name
}
