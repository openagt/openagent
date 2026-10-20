import { rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { nodeGitRunner, removeOwnDirectory, type GitRunner, type KeptEntry } from '@openagt/agent-data'
import { isPidAlive } from '@openagt/agent-runner'
import { OWN_AUTOMATIONS_DIR, SCHEDULER_LOG, STATE_DIR, STATE_FILE } from './names.js'
import { readState } from './state.js'

/**
 * `cleanup`: what this tool left in a project, removed, for a person who takes the project out of
 * a dashboard and asks for the tools' files to go too. The tool removes its own and nothing else:
 * a dashboard asks for it by the `cleanup` kind the package declares under `openagent` in its
 * package.json, and holds no list of this tool's files.
 *
 * What goes is the state file and the scheduler's log, then the directory once it is empty, then
 * the rule hiding it from git (`removeOwnDirectory`). The automations a person keeps on this
 * machine stay: they are the person's own writing and exist nowhere else, so the directory and its
 * rule stay with them, and the answer names them among what was kept. Their folder, once empty,
 * goes like the rest. While the state names a scheduler whose process
 * is alive nothing is removed: it would write its state back on the next tick.
 */

export type CleanupOutcome =
  | { ok: true; removed: string[]; kept: KeptEntry[] }
  /** The scheduler's process is alive on this machine: stop it first. */
  | { ok: false; reason: 'running'; pid: number }

export interface CleanupDeps {
  isAlive?: (pid: number) => boolean
  git?: GitRunner
}

export async function cleanup(repo: string, deps: CleanupDeps = {}): Promise<CleanupOutcome> {
  const isAlive = deps.isAlive ?? isPidAlive
  const { pid } = await readState(repo)
  // A pid of 0 or below is no process's: the probe would answer for this process's own group.
  if (pid !== undefined && Number.isInteger(pid) && pid > 0 && isAlive(pid)) return { ok: false, reason: 'running', pid }
  // The folder of the person's own automations goes when nothing is in it: the tool made it, and an empty one keeps nothing of theirs.
  await rmdir(join(repo, OWN_AUTOMATIONS_DIR)).catch(() => {})
  const outcome = await removeOwnDirectory(repo, STATE_DIR, [STATE_FILE, SCHEDULER_LOG], 'scheduler', deps.git ?? nodeGitRunner())
  // The automations a person keeps on this machine are their own writing and exist nowhere else: kept, and said so.
  const kept = outcome.kept.map(entry => (entry.path === OWN_AUTOMATIONS_DIR ? { ...entry, reason: 'your own automations, kept on this machine alone: remove the folder by hand to delete them' } : entry))
  return { ok: true, ...outcome, kept }
}
