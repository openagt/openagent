import { nodeGitRunner } from '@openagt/agent-data'
import { applyChange, carriedSkills, GROUPS, isKnown, readProject, skillsOn, uncommittedSkills, type Standing } from '@openagt/init'
import { cachedPrView } from '../dashboard/pull-requests.js'
import { sendSkills, SKILLS_BRANCH, type SendSkillsResult } from '../dashboard/send-skills.js'
import { waitingSkills } from '../dashboard/start-branch.js'
import { readProjectHooks, runProjectHooks } from '../project-hooks.js'
import { providedDataChanged } from '../store/provided.js'
import { resolveProjectPath } from './context.js'

export type { SendSkillsResult } from '../dashboard/send-skills.js'

/**
 * A project's skills, as the dashboard shows and changes them (#2023): the same list with ticks
 * `npx @openagt/init` shows in a terminal, read and written through that package's own code, so
 * the two cannot drift apart. A project has a skill when the skill's text is in its folder; the
 * dashboard writes and deletes those files, and sends them where agents start from.
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
  /** The branch agents start from, by its name: the remote's default branch, else the branch the folder is on. Absent where there is none. */
  startBranch?: string
  /** The skills whose files stand written, changed or deleted in the folder with no commit yet. */
  uncommitted: string[]
  /** Whether the folder is a git repository: without one there is nothing to commit. */
  git: boolean
  /** Where the skills are sent, for a person: the git host's name ("GitHub", "GitLab"), else the remote's host. Absent without a remote: a commit on this machine is all agents need. */
  remote?: string
  /** The open pull request the skills went to when the default branch took no push. */
  request?: { number: number; url: string }
  /** The branch of OpenAgent's own on the remote that holds every waiting skill, with no pull request for it: where no git host package opens one, it is merged by hand. */
  branch?: string
  /** Whether the branch the folder is on has every waiting skill: an agent started from it has them now. */
  local: boolean
}

/** The project's skills; `null` when the project is unknown here. */
export async function onProjectSkills(projectId: string): Promise<ProjectSkills | null> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return null
  const [state, carried] = await Promise.all([readProject(cwd), carriedSkills()])
  const standing = new Map(state.skills.map(skill => [skill.name, skill.standing]))
  const { start, waiting } = await waitingSkills(cwd, state.skills.filter(skill => skill.standing !== 'absent').map(skill => skill.name))
  const uncommitted = state.git ? await uncommittedSkills(cwd) : []
  // Asked of the git host only while something is on its way: a pull request is where it may be.
  const request = state.remote && (waiting.size > 0 || uncommitted.length > 0) ? (await cachedPrView(cwd, SKILLS_BRANCH)).value : undefined
  const open = request?.state === 'OPEN' ? { number: request.number, url: request.url } : undefined
  // With no request, the skills may still be on the remote: on the branch a send left where it could open none.
  const pushed = state.remote && !open && waiting.size > 0 ? await skillsOn(cwd, `refs/remotes/origin/${SKILLS_BRANCH}`) : undefined
  const remote = state.remote ? await remoteName(cwd) : undefined
  return {
    groups: GROUPS.map(group => ({
      title: group.title,
      ticked: group.ticked,
      skills: group.skills.map(name => ({ name, description: carried.get(name)!.description, standing: standing.get(name) ?? 'absent', waiting: waiting.has(name) })),
    })),
    ...(start ? { startBranch: start.name } : {}),
    uncommitted,
    git: state.git,
    ...(remote ? { remote } : {}),
    ...(open ? { request: open } : {}),
    ...(pushed && [...waiting.keys()].every(name => pushed.has(name)) ? { branch: SKILLS_BRANCH } : {}),
    local: waiting.size > 0 && uncommitted.length === 0 && [...waiting.values()].every(skill => skill.here),
  }
}

/** The git hosts a person knows by name, by their address. */
const HOSTS: Record<string, string> = { 'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'bitbucket.org': 'Bitbucket', 'codeberg.org': 'Codeberg' }

/** The remote's host for a person, out of its address in git's spellings (`https://host/…`, `ssh://git@host:22/…`, `git@host:…`); none for a folder on this machine. */
export function hostName(address: string): string | undefined {
  const trimmed = address.trim()
  // With a scheme the host follows it, and `file://` has none; without one only `host:path` names a host.
  const host = (trimmed.includes('://') ? trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)/i) : trimmed.match(/^(?:[^@/]+@)?([^/:]+):/))?.[1]?.toLowerCase()
  return host ? (HOSTS[host] ?? host) : undefined
}

async function remoteName(cwd: string): Promise<string> {
  const address = await nodeGitRunner()(['remote', 'get-url', 'origin'], cwd).catch(() => '')
  return hostName(address) ?? 'the remote'
}

/** What a change of skills answered: what was written and deleted, what was left as it is, and the scheduler when the change switched it. */
export type ChangeSkillsResult =
  | { ok: true; written: string[]; removed: string[]; left: { path: string; reason: string }[]; scheduler?: 'on' | 'off'; schedulerError?: string }
  | { ok: false; error: string }

/** A list of the list's own skill names, each once; nothing for anything else. */
const names = (value: unknown): string[] | undefined => (value === undefined ? [] : Array.isArray(value) && value.every(name => typeof name === 'string' && isKnown(name)) ? [...new Set(value as string[])] : undefined)

/**
 * Write and delete skills in a project's folder: what the "Add skills" screen saves. Only the names
 * of the list are taken; anything else is refused whole. The scheduler's skill written switches the
 * scheduler on for this machine, and it starts at once, by its own line, as it would have at this
 * dashboard's opening.
 * Nothing is committed here: `sendCommitSkills` is the person's next press.
 */
export async function sendChangeSkills(projectId: string, change: { write?: string[]; remove?: string[] }): Promise<ChangeSkillsResult> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  const asked = change && typeof change === 'object' && !Array.isArray(change) ? change : undefined
  const write = names(asked?.write)
  const remove = names(asked?.remove)
  if (!asked || !write || !remove) return { ok: false, error: 'not a list of skills' }
  try {
    const opened = (await readProjectHooks(cwd).catch(() => undefined))?.open ?? []
    const changed = await applyChange(cwd, { write, remove })
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
 * The skills `only` names, after a change that wrote or deleted them, sent where agents start
 * from (`sendSkills`); without, every skill that is still on its way there: uncommitted, or not
 * yet on the remote's default branch.
 */
export async function sendProjectSkills(projectId: string, only?: string[]): Promise<SendSkillsResult> {
  const cwd = await resolveProjectPath(projectId)
  if (!cwd) return { ok: false, error: 'this project has no local path on this server' }
  const named = names(only)
  if (!named) return { ok: false, error: 'not a list of skills' }
  if (named.length > 0) return sendSkills(cwd, named)
  const skills = await onProjectSkills(projectId)
  const due = skills ? [...new Set([...skills.uncommitted, ...skills.groups.flatMap(group => group.skills).filter(skill => skill.waiting).map(skill => skill.name)])] : []
  return sendSkills(cwd, due)
}
