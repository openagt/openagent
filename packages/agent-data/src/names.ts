/**
 * The names every consumer of the package hangs off. Pure: no node imports, so browser-side
 * code can name them too.
 */

/**
 * Where a project's checkouts live: `<repo>/.branches/`, one directory per checkout, each named
 * as the branch it is on — the data branch's persistent checkout beside the agents' own. Dotted
 * on purpose: a `*` glob does not match a leading dot, so type-checkers, test runners and
 * formatters run in the project never descend into N copies of the repository.
 */
export const BRANCHES_DIR = '.branches'

/**
 * The shared data branch of a project: the one branch every skill keeps its files on, a path per
 * skill, checked out once at `.branches/agent-data`. Named here, once, for every consumer to
 * import — never spelled out again.
 */
export const DATA_BRANCH = 'agent-data'

/** Where a clone keeps origin's copy of its branches. */
const ON_ORIGIN = 'refs/remotes/origin/'

/**
 * How a run is told to start from a branch as origin has it, rather than as this clone does: the
 * full name of origin's copy, the one spelling a branch of this clone cannot be taken for. What
 * hands it to `git worktree add` fetches that copy first.
 */
export function publishedBase(branch: string): string {
  return `${ON_ORIGIN}${branch}`
}

/** The branch's name a {@link publishedBase} is of, as a person reads it; nothing for a base that is a branch of this clone. */
export function publishedBranch(base: string): string | undefined {
  return base.startsWith(ON_ORIGIN) ? base.slice(ON_ORIGIN.length) : undefined
}

/**
 * The directory, under a project root, that holds OpenAgent's own files on this machine: the
 * hooks file, a run's live files. Hidden from git by an ignore file of its own, written when the
 * folder becomes a project (`install.ts`).
 */
export const OPENAGENT_DIR = '.openagent'

/**
 * The environment variable that names the skills every run gets: the directories of their
 * packages, joined by the path delimiter. Set by the command that starts OpenAgent
 * (`@openagt/dashboard`), which owns the list, and inherited by every process OpenAgent starts: a
 * hook line, the runner, the scheduler, an agent and the runs its subagents start. Unset, a run
 * gets none of them.
 */
export const SKILLS_ENV = 'OPENAGENT_SKILLS'

/**
 * The environment variable that names every skill OpenAgent carries, beside the ones every run
 * gets: the directories of their packages, joined by the path delimiter. Set with {@link SKILLS_ENV}
 * by the same command, so a run on an agent that names a skill finds its text and its package here.
 */
export const SKILL_CATALOGUE_ENV = 'OPENAGENT_SKILL_CATALOGUE'

/**
 * The environment variable that names the agent a run is on, by its id (`agents/<id>.json` in the
 * personal folder): set by whoever starts the run, for that run; unset, the run is on the default
 * agent. A scheduler's runs name none.
 */
export const AGENT_ENV = 'OPENAGENT_AGENT'
