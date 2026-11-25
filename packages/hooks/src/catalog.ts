import { MODULE_NAME } from './module.js'
import type { AgentDriverOptions, RunOptions } from './run.js'
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

/**
 * github's: the GitHub account every next run started on this computer works as where its options
 * name none, one of OpenAgent's own, by its login, picked under the message box; the one runs use
 * (Permissions › Use for runs) when unset, or when it names an account this computer no longer has.
 */
export const PICKED_GITHUB_ACCOUNT = defineSetting<string | undefined>({
  key: 'github.account',
  scope: 'computer',
  default: undefined,
  parse: value => (typeof value === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value) ? value : undefined),
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

/**
 * A saved profile, read: each module's slice as it was saved, so a profile keeps whatever the
 * modules' controls put in it. The fields the run engine takes from a profile as they are, the
 * coding agent with its model and effort, the accounts and the skills and plugins picks, are read
 * strictly: one that is not as it should be is left out, and so is a slice left with nothing.
 */
function profileFrom(value: unknown): Profile | undefined {
  if (!isMap(value)) return undefined
  const { id, name, options } = value
  if (!isProfileId(id) || typeof name !== 'string' || !name.trim()) return undefined
  const slices = Object.entries(isMap(options) ? options : {}).flatMap(([module, slice]): [string, Record<string, unknown>][] => {
    if (module === 'profiles' || !MODULE_NAME.test(module) || !isMap(slice)) return []
    const kept = checkedSlice(module, slice)
    return Object.keys(kept).length > 0 ? [[module, kept]] : []
  })
  return { id, name: name.trim(), options: Object.fromEntries(slices) as RunOptions }
}

/** A module's slice of a saved profile: the fields {@link profileFrom} reads strictly, each kept only as it should be, and the others as saved. */
function checkedSlice(module: string, slice: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...slice }
  const names = (value: unknown): string[] | undefined => (Array.isArray(value) && value.length > 0 && value.every(one => typeof one === 'string' && one.trim()) ? [...(value as string[])] : undefined)
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  const keep = (field: string, read: (value: unknown) => unknown): void => {
    if (!(field in kept)) return
    const value = read(kept[field])
    if (value === undefined) delete kept[field]
    else kept[field] = value
  }
  if (module === 'github') keep('account', text)
  if (module === 'agent-driver') {
    for (const field of ['driver', 'model', 'effort']) keep(field, text)
    keep('claude', names)
    keep('codex', names)
  }
  if (module === 'skills') keep('project', value => (value === 'all' || value === 'none' ? value : names(value)))
  if (module === 'plugins') {
    keep('without', value => {
      const plugins = names(value)?.filter(one => MODULE_NAME.test(one))
      return plugins !== undefined && plugins.length > 0 ? plugins : undefined
    })
  }
  return kept
}

/** What is picked for every next run of a coding agent's: the agent, its model and how hard it thinks. */
export type AgentPick = Pick<AgentDriverOptions, 'driver' | 'model' | 'effort'>

/**
 * agent-driver's: the coding agent, the model and the effort picked under the message box for
 * every next run on this computer, which a run started here is on where its options name none. A
 * part that is not valid reads as unset, and the rest stays.
 */
export const PICKED_AGENT = defineSetting<AgentPick>({
  key: 'agent-driver.picked',
  scope: 'computer',
  default: {},
  parse: value => {
    if (!isMap(value)) return undefined
    const word = (part: unknown): string | undefined => (typeof part === 'string' && /^[\w.:/-]+$/.test(part) ? part : undefined)
    const driver = word(value['driver'])
    const model = word(value['model'])
    const effort = word(value['effort'])
    return { ...(driver !== undefined ? { driver } : {}), ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}) }
  },
})

/**
 * agent-driver's: each run started on this computer is named by a small model, in a few words; off,
 * a run is listed by what it was asked. A Start that brings a name of its own is named that.
 */
export const NAME_RUNS = defineSetting<boolean>({
  key: 'agent-driver.name-runs',
  scope: 'computer',
  default: true,
  parse: value => (typeof value === 'boolean' ? value : undefined),
})

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

/**
 * Whether `value` names a branch the way git lets a branch be named (`git check-ref-format
 * --branch`), told without running git. A branch a run starts from ends up on a command line, so a
 * word that could be read there as an option (a leading `-`), or that git would read as something
 * other than one branch (`a..b`, `x@{1}`, `HEAD`), is not a name.
 */
export function isBranchName(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > 255) return false
  if (value === 'HEAD' || value === '@' || value.startsWith('-')) return false
  // What git refuses anywhere in a ref: a space, a control character, and the characters its
  // revision syntax uses.
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(value) || value.includes('..') || value.includes('@{')) return false
  if (value.endsWith('.')) return false
  return value.split('/').every(part => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'))
}

/**
 * Where a project's runs start their own branch, when it is not origin's default branch: the
 * branch the project's folder is on, whatever that is by then, or one of origin's branches, by name.
 */
export type StartFrom = { kind: 'local' } | { kind: 'published'; branch: string }

/** The cap on the projects {@link START_FROM} keeps, so a hand-edited file cannot bloat. */
const START_FROM_LIMIT = 200

/**
 * git-branches': where every next run of a project started on this computer starts from, picked in
 * the row above the launcher's box, by the project's id; a project with none starts from origin's
 * default branch. A run whose options name a branch to start from (`GitBranchesOptions.base`)
 * starts there instead. A pick that is not one reads as none.
 */
export const START_FROM = defineSetting<Record<string, StartFrom>>({
  key: 'git-branches.startFrom',
  scope: 'computer',
  default: {},
  parse: value => {
    if (!isMap(value)) return undefined
    const picks = Object.entries(value).flatMap(([id, pick]): [string, StartFrom][] => {
      if (id === '' || !isMap(pick)) return []
      if (pick['kind'] === 'local') return [[id, { kind: 'local' }]]
      return pick['kind'] === 'published' && isBranchName(pick['branch']) ? [[id, { kind: 'published', branch: pick['branch'] }]] : []
    })
    return Object.fromEntries(picks.slice(0, START_FROM_LIMIT))
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
