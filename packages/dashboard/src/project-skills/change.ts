import { SCHEDULER, SKILL_NAMES } from './catalogue.js'
import { removeSkill, setScheduler, writeSkill } from './apply.js'

/** One change to a project's skills, from the dashboard's Skills list or its Update button. */

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
  scheduler?: { on: boolean; changed: boolean } | { on: boolean; error: string }
}

/** Whether `name` is a skill of the list. */
export function isKnown(name: string): boolean {
  return SKILL_NAMES.includes(name)
}

export async function applyChange(root: string, change: Change): Promise<Changed> {
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
    const outcome = await setScheduler(root, scheduler)
    changed.scheduler = outcome.ok ? { on: scheduler, changed: outcome.changed } : { on: scheduler, error: outcome.error }
  }
  return changed
}
