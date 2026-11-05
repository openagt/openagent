/**
 * The one name the package hangs off. No node imports, so browser-side code can name it too.
 *
 * The queue's place is not named here: `@openagt/agent-data` knows the project's data directory (in
 * the person's own folder, or the project's `agent-data` branch when shared).
 */

/** The agent queue: `TODO_AGENTS.md` at the root of the project's data. */
export const QUEUE_FILE = 'TODO_AGENTS.md'
