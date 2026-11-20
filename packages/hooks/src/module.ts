import type { AccountAccess } from './account.js'
import type { AppAttention, AppLifecycle, AppRoute } from './app.js'
import type { ProjectRef } from './project.js'
import type { RunAgent } from './agent.js'
import type { RunHost, RunSkills, RunStep } from './run.js'
import type { SettingScope } from './settings.js'
import type { StoreBackend } from './store.js'

/** The hooks a module's Node part fills, by name. */
export interface NodeHooks {
  /** Its steps of the run pipeline. */
  'run.step'?: readonly RunStep[]
  /** The coding agents it drives. */
  'run.agent'?: readonly RunAgent[]
  /** The places it runs runs in. */
  'run.host'?: readonly RunHost[]
  /** Its skills for a run. */
  'run.skills'?: RunSkills
  /** Its link of the store's chain. */
  'store.backend'?: StoreBackend
  /** Its accounts, used outside a run. */
  'account.access'?: AccountAccess
  /** Its part in the app's life. */
  'app.lifecycle'?: AppLifecycle
  /** What it says needs the person. */
  'app.attention'?: AppAttention
  /** The addresses it answers for callers that are no page of the app's. */
  'app.route'?: readonly AppRoute[]
}

export type HookName = keyof NodeHooks

export const HOOK_NAMES: readonly HookName[] = ['run.step', 'run.agent', 'run.host', 'run.skills', 'store.backend', 'account.access', 'app.lifecycle', 'app.attention', 'app.route']

/** What makes a module a plugin: an Enabled row, kept per person, per computer or per project. */
export interface PluginInfo {
  scope: SettingScope
  /** A row the plugin keeps itself; without it, the row is a setting, saved through the store. */
  row?: OwnRow
}

/**
 * A row a plugin keeps itself, as the thing it switches: a git store's is how the repository it
 * syncs stands (the person's folder has a remote; the project's clone shares its data), which its
 * link reads to know where the data goes. A setting beside it could say one thing and the
 * repository another, and a project's settings are kept where the project's row says. It is read
 * here, and switched on the plugin's Settings entry, which asks what switching takes (the
 * repository to sync with, the account it is sent as).
 */
export interface OwnRow {
  /** Whether the plugin is on: in `project` for one kept per project; none for a session with no project. */
  read(project?: ProjectRef): Promise<boolean>
  /** The Settings entry it is switched on (`?settings=<id>`), the project's for one kept per project. */
  settings: string
}

/** A module's Node part: what its package's `./module` entry default-exports. */
export interface ModuleDefinition {
  /** Its name: its package's name without the scope (`git-branches`), as run options and settings name it. */
  name: string
  /** For a plugin: where its Enabled row is kept. A core module, without it, is always on. */
  plugin?: PluginInfo
  hooks: NodeHooks
}

/** Type a module's default export: `export default defineModule({ ... })`. */
export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition
}

/** What a module may be named: lower-case words joined by dashes. */
export const MODULE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
