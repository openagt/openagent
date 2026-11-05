/**
 * The one name the package hangs off. No node imports, so browser-side code can name it too.
 *
 * Where the runs are is not named here: `@openagt/agent-data` knows the project's data directory (in
 * the person's own folder, or the project's `agent-data` branch when shared).
 */

/** Where the runs live: `agents/<who>/<id>.json` and `<id>.jsonl` in the project's data directory. */
export const RUNS_DIR = 'agents'
