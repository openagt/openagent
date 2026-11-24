import { join } from 'node:path'
import { checkoutRoot, nodeGitRunner, sessionFolder, type GitRunner } from '@openagt/agent-data'
import { agentBranchName } from './branch-names.js'
import { addSessionRepos, foundCopies } from './session-folder.js'

/**
 * A project the person has, which a session may bring in itself (Auto): its name, as the person
 * knows it, and its folder on this computer.
 */
export interface SessionProject {
  name: string
  dir: string
}

/** The agent's environment: the projects its session may bring in, as a JSON list of {@link SessionProject}. */
export const PROJECTS_ENV = 'OPENAGENT_PROJECTS'

/** The agent's environment: its session's id, whose folder `add` copies a project into. */
export const SESSION_ENV = 'OPENAGENT_SESSION'

/** The projects an environment hands the agent: none for anything that is not such a list. */
export function projectsOf(env: Readonly<Record<string, string | undefined>>): SessionProject[] {
  const list = ((): unknown => {
    try {
      return JSON.parse(env[PROJECTS_ENV] ?? '')
    } catch {
      return undefined
    }
  })()
  if (!Array.isArray(list)) return []
  return list.flatMap(one => (one && typeof one === 'object' && typeof one.name === 'string' && typeof one.dir === 'string' ? [{ name: one.name as string, dir: one.dir as string }] : []))
}

/** What `add` comes to: the copy of the project in the session's folder, made now or already there; or why none. */
export type AddOutcome =
  | { ok: true; project: string; copy: string; branch: string; existing: boolean }
  | { ok: false; reason: 'no-session' }
  | { ok: false; reason: 'unknown-project'; project: string; projects: string[] }

/**
 * Bring the project named `name` into the session `id`: a copy of its folder in the session's folder,
 * made as a repo ticked in Context is ({@link addSessionRepos}). The name is the person's, matched
 * without regard to case; a project the session has a copy of already is answered as it is.
 */
export async function addProject(home: string, id: string | undefined, projects: readonly SessionProject[], name: string, git: GitRunner = nodeGitRunner()): Promise<AddOutcome> {
  if (id === undefined || id === '') return { ok: false, reason: 'no-session' }
  const wanted = name.trim().toLowerCase()
  const project = projects.find(one => one.name.toLowerCase() === wanted)
  if (!project) return { ok: false, reason: 'unknown-project', project: name, projects: projects.map(one => one.name) }
  const branch = agentBranchName(id)
  const have = await foundCopies(home, id, [], git)
  const root = await checkoutRoot(project.dir, git)
  const there = have.find(repo => repo.from === root)
  if (there) return { ok: true, project: project.name, copy: join(sessionFolder(home, id), there.name), branch, existing: true }
  const { added } = await addSessionRepos(home, id, have, [project.dir], git)
  return { ok: true, project: project.name, copy: join(sessionFolder(home, id), added[0]!.name), branch, existing: false }
}

/** The line a refusal of `add` says. */
export function addRefusalLine(outcome: Extract<AddOutcome, { ok: false }>): string {
  if (outcome.reason === 'no-session') return `add runs in a session OpenAgent started: ${SESSION_ENV} names none`
  return outcome.projects.length === 0 ? `no project named ${outcome.project}: this session was handed none` : `no project named ${outcome.project}; the projects are ${outcome.projects.join(', ')}`
}
