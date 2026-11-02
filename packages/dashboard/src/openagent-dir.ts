/**
 * The directory, under a project root, that holds OpenAgent's own files.
 *
 * Its own module so every reader and writer of the directory (the hooks file, the project's saved
 * prompts, a run's card, diary and inbox) spells it the same way. The name itself is
 * `@openagt/agent-data`'s, which also makes the directory when a folder becomes a project.
 */
export { OPENAGENT_DIR } from '@openagt/agent-data/names'
