import { branchReach, type BranchReach } from '@openagt/agent-data'
import type { Hooks } from '@openagt/hooks'
import { cachedRead } from './dashboard/cache.js'
import { distributionHooks, projectRefAt } from './distribution-hooks.js'

/**
 * What a project's page and its row in the picker say of it beside its runs (#1500): what the
 * person has to fix there, and why its data stays on this computer, if it does. Read as the
 * projects are, from what knows it: the modules on in the project say what needs setting up
 * (the `setup` items of `app.attention`: a shared project whose data does not converge with its
 * remote is one, #1599), and its clone whether it shares its data. ui keeps none of it
 * and runs no clock for it (#2394, decision 17): a module's own timer finds what it says.
 */

/** Something in the project the person has to fix: the way to make it go is to fix what it names. */
export interface ProjectError {
  /** Which it is, among the project's: the module's and its item's (`<module>:<item>`). */
  id: string
  /** What is wrong, in a few words. */
  title: string
  /** The detail: what the failing command said, in the words the person would see running it by hand. */
  message?: string
  /** Since when, where it is said: a week-old failure does not read like a blip that will pass. */
  since?: string
}

/** Why a project's data stays on this computer: its repository has no origin, or the person keeps it here. */
export type StaysLocal = Exclude<BranchReach, 'origin'>

/** What the dashboard shows of a project beside its summary. */
export interface ProjectState {
  errors: ProjectError[]
  local?: StaysLocal
}

/** A project's state, by its id and folder. */
export type ProjectStateReader = (project: { id: string; path: string }) => Promise<ProjectState>

/** Where {@link readProjectState} reads, each replaceable in a test. */
export interface ProjectStateDeps {
  hooks?: () => Promise<Hooks>
  reach?: (path: string) => Promise<BranchReach>
}

/** A project's state as it is now. Never throws: what cannot be read says nothing. */
export async function readProjectState(project: { id: string; path: string }, deps: ProjectStateDeps = {}): Promise<ProjectState> {
  const [errors, reach] = await Promise.all([
    setupOf(project, deps.hooks ?? (() => distributionHooks())),
    (deps.reach ?? (path => branchReach(path)))(project.path).catch((): BranchReach => 'origin'),
  ])
  return { errors, ...(reach !== 'origin' ? { local: reach } : {}) }
}

/** What the modules on in the project say needs setting up, asked about it. */
async function setupOf(project: { id: string; path: string }, hooks: () => Promise<Hooks>): Promise<ProjectError[]> {
  try {
    const { items } = await (await hooks()).attention({ project: await projectRefAt(project.id, project.path) })
    return items.flatMap(item =>
      item.kind === 'setup'
        ? [{ id: `${item.module}:${item.id ?? item.words}`, title: item.words, ...(item.detail !== undefined ? { message: item.detail } : {}), ...(item.since !== undefined ? { since: item.since } : {}) }]
        : [],
    )
  } catch {
    return []
  }
}

/** How old a project's state may be before it is read again, in the background while the last one answers. */
const STATE_TTL_MS = 30_000
/** How long a project's first read is waited for before the list answers without it. */
const FIRST_READ_MS = 2_000

/**
 * The daemon's reader: each project's state through the dashboard's read cache (`cache.ts`), so the
 * list of projects, which the page also asks every five seconds to know OpenAgent answers, answers
 * at once, and each state is read again at most every half a minute.
 */
export function projectStateReader(deps: ProjectStateDeps = {}): ProjectStateReader {
  return async project => (await cachedRead(`project-state:${project.path}`, () => readProjectState(project, deps), { ttlMs: STATE_TTL_MS, budgetMs: FIRST_READ_MS })).value ?? { errors: [] }
}
