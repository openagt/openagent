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
 * The environment variable that names a running agent by its run's id, set by whoever starts the
 * run (the runner) for the agent's whole life: a ticket's claim names the agent by it, and a main
 * agent's subagents are found by it. Unlike its branch, which is renamed once the agent names its
 * session, the id does not change.
 */
export const AGENT_ID_ENV = 'AGENT_ID'

/**
 * The environment variable that names the agent a run is on, by its id (`agents/<id>.json` in the
 * personal folder): set by whoever starts the run, for that run; unset, the run is on the default
 * agent. A scheduler's runs name none.
 */
export const AGENT_ENV = 'OPENAGENT_AGENT'

/**
 * The environment variables that change the skills one run gets, a session's picks beside the
 * message box: {@link SKILLS_ON_ENV} names skills its agent lacks that it gets too, and
 * {@link SKILLS_OFF_ENV} skills of its agent's it does not get, each a comma-separated list of
 * names; {@link PROJECT_SKILLS_ENV} says which of the project's own skills stay in its checkout:
 * `all` (unset too), `none`, or their names comma-separated. Set by whoever starts the run; a
 * resumed run goes on with what its record kept.
 */
export const SKILLS_ON_ENV = 'OPENAGENT_SKILLS_ON'
export const SKILLS_OFF_ENV = 'OPENAGENT_SKILLS_OFF'
export const PROJECT_SKILLS_ENV = 'OPENAGENT_PROJECT_SKILLS'

/** Whether a word is a skill's name, as its text's front matter names it: `tickets`, `plan-tickets`. */
export function isSkillName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name)
}
