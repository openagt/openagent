import { basename } from 'node:path'
import { listProjects, type ProjectRecord } from '../registry.js'
import { nodeFs } from '../node-fs.js'
import { isActivated } from '../project.js'
import { readAllAgents, type AgentMeta } from '../store/index.js'
import type { ProjectError, StaysLocal } from '../project-errors.js'
import { projectGitHost, type GitHostFor } from '../store/git-host.js'

/**
 * The multi-project read side (#392): projects the daemon serves come from the registry (#390),
 * and every read resolves a project id to that project's path before running the per-cwd reader
 * underneath. One daemon serves them all, running as many agents per project as their own
 * concurrency allows (#736), each in its own checkout.
 */

/** One project's summary for the Projects sidebar (#314). */
export interface ProjectSummary {
  /** Registry id (stable, URL-safe). */
  id: string
  /** Absolute repo path: on the computer the project is on. */
  path: string
  /**
   * The saved machine the project is on, when it is not on this computer (elsewhere.ts): what the
   * page asks of it is asked there, and a run of it starts there unless another computer is picked.
   */
  machine?: string
  /** Display name (the path's basename). */
  name: string
  /** True when the repo still has its `.openagent/` marker. */
  activated: boolean
  /** Whether one of the project's packages provides a git host; without one no pull request can be opened there. */
  gitHost: boolean
  /** ISO timestamp of the project's newest activity: its most recent session. */
  lastActivityAt?: string
  /**
   * What the daemon's background jobs currently find wrong with the project (#1500), oldest
   * first — absent when nothing is. Not part of the summary itself: the dashboard's project
   * list attaches it from the daemon's error state.
   */
  errors?: ProjectError[]
  /**
   * Why the project's data stays on this machine, as the daemon's last data sync found it: its
   * repository has no remote, or the person keeps the agents' records here. Nothing is wrong.
   * Absent for a project that shares them; attached like `errors`.
   */
  local?: StaysLocal
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
  isActivated?: (path: string) => Promise<boolean>
  /** The project's runs (live + archived), newest-first. Defaults to {@link readAllAgents}. */
  readAgents?: (path: string) => Promise<AgentMeta[]>
  /** The project's git host. Defaults to {@link projectGitHost}. */
  gitHost?: GitHostFor
}

/** A project's runs, live prepended to the archived history. Forgiving: a failed read is `[]`. */
/**
 * Derive a {@link ProjectSummary} from a registry record: its display name, whether
 * it is still activated, and its last activity. Forgiving: a failed read reads as an
 * inactive project with no activity, never a throw.
 *
 * Activity is the sessions themselves (B3). It used to be the newest of those and the latest
 * `LOGS.md` entry — a committed markdown re-narration of the same sessions, which could only ever
 * be older than the agent it described.
 */
export async function summarizeProject(record: ProjectRecord, deps: SummarizeDeps = {}): Promise<ProjectSummary> {
  const checkActivated = deps.isActivated ?? isActivated
  const loadAgents = deps.readAgents ?? readAllAgents
  const activated = await checkActivated(record.path).catch(() => false)
  const agents = await loadAgents(record.path).catch(() => [] as AgentMeta[])
  // ISO timestamps sort chronologically.
  const agentActivity = agents.map(r => r.updatedAt || r.startedAt).filter(Boolean)
  const lastActivityAt = agentActivity.filter((a): a is string => !!a).sort().at(-1)
  const summary: ProjectSummary = {
    id: record.id,
    path: record.path,
    name: basename(record.path),
    activated,
    gitHost: (await (deps.gitHost ?? projectGitHost)(record.path).catch(() => undefined)) !== undefined,
  }
  if (lastActivityAt) summary.lastActivityAt = lastActivityAt
  return summary
}

/**
 * Reads the registry to serve the multi-project endpoints. The dashboard server
 * holds one of these; the daemon uses the default (the real registry), tests pass
 * a fake so the server is exercised without touching the user's registry.
 */
export interface ProjectsProvider {
  /** Every registered project, summarized, for the projects read. */
  list(): Promise<ProjectSummary[]>
  /** The absolute path for a registry id, or `undefined` when unknown. */
  resolvePath(id: string): Promise<string | undefined>
}

/** Injectable readers so {@link defaultProjectsProvider} is unit-testable off the user's registry. */
export interface ProviderDeps {
  /** The registry's records. Defaults to {@link listProjects}, forgiving. */
  listRecords?: () => Promise<ProjectRecord[]>
  /** Whether a project's directory is on disk. Defaults to a directory stat. */
  isDirectory?: (path: string) => Promise<boolean>
  /** Defaults to {@link summarizeProject}. */
  summarize?: (record: ProjectRecord) => Promise<ProjectSummary>
}

/**
 * A {@link ProjectsProvider} backed by the global registry (#390).
 *
 * Only projects whose directory is still on disk are served (#1140): a repo the user renamed or
 * deleted used to stay in the sidebar as a grey "not activated" entry with no files (#1142),
 * indistinguishable from a repo that merely lost its marker, and with nothing to click to make it
 * go away. The registry itself is left alone — the record is skipped, not pruned — so a directory
 * that comes back (renamed back, a volume remounted) is a project again on the next read.
 */
export function defaultProjectsProvider(deps: ProviderDeps = {}): ProjectsProvider {
  const listRecords = deps.listRecords ?? (() => listProjects().catch(() => []))
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
      return (await present()).find(record => record.id === id)?.path
    },
  }
}
