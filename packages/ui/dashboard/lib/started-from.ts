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
  branch?: string
  gitAccount?: string
  publish?: string
  prBase?: string
  driver?: string
  model?: string
  effort?: string
  repos?: { name: string; from: string }[]
  /** The agent the run is on, by its id. */
  agent?: string
  /** The session's picks of skills: names on top of its agent's, names of its agent's left out, which of the project's own stay (`none`, or names; absent, every one). */
  skillsOn?: string[]
  skillsOff?: string[]
  projectSkills?: 'none' | string[]
}

/** Whether what the run started from is origin's default branch, whose name has to be read. */
export function startedFromMain(card: StartFacts): boolean {
  return card?.base === undefined && card?.baseCommit !== undefined
}

/** The branch the run started from, given the name of origin's default branch; undefined when that cannot be said. */
export function startedFromBranch(card: StartFacts, main: string | null): string | undefined {
  return card?.base ?? (startedFromMain(card) ? (main ?? undefined) : undefined)
}
