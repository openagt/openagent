import { MODULE_NAME } from './module.js'
import type { RunOptions } from './run.js'
import { defineSetting } from './settings.js'

// The catalog (#2394): the settings modules own and other modules read, declared here beside the
// hooks, so a reader names the setting and never the module that saves it. Each is saved through
// the store, in its scope (`settings.ts`).

/**
 * The person's name and picture, as OpenAgent shows them: what they set in Settings › Profile,
 * theirs and not a git host's, the same on every computer of theirs. What is unset is the
 * computer's: git's name, and their initials.
 */
export interface PersonInfo {
  /** What they are called. */
  name?: string
  /** A picture of them: an https address. */
  picture?: string
  /** The GitHub login the name and picture were last copied from. */
  github?: string
}

/** What a person may be called: one line, at most 60 characters. */
export function isPersonName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60 && !/[\u0000-\u001f\u007f]/.test(name)
}

/** A picture's address OpenAgent keeps: only one on the web. */
export function isPictureAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** user-info's: the person's name and picture. A part that is not valid reads as unset, and the rest stays. */
export const PERSON_INFO = defineSetting<PersonInfo>({
  key: 'user-info.person',
  scope: 'person',
  default: {},
  parse: value => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const { name, picture, github } = value as Record<string, unknown>
    return {
      ...(isPersonName(name) ? { name: name.trim() } : {}),
      ...(isPictureAddress(picture) ? { picture } : {}),
      ...(typeof github === 'string' && github ? { github } : {}),
    }
  },
})

/**
 * An agent profile, a profile for short (#2394): a name and a saved set of run options, made once
 * and used in any project or none. A run on it gets its options under the ones picked for that run
 * alone. Default is the one a run is on when none is picked: built in until it is changed, never
 * removed or renamed.
 */
export interface Profile {
  /** The name as a path-safe word: what a pick and a run's record name it by. */
  id: string
  name: string
  options: RunOptions
}

/** Default's id. */
export const DEFAULT_PROFILE = 'default'

/** A profile's id: lower-case words joined by dashes. */
const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isProfileId(id: unknown): id is string {
  return typeof id === 'string' && PROFILE_ID.test(id)
}

/** The id a profile's name gives: lower-case, every run of other characters one dash. */
export function profileIdOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** What a person may name a profile: a line of at most 40 characters that gives an id. */
export function isProfileName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 40 && isProfileId(profileIdOf(name))
}

/** Default as it is before anyone changes it: no option of its own, so the computer's picks apply. */
export function builtInDefault(): Profile {
  return { id: DEFAULT_PROFILE, name: 'Default', options: {} }
}

/** profiles': the profiles the person made, and Default once it was changed. One that is no profile reads as none. */
export const PROFILES = defineSetting<Profile[]>({
  key: 'profiles.saved',
  scope: 'person',
  default: [],
  parse: value => (Array.isArray(value) ? value.flatMap(item => profileFrom(item) ?? []) : undefined),
})

/**
 * profiles': the profile a run started on this computer is on when its options name none, the
 * one picked under the message box for every next run, by its id; Default when unset.
 */
export const PICKED_PROFILE = defineSetting<string | undefined>({
  key: 'profiles.picked',
  scope: 'computer',
  default: undefined,
  parse: value => (isProfileId(value) && value !== DEFAULT_PROFILE ? value : undefined),
})

/** Every profile, as a list shows them: Default first, as saved or built in, then the others by name. */
export function profilesIn(saved: readonly Profile[]): Profile[] {
  const others = saved.filter(profile => profile.id !== DEFAULT_PROFILE).sort((a, b) => a.name.localeCompare(b.name))
  return [saved.find(profile => profile.id === DEFAULT_PROFILE) ?? builtInDefault(), ...others]
}

/** The profile `id` names among `saved`; Default for none, or for one that is not there. */
export function profileOf(saved: readonly Profile[], id: string | undefined): Profile {
  const all = profilesIn(saved)
  return (id !== undefined ? all.find(profile => profile.id === id) : undefined) ?? all[0]!
}

/** A saved profile, read strictly: the options a profile holds, each as it should be; anything else there is left out. */
function profileFrom(value: unknown): Profile | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { id, name, options } = value as Record<string, unknown>
  if (!isProfileId(id) || typeof name !== 'string' || !name.trim()) return undefined
  const given = typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {}
  const slice = (key: string): Record<string, unknown> => {
    const part = given[key]
    return typeof part === 'object' && part !== null && !Array.isArray(part) ? (part as Record<string, unknown>) : {}
  }
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  const names = (value: unknown): string[] | undefined => (Array.isArray(value) && value.length > 0 && value.every(one => typeof one === 'string' && one.trim()) ? [...(value as string[])] : undefined)
  const account = text(slice('github')['account'])
  const claude = names(slice('agent-driver')['claude'])
  const codex = names(slice('agent-driver')['codex'])
  const project = slice('skills')['project']
  const skills = project === 'none' ? 'none' : names(project)
  const without = names(slice('plugins')['without'])?.filter(one => MODULE_NAME.test(one))
  return {
    id,
    name: name.trim(),
    options: {
      ...(account !== undefined ? { github: { account } } : {}),
      ...(claude || codex ? { 'agent-driver': { ...(claude ? { claude } : {}), ...(codex ? { codex } : {}) } } : {}),
      ...(skills !== undefined ? { skills: { project: skills } } : {}),
      ...(without !== undefined && without.length > 0 ? { plugins: { without } } : {}),
    },
  }
}

/**
 * How often at most a scheduled command starts on a computer, where a person set it there:
 * whenever its check finds work, or a wait from its last start (`6h`, `2d`), counted from a time
 * of day when it has one (`at`, `HH:MM`), since the pick was made (`since`, ISO).
 */
export type SchedulePace = { work: true } | { every: string; at?: string; since: string }

/** What a computer keeps of one scheduled command, where a person set it there: when they switched it on, and its pace. */
export interface ScheduledCommandPicks {
  /** When it was switched on on this computer, ISO: it is off without. */
  on?: string
  pace?: SchedulePace
}

/** A project's scheduled commands as a computer keeps them, by the command as a person types it without its slash (`work-queue`). */
export type ScheduledCommands = Record<string, ScheduledCommandPicks>

/**
 * scheduled-agents' (#2394, decision 9): the scheduled commands this computer runs, by the
 * project's id, each with when it was switched on here and the pace set here. Kept per computer:
 * each machine switches its own on. The queue reads whether `work-queue` starts by itself, and how
 * often. A part that is not valid reads as unset, and the rest stays.
 */
export const SCHEDULED_COMMANDS = defineSetting<Record<string, ScheduledCommands>>({
  key: 'scheduled-agents.commands',
  scope: 'computer',
  default: {},
  parse: value => {
    if (!isMap(value)) return undefined
    const projects = Object.entries(value).flatMap(([project, commands]): [string, ScheduledCommands][] => {
      const kept = isMap(commands) ? Object.entries(commands).flatMap(([command, picks]) => picksFrom(command, picks)) : []
      return kept.length > 0 ? [[project, Object.fromEntries(kept)]] : []
    })
    return Object.fromEntries(projects)
  },
})

/** Where a person changes {@link SCHEDULED_COMMANDS}: scheduled-agents' page, by its segment and its name. */
export const SCHEDULED_COMMANDS_PAGE = { segment: 'automations', label: 'Automations' } as const

/** One command's picks, read strictly: a switch is a time, a pace one of its two readings; a command with neither is none. */
function picksFrom(command: string, value: unknown): [string, ScheduledCommandPicks][] {
  if (!isMap(value)) return []
  const on = typeof value['on'] === 'string' && !Number.isNaN(Date.parse(value['on'])) ? { on: value['on'] } : {}
  const pace = paceFrom(value['pace'])
  return on.on !== undefined || pace !== undefined ? [[command, { ...on, ...(pace ? { pace } : {}) }]] : []
}

function paceFrom(value: unknown): SchedulePace | undefined {
  if (!isMap(value)) return undefined
  if (value['work'] === true) return { work: true }
  const { every, at, since } = value
  if (typeof every !== 'string' || typeof since !== 'string' || (at !== undefined && typeof at !== 'string')) return undefined
  return { every, ...(typeof at === 'string' ? { at } : {}), since }
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One project on this computer's list, as the projects module keeps it. */
export interface ProjectRecord {
  /** Stable, URL-safe, made from its folder's path: what every address and read names it by. */
  id: string
  /** Its folder: an absolute path. */
  path: string
  /** When it was added, ISO. */
  addedAt: string
}

/** The most projects a list keeps, so a hand-edited file cannot bloat. */
const MOST_PROJECTS = 500

/**
 * projects' (#2394): the projects on this computer's list, in the order they were added. The shell
 * reads it for its sidebar and its routes, and to find a project's folder by its id; the projects
 * module alone writes it. A record that is not one is left out, and of two with one folder the
 * first stays.
 */
export const PROJECTS = defineSetting<ProjectRecord[]>({
  key: 'projects.list',
  scope: 'computer',
  default: [],
  parse: value => {
    if (!Array.isArray(value)) return undefined
    const seen = new Set<string>()
    return value
      .flatMap((item): ProjectRecord[] => {
        if (!isMap(item)) return []
        const { id, path, addedAt } = item
        if (typeof id !== 'string' || !id || typeof path !== 'string' || !path.startsWith('/') || typeof addedAt !== 'string' || seen.has(path)) return []
        seen.add(path)
        return [{ id, path, addedAt }]
      })
      .slice(0, MOST_PROJECTS)
  },
})
