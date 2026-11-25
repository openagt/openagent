import { OPENAGENT_DIR } from '@openagt/hooks'

/** The names the package hangs off, and the environment a run is started with. */

/** The tool's own directory at the repository root, hidden from git by the tool itself. */
export const RUNNER_DIR = '.agent-runner'

/** Under the tool's directory: one lock and one stderr file per run. */
export const RUNS_DIR = 'runs'

/** The dashboard's directory in a project it knows: made and hidden from git when the project is added. */
export const DASHBOARD_DIR = OPENAGENT_DIR

/** Under the tool's directory: this machine's settings for the tool, the `personal:` parts. */
export const RUNNER_CONFIG = 'config.yml'

/**
 * The environment variable that names a running agent by its run's id, set by whoever starts the
 * run (the runner) for the agent's whole life: a ticket's claim names the agent by it, and a main
 * agent's subagents are found by it. Unlike its branch, which is renamed once the agent names its
 * session, the id does not change.
 */
export const AGENT_ID_ENV = 'AGENT_ID'

/**
 * The environment variable that names the profile a run is on, by its id (the catalog's
 * `profiles.saved`): set by whoever starts the run, for that run; unset, the run is on Default. A
 * scheduler's runs name none.
 */
export const PROFILE_ENV = 'OPENAGENT_PROFILE'

/**
 * The environment variables that change what one run gets, a session's picks beside the message
 * box: {@link PLUGINS_WITHOUT_ENV} names the enabled plugins it goes without, comma-separated, and
 * {@link PROJECT_SKILLS_ENV} says which of the project's own skills stay in its checkout: `all`
 * (unset too), `none`, or their names comma-separated. Set by whoever starts the run; a resumed
 * run goes on with what its record kept.
 */
export const PLUGINS_WITHOUT_ENV = 'OPENAGENT_PLUGINS_WITHOUT'
export const PROJECT_SKILLS_ENV = 'OPENAGENT_PROJECT_SKILLS'

/** Whether a word is a skill's name, as its text's front matter names it: `tickets`, `plan-tickets`. */
export function isSkillName(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name)
}
