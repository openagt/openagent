import { applyChange, carriedSkills, commitSkills, GROUPS, isKnown, readProject, SCHEDULER, uncommittedSkills, type Standing } from '@openagt/init'
import { waitingSkills } from '../dashboard/start-branch.js'
import { readProjectHooks, runProjectHooks } from '../project-hooks.js'
import { providedDataChanged } from '../store/provided.js'
import { resolveProjectPath } from './context.js'

/**
 * A project's skills, as the dashboard shows and changes them (#2023): the same list with ticks
 * `npx @openagt/init` shows in a terminal, read and written through that package's own code, so
 * the two cannot drift apart. A project has a skill when the skill's text is in its folder; the
 * dashboard writes and deletes those files, and offers the one commit that holds them.
 */

/** One skill of the list, as it stands in the project. */
export interface ProjectSkill {
  name: string
  /** The one line the skill's text says of itself. */
  description: string
  /** How the project's text stands against the one this dashboard carries; `absent` when the project does not hold the skill. */
  standing: Standing
  /** Whether the skill is in the folder but not yet on the branch agents start from: an agent started from it does not have the skill. */
  waiting: boolean
}

export interface ProjectSkills {
  /** The list's groups; `ticked` says whether a group's skills are ticked in a project that has none yet. */
  groups: { title: string; ticked: boolean; skills: ProjectSkill[] }[]
  /** Whether the scheduler starts with the dashboard for this project, on this machine. */
  scheduler: boolean
  /** The branch agents start from, by its name: the remote's default branch, else the branch the folder is on. Absent where there is none. */
  startBranch?: string
  /** How many skill files stand written or deleted in the folder with no commit yet. */
  uncommitted: number
  /** Whether the folder is a git repository: without one there is nothing to commit. */
  git: boolean
  /** Whether the project has a remote: without one a commit on this machine is all agents need. */
  remote: boolean
}

/** The project's skills; `null` when the project is unknown here. */
export async function onProjectSkills(projectId: string): Promise<ProjectSkills | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const [state, carried] = await Promise.all([readProject(cwd), carriedSkills()])
  const standing = new Map(state.skills.map(skill => [skill.name, skill.standing]))
  const { start, waiting } = await waitingSkills(cwd, state.skills.filter(skill => skill.standing !== 'absent').map(skill => skill.name))
  return {
    groups: GROUPS.map(group => ({
      title: group.title,
      ticked: group.ticked,
      skills: group.skills.map(name => ({ name, description: carried.get(name)!.description, standing: standing.get(name) ?? 'absent', waiting: waiting.has(name) })),
    })),
    scheduler: state.scheduler,
    ...(start ? { startBranch: start.name } : {}),
    uncommitted: state.git ? await uncommittedSkills(cwd) : 0,
    git: state.git,
    remote: state.remote,
  }
}

/** What a change of skills answered: what was written and deleted, what was left as it is, and the scheduler when the change switched it. */
export type ChangeSkillsResult =
  | { ok: true; written: string[]; removed: string[]; left: { path: string; reason: string }[]; scheduler?: 'on' | 'off'; schedulerError?: string }
  | { ok: false; error: string }

/** A list of the list's own skill names, each once; nothing for anything else. */
const names = (value: unknown): string[] | undefined => (value === undefined ? [] : Array.isArray(value) && value.every(name => typeof name === 'string' && name !== SCHEDULER && isKnown(name)) ? [...new Set(value as string[])] : undefined)

/**
 * Write and delete skills in a project's folder, and switch its scheduler: what the "Add skills"
 * screen saves. Only the names of the list are taken; anything else is refused whole. A scheduler
 * switched on starts at once, by its own line, as it would have at this dashboard's opening.
 * Nothing is committed here: `sendCommitSkills` is the person's next press.
 */
export async function sendChangeSkills(projectId: string, change: { write?: string[]; remove?: string[]; scheduler?: boolean }): Promise<ChangeSkillsResult> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  const asked = change && typeof change === 'object' && !Array.isArray(change) ? change : undefined
  const write = names(asked?.write)
  const remove = names(asked?.remove)
  if (!asked || !write || !remove || (asked.scheduler !== undefined && typeof asked.scheduler !== 'boolean')) return { ok: false, error: 'not a list of skills' }
  try {
    const opened = (await readProjectHooks(cwd).catch(() => undefined))?.open ?? []
    const changed = await applyChange(cwd, { write, remove, ...(asked.scheduler !== undefined ? { scheduler: asked.scheduler } : {}) })
    providedDataChanged(cwd)
    const scheduler = changed.scheduler
    // The lines the change added run when the dashboard opens, and this dashboard is open: they run now, the way they would have.
    if (scheduler && !('error' in scheduler) && scheduler.on && scheduler.changed) {
      const added = ((await readProjectHooks(cwd).catch(() => undefined))?.open ?? []).filter(line => !opened.includes(line))
      if (added.length > 0) await runProjectHooks(cwd, 'open', { only: added, log: console.log })
    }
    return {
      ok: true,
      written: changed.written,
      removed: changed.removed,
      left: changed.left,
      ...(scheduler && !('error' in scheduler) && scheduler.changed ? { scheduler: scheduler.on ? ('on' as const) : ('off' as const) } : {}),
      ...(scheduler && 'error' in scheduler ? { schedulerError: scheduler.error } : {}),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * One commit of skill files that stand uncommitted in the project's folder, on the branch the
 * folder is on: the files of the skills `only` names, after a change that wrote or deleted them,
 * else every uncommitted skill file. Never a push.
 */
export async function sendCommitSkills(projectId: string, only?: string[]): Promise<{ ok: true; committed: boolean; commit?: string } | { ok: false; error: string }> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  const named = names(only)
  if (!named) return { ok: false, error: 'not a list of skills' }
  return named.length > 0 ? commitSkills(cwd, named) : commitSkills(cwd)
}
