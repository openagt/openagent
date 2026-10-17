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

/**
 * The directory, under a project root, that holds OpenAgent's own files on this machine: the
 * hooks file, a run's live files. Hidden from git by an ignore file of its own, written when the
 * folder becomes a project (`install.ts`).
 */
export const OPENAGENT_DIR = '.openagent'

/**
 * The environment variable that names the skills every run gets: the directories of their
 * packages, joined by the path delimiter. Set by the package that starts OpenAgent
 * (`@openagt/start`), which owns the list, and inherited by every process OpenAgent starts: a
 * hook line, the runner, the scheduler, an agent and the runs its subagents start. Unset, a run
 * gets none of them.
 */
export const SKILLS_ENV = 'OPENAGENT_SKILLS'
