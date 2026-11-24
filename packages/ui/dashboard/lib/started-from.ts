import type { RunOptions } from '@openagt/hooks'
import type { AgentMeta } from '../../src/index.js'

type StartFacts = Pick<AgentMeta, 'base' | 'baseCommit'> | undefined

// The branch a run started from, as its record can vouch for it. A run told a branch has its name
// on its card, a subagent its main agent's. A run that made its own branch and was told none started
// from origin's default branch, whose name the card leaves out. A card with neither says nothing: a
// run given a branch that exists began on another run's work, and a run from before these were
// written down may have started anywhere. So does a clone with no default branch: its run started
// from whatever was checked out. Nothing is said then, never a name that may be wrong.

/**
 * What the launcher said about a run it just started, for its page until the run's record says it:
 * the record comes seconds later, and the row above the box would change under the person's eyes.
 */
export interface StartPicks {
  /** What the modules' controls picked for the run (`composer.control`). */
  options?: RunOptions
  branch?: string
  gitAccount?: string
  publish?: string
  prBase?: string
  driver?: string
  model?: string
  effort?: string
  repos?: { name: string; from: string }[]
  /** The profile the run is on, by its id. */
  profile?: string
  /** The session's picks: the plugins it goes without, by name, which of the project's own skills stay (`all`, `none`, or names; absent, its profile's). */
  pluginsWithout?: string[]
  projectSkills?: 'all' | 'none' | string[]
  /** The images the prompt went with, by the names the dashboard kept them under. */
  images?: string[]
}

/** Whether what the run started from is origin's default branch, whose name has to be read. */
export function startedFromMain(card: StartFacts): boolean {
  return card?.base === undefined && card?.baseCommit !== undefined
}

/** The branch the run started from, given the name of origin's default branch; undefined when that cannot be said. */
export function startedFromBranch(card: StartFacts, main: string | null): string | undefined {
  return card?.base ?? (startedFromMain(card) ? (main ?? undefined) : undefined)
}
