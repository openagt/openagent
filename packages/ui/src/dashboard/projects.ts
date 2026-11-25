import { basename } from 'node:path'
import { type ProjectRecord, projectNameOf, repositoryAddress, sessionsHome } from '@openagt/hooks'
import { listProjects } from '../distribution-hooks.js'
import { nodeFs } from '../node-fs.js'
import { readRuns, type AgentMeta } from '../store/index.js'
import { contextHosts } from '../dashboard-rpc/context.js'
import type { ProjectError, ProjectNote } from '../project-state.js'
import { SESSIONS_ID } from '../project-address.js'

/**
 * The multi-project read side (#392): projects the daemon serves come from the list the projects
 * module keeps (`PROJECTS`), and every read resolves a project id to that project's path before running the per-cwd reader
 * underneath. One daemon serves them all, running as many agents per project as their own
 * concurrency allows (#736), each in its own checkout.
 */

/** One project's summary for the Projects sidebar (#314). */
export interface ProjectSummary {
  /** Its id on the list (stable, URL-safe). */
  id: string
  /** Absolute repo path. */
  path: string
  /** Display name (the path's basename). */
  name: string
  /** Its repository's address, origin's (`git.example.com/me/shop`), as the hooks name it; none for a project with no remote. */
  remote?: string
  /** ISO timestamp of the project's newest activity: its most recent session. */
  lastActivityAt?: string
  /**
   * What the person has to fix in the project (#1500), as the modules on in it say — absent when
   * nothing is. Not part of the summary itself: the dashboard's project list attaches it
   * (`project-state.ts`).
   */
  errors?: ProjectError[]
  /**
   * How the project stands where nothing is wrong with it, as the modules on in it note it under
   * its name: why its data stays on this machine, say. Absent when none says anything; attached
   * like `errors`.
   */
  notes?: ProjectNote[]
}

/**
 * A projection over the registered projects, together with the projects it could actually see.
 *
 * A project whose sources cannot be read contributes no items — which is exactly what a project
 * with nothing waiting contributes. `whole` is what tells the two apart (#1623). Only a caller
 * that keeps a baseline of what it has already announced needs the distinction; the panels that
 * simply render the list read `items` and ignore it.
 */
export interface ProjectionRead<T> {
  /** What was found. Possibly only part of it, when some project could not be read. */
  items: T[]
  /** The ids of the projects every source answered for, so their share of `items` is all of it. */
  whole: string[]
}

/** Injectable readers so {@link summarizeProject} is unit-testable off disk. */
export interface SummarizeDeps {
  /** The project's runs, newest-first: its hosts' by default. */
  readAgents?: (record: ProjectRecord) => Promise<AgentMeta[]>
  /** The project's name. Defaults to {@link projectNameOf}: its repository's. */
  name?: (path: string) => Promise<string>
  /** Its repository's address. Defaults to {@link repositoryAddress}: origin's. */
  remote?: (path: string) => Promise<string | undefined>
}

/**
 * Derive a {@link ProjectSummary} from a record of the list: its name (its repository's), its
 * repository's address, and its last activity. Forgiving: a failed read reads as a project with
 * no activity, never a throw.
 *
 * Activity is the sessions themselves (B3). It used to be the newest of those and the latest
 * `LOGS.md` entry — a committed markdown re-narration of the same sessions, which could only ever
 * be older than the agent it described.
 */
export async function summarizeProject(record: ProjectRecord, deps: SummarizeDeps = {}): Promise<ProjectSummary> {
  const loadAgents = deps.readAgents ?? (project => readRuns(contextHosts(), { id: project.id, name: basename(project.path), dir: project.path }))
  const agents = await loadAgents(record).catch(() => [] as AgentMeta[])
  // ISO timestamps sort chronologically.
  const agentActivity = agents.map(r => r.updatedAt || r.startedAt).filter(Boolean)
  const lastActivityAt = agentActivity.filter((a): a is string => !!a).sort().at(-1)
  const summary: ProjectSummary = {
    id: record.id,
    path: record.path,
    name: await (deps.name ?? projectNameOf)(record.path).catch(() => basename(record.path)),
  }
  if (lastActivityAt) summary.lastActivityAt = lastActivityAt
  const remote = await (deps.remote ?? (path => repositoryAddress(path)))(record.path).catch(() => undefined)
  if (remote !== undefined) summary.remote = remote
  return summary
}

/**
 * Reads the list of projects to serve the multi-project endpoints. The dashboard server
 * holds one of these; the daemon uses the default (the real list), tests pass
 * a fake so the server is exercised without touching the person's list.
 */
export interface ProjectsProvider {
  /** Every registered project, summarized, for the projects read. */
  list(): Promise<ProjectSummary[]>
  /** The absolute path for a project's id, or `undefined` when unknown. */
  resolvePath(id: string): Promise<string | undefined>
}

/** Injectable readers so {@link defaultProjectsProvider} is unit-testable off the person's list. */
export interface ProviderDeps {
  /** The list's records. Defaults to {@link listProjects}. */
  listRecords?: () => Promise<ProjectRecord[]>
  /** Whether a project's directory is on disk. Defaults to a directory stat. */
  isDirectory?: (path: string) => Promise<boolean>
  /** Defaults to {@link summarizeProject}. */
  summarize?: (record: ProjectRecord) => Promise<ProjectSummary>
}

/**
 * A {@link ProjectsProvider} backed by the list of projects on this computer (#390).
 *
 * Only projects whose directory is still on disk are served (#1140): a repo the user renamed or
 * deleted used to stay in the sidebar as a grey "not activated" entry with no files (#1142),
 * indistinguishable from a repo that merely lost its marker, and with nothing to click to make it
 * go away. The list itself is left alone — the record is skipped, not pruned — so a directory
 * that comes back (renamed back, a volume remounted) is a project again on the next read.
 */
export function defaultProjectsProvider(deps: ProviderDeps = {}): ProjectsProvider {
  const listRecords = deps.listRecords ?? (() => listProjects())
  const isDirectory = deps.isDirectory ?? nodeFs().isDirectory
  const summarize = deps.summarize ?? (record => summarizeProject(record))
  const present = async (): Promise<ProjectRecord[]> => {
    const records = await listRecords()
    const kept = await Promise.all(records.map(async record => ((await isDirectory(record.path).catch(() => false)) ? record : undefined)))
    return kept.filter((record): record is ProjectRecord => record !== undefined)
  }
  return {
    async list() {
      return Promise.all((await present()).map(summarize))
    },
    async resolvePath(id) {
      // The sessions with no project work in the sessions home, as a project's runs work in its folder.
      if (id === SESSIONS_ID) return sessionsHome()
      return (await present()).find(record => record.id === id)?.path
    },
  }
}
