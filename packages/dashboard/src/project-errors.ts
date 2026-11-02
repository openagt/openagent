/**
 * The daemon's per-project error state (#1500): a background job that finds a project in a state
 * the user has to fix — and can only fix if told — records it here, and clears it the moment the
 * state is good again. The dashboard renders what is recorded; nothing else reads it.
 *
 * The first emitter is the data-branch sync (#1599): a push origin rejects used to be a console
 * line on the daemon's stdout and nothing else, which is the worst way to handle a state nobody
 * can see.
 *
 * A project whose data stays on this machine is not an error: a folder with no origin, or one the
 * person does not share, is a normal project. The sync records why as `local`, a note the
 * dashboard says quietly.
 *
 * In memory on purpose. Every emitter re-evaluates on its own cadence — the sync every minute —
 * so a restarted daemon re-learns each error within a tick, and there is no stale record to
 * outlive the condition that raised it.
 */

import type { BranchReach } from '@openagt/agent-data'

/**
 * What went wrong, by kind: the dashboard picks its wording from this, the message carries the
 * detail. `data-sync`: the data branch cannot converge with the remote. `provider`: which package
 * provides a kind of the project's data is unsettled (#1820): several declare it and the project's
 * package.json names none, or names one that does not.
 */
export type ProjectErrorCode = 'data-sync' | 'provider'

export interface ProjectError {
  code: ProjectErrorCode
  /** The detail — what the failing command said, in the words the user would see running it by hand. */
  message: string
  /** ISO timestamp of when the error was first recorded; a re-report of the same code keeps it. */
  since: string
}

/** Why a project's data stays on this machine: its repository has no origin, or the person keeps it here. */
export type StaysLocal = Exclude<BranchReach, 'origin'>

/** The daemon's write side: one slot per (project, code). */
export interface ProjectErrors {
  /**
   * Record the error. A second report of the same code on the same project refreshes the message
   * and keeps `since`, so a banner says how long this has been going on rather than resetting
   * every minute.
   */
  set(projectPath: string, code: ProjectErrorCode, message: string): void
  /** The condition is gone; a clear of something never set is a no-op. */
  clear(projectPath: string, code: ProjectErrorCode): void
  /** The project's current errors, oldest first. */
  list(projectPath: string): ProjectError[]
  /** How far the project's data reaches, as the last sync found it. */
  setReach(projectPath: string, reach: BranchReach): void
  /** What the dashboard shows of the project: its errors, and why its data stays local, if it does. */
  read(projectPath: string): ProjectState
}

/** What the background jobs currently know of a project: what is wrong with it, and why its data stays on this machine, if it does. */
export interface ProjectState {
  errors: ProjectError[]
  local?: StaysLocal
}

/** The dashboard's read side, wired into its context. */
export type ProjectErrorsReader = ProjectErrors['read']

export function projectErrorStore(now: () => Date = () => new Date()): ProjectErrors {
  const byProject = new Map<string, Map<ProjectErrorCode, ProjectError>>()
  const local = new Map<string, StaysLocal>()
  const list = (projectPath: string): ProjectError[] => [...(byProject.get(projectPath)?.values() ?? [])].sort((a, b) => a.since.localeCompare(b.since))
  return {
    set(projectPath, code, message) {
      let errors = byProject.get(projectPath)
      if (!errors) byProject.set(projectPath, (errors = new Map()))
      const since = errors.get(code)?.since ?? now().toISOString()
      errors.set(code, { code, message, since })
    },
    clear(projectPath, code) {
      const errors = byProject.get(projectPath)
      if (!errors) return
      errors.delete(code)
      if (errors.size === 0) byProject.delete(projectPath)
    },
    list,
    setReach(projectPath, reach) {
      if (reach === 'origin') local.delete(projectPath)
      else local.set(projectPath, reach)
    },
    read(projectPath) {
      const why = local.get(projectPath)
      return { errors: list(projectPath), ...(why ? { local: why } : {}) }
    },
  }
}
