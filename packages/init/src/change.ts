import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { SCHEDULER, SKILL_NAMES } from './catalogue.js'
import { removeSkill, setScheduler, writeSkill } from './apply.js'
import { commitPaths, type CommitOutcome } from './commit.js'

/**
 * One change to a project's skills, whoever asks for it: the list a person ticked in a terminal,
 * `add` and `remove` in a script, the dashboard's "Add skills" screen. They all end here, so they
 * cannot drift apart.
 */

export interface Change {
  /** Skills to write: a new one, or one written again over what is there. */
  write?: readonly string[]
  /** Skills to delete. */
  remove?: readonly string[]
}

export interface Changed {
  written: string[]
  removed: string[]
  /** Every tracked path the change wrote or deleted, from the project's root: what its commit holds. */
  paths: string[]
  /** What was left as it is, and why. */
  left: { path: string; reason: string }[]
  /** The scheduler after the change, when the change wrote or deleted its skill; `error` when it could not be switched. */
  scheduler?: { on: boolean; changed: boolean; madeRepository?: true } | { on: boolean; error: string }
}

/** Whether `name` is a skill of the list `init` writes. */
export function isKnown(name: string): boolean {
  return SKILL_NAMES.includes(name)
}

export async function applyChange(root: string, change: Change, git: GitRunner = nodeGitRunner()): Promise<Changed> {
  const changed: Changed = { written: [], removed: [], paths: [], left: [] }
  for (const name of change.write ?? []) {
    const touched = await writeSkill(root, name)
    changed.written.push(name)
    changed.paths.push(...touched.paths)
    changed.left.push(...touched.left)
  }
  for (const name of change.remove ?? []) {
    const touched = await removeSkill(root, name)
    if (touched.paths.length > 0) changed.removed.push(name)
    changed.paths.push(...touched.paths)
    changed.left.push(...touched.left)
  }
  const scheduler = change.write?.includes(SCHEDULER) ? true : change.remove?.includes(SCHEDULER) ? false : undefined
  if (scheduler !== undefined) {
    const outcome = await setScheduler(root, scheduler, git)
    changed.scheduler = outcome.ok ? { on: scheduler, changed: outcome.changed, ...(outcome.madeRepository ? { madeRepository: true as const } : {}) } : { on: scheduler, error: outcome.error }
  }
  return changed
}

/** The message of the commit that holds a change. */
export function commitMessage(changed: Pick<Changed, 'written' | 'removed'>): string {
  const subject = changed.removed.length === 0 ? 'Add OpenAgent skills' : changed.written.length === 0 ? 'Remove OpenAgent skills' : 'Update OpenAgent skills'
  const lines = [...(changed.written.length ? [`Written: ${changed.written.join(', ')}`] : []), ...(changed.removed.length ? [`Removed: ${changed.removed.join(', ')}`] : [])]
  return `${subject}\n\n${lines.join('\n')}\n`
}

/** Commit what a change wrote and deleted, and nothing else. */
export function commitChange(root: string, changed: Changed, git: GitRunner = nodeGitRunner()): Promise<CommitOutcome> {
  return commitPaths(root, changed.paths, commitMessage(changed), git)
}
