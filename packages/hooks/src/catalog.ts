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
 * A preset (#2394): a name and a saved set of run options, made once and used in any project or
 * none. A run on it gets its options under the ones picked for that run alone. Default is the one
 * a run is on when none is picked: built in until it is changed, never removed or renamed.
 */
export interface Preset {
  /** The name as a path-safe word: what a pick and a run's record name it by. */
  id: string
  name: string
  options: RunOptions
}

/** Default's id. */
export const DEFAULT_PRESET = 'default'

/** A preset's id: lower-case words joined by dashes. */
const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isPresetId(id: unknown): id is string {
  return typeof id === 'string' && PRESET_ID.test(id)
}

/** The id a preset's name gives: lower-case, every run of other characters one dash. */
export function presetIdOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** What a person may name a preset: a line of at most 40 characters that gives an id. */
export function isPresetName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 40 && isPresetId(presetIdOf(name))
}

/** Default as it is before anyone changes it: no option of its own, so the computer's picks apply. */
export function builtInDefault(): Preset {
  return { id: DEFAULT_PRESET, name: 'Default', options: {} }
}

/** presets': the presets the person made, and Default once it was changed. One that is no preset reads as none. */
export const PRESETS = defineSetting<Preset[]>({
  key: 'presets.saved',
  scope: 'person',
  default: [],
  parse: value => (Array.isArray(value) ? value.flatMap(item => presetFrom(item) ?? []) : undefined),
})

/** Every preset, as a list shows them: Default first, as saved or built in, then the others by name. */
export function presetsIn(saved: readonly Preset[]): Preset[] {
  const others = saved.filter(preset => preset.id !== DEFAULT_PRESET).sort((a, b) => a.name.localeCompare(b.name))
  return [saved.find(preset => preset.id === DEFAULT_PRESET) ?? builtInDefault(), ...others]
}

/** The preset `id` names among `saved`; Default for none, or for one that is not there. */
export function presetOf(saved: readonly Preset[], id: string | undefined): Preset {
  const all = presetsIn(saved)
  return (id !== undefined ? all.find(preset => preset.id === id) : undefined) ?? all[0]!
}

/** A saved preset, read strictly: the options a preset holds, each as it should be; anything else there is left out. */
function presetFrom(value: unknown): Preset | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const { id, name, options } = value as Record<string, unknown>
  if (!isPresetId(id) || typeof name !== 'string' || !name.trim()) return undefined
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
