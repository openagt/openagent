import { OPENAGENT_DIR } from '@openagt/agent-data/names'

/** The names the package hangs off. No node imports. */

/** The tool's own directory at the repository root, hidden from git by the tool itself. */
export const RUNNER_DIR = '.agent-runner'

/** Under the tool's directory: one lock and one stderr file per run. */
export const RUNS_DIR = 'runs'

/** The dashboard's directory in a project it knows: made and hidden from git when the project is added. */
export const DASHBOARD_DIR = OPENAGENT_DIR

/** Under the tool's directory: this machine's settings for the tool, the `personal:` parts. */
export const RUNNER_CONFIG = 'config.yml'
