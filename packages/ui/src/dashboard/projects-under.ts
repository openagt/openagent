import { resolve } from 'node:path'
import type { AgentMeta } from '../store/index.js'
import type { ProjectSummary } from './projects.js'

/** A project a session with no project is listed under, by its id and name. */
export interface ProjectUnder {
  id: string
  name: string
}

/** Two folders, as a repo's copy and a project name them: the same once each is made absolute and loses a trailing separator. */
const sameFolder = (a: string, b: string): boolean => resolve(a) === resolve(b)

/**
 * The projects a session with no project is listed under: each one it has a copy of (a repo
 * ticked in Context, or a project its agent brought in itself), found by the folder the copy was
 * made from. Such a session shows in each one's lists as well as in its own; it opens on its own
 * page all the same.
 */
export function projectsUnder(agent: Pick<AgentMeta, 'options'> | undefined, projects: readonly Pick<ProjectSummary, 'id' | 'name' | 'path'>[]): ProjectUnder[] {
  const repos = agent?.options?.['git-branches']?.repos
  if (!repos || repos.length === 0) return []
  return projects.filter(project => repos.some(repo => sameFolder(repo.from, project.path))).map(project => ({ id: project.id, name: project.name }))
}

/** The sessions with no project, each with the projects it is listed under ({@link projectsUnder}) on its row. */
export function withProjectsUnder(sessions: readonly AgentMeta[], projects: readonly Pick<ProjectSummary, 'id' | 'name' | 'path'>[]): AgentMeta[] {
  return sessions.map(agent => {
    const under = projectsUnder(agent, projects)
    return under.length > 0 ? { ...agent, under } : agent
  })
}
