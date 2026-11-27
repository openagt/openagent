import type { ProjectRef } from './project.js'
import { COMPUTER, PERSON, projectScope, type Scope, type Store } from './store.js'
import { callerNow } from './team.js'

/** Where a setting is kept: with the person, on this computer, or in one project. */
export type SettingScope = 'person' | 'computer' | 'project'

export const SETTING_SCOPES: readonly SettingScope[] = ['person', 'computer', 'project']

/**
 * A fact a module owns and other modules may read: a module's default account, a plugin's
 * Enabled row, the scheduler's pace. Declared here, in the catalog, beside the hooks; saved
 * through the store, in its scope.
 */
export interface Setting<T> {
  /** Its name: the module's name, a dot, then the setting's own (`tickets.enabled`). */
  readonly key: string
  readonly scope: SettingScope
  /** What it is until someone sets it. */
  readonly default: T
  /** A saved value read back; none for one that is not valid, and the default applies then. */
  parse(value: unknown): T | undefined
  /**
   * A pick each person makes for themselves (the coding agent of their next session): on a machine
   * shared by a team, a teammate's is kept apart from the machine's, which stays its owner's.
   */
  readonly perPerson?: true
}

const SETTING_KEY = /^[a-z][a-z0-9-]*(\.[a-z][a-zA-Z0-9-]*)+$/

/** A setting of the catalog, its key checked: the module's name, a dot, then the setting's own name. */
export function defineSetting<T>(setting: Setting<T>): Setting<T> {
  if (!SETTING_KEY.test(setting.key)) throw new Error(`${setting.key} is no setting key: the module's name, a dot, then the setting's name`)
  return setting
}

/** The file each scope keeps its settings in: one JSON object, by key. */
export const SETTINGS_FILE = 'settings.json'

/** The settings, read and written through the store. */
export interface Settings {
  /** A setting's value; its default when it was never set, or what was saved is not valid. `project` is the project of one kept per project. */
  get<T>(setting: Setting<T>, project?: ProjectRef): Promise<T>
  /** Save a setting's value, beside the others of its scope. */
  set<T>(setting: Setting<T>, value: T, project?: ProjectRef): Promise<void>
}

/**
 * The settings kept in `store`. A file that is missing or not a JSON object reads as no setting
 * set, so a hand-edited file never stops a module. A setting is saved into the file as the store
 * has it at that moment, so two saves of one scope at once, from this process or another, both stay.
 */
export function settingsIn(store: Store): Settings {
  return {
    async get<T>(setting: Setting<T>, project?: ProjectRef): Promise<T> {
      const saved = parseSettings(await store.read(scopeOf(setting, project), SETTINGS_FILE))[keyOf(setting)]
      if (saved === undefined) return setting.default
      const value = setting.parse(saved)
      return value === undefined ? setting.default : value
    },
    async set<T>(setting: Setting<T>, value: T, project?: ProjectRef): Promise<void> {
      await store.save(
        scopeOf(setting, project),
        async files => {
          const saved = { ...parseSettings(await files.read(SETTINGS_FILE)), [keyOf(setting)]: value }
          const sorted = Object.fromEntries(Object.entries(saved).sort(([a], [b]) => a.localeCompare(b)))
          return { [SETTINGS_FILE]: `${JSON.stringify(sorted, null, 2)}\n` }
        },
        `setting ${setting.key}`,
      )
    },
  }
}

/**
 * The key a setting is saved under: its own, or for a pick kept per person, a teammate's on a
 * machine shared by a team, `<key>@<their GitHub username>`, beside the owner's.
 */
function keyOf(setting: Setting<unknown>): string {
  if (!setting.perPerson) return setting.key
  const caller = callerNow()
  return caller && !caller.owner ? `${setting.key}@${caller.login.toLowerCase()}` : setting.key
}

/** A scope's settings file, read: nothing set when it is missing or not a JSON object. */
function parseSettings(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function scopeOf(setting: Setting<unknown>, project: ProjectRef | undefined): Scope {
  if (setting.scope === 'person') return PERSON
  if (setting.scope === 'computer') return COMPUTER
  if (project === undefined) throw new Error(`${setting.key} is kept per project: say which project`)
  return projectScope(project)
}

/**
 * The setting behind a plugin's Enabled row, in the scope the plugin keeps it: off until a person
 * switches it on, unless the distribution starts the plugin on.
 */
export function enabledSetting(module: string, scope: SettingScope, on: boolean): Setting<boolean> {
  return defineSetting({ key: `${module}.enabled`, scope, default: on, parse: value => (typeof value === 'boolean' ? value : undefined) })
}
