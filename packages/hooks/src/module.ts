import type { AccountAccess } from './account.js'
import type { AppAttention, AppLifecycle } from './app.js'
import type { RunAgent, RunHost, RunSkills, RunStep } from './run.js'
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
}

export type HookName = keyof NodeHooks

export const HOOK_NAMES: readonly HookName[] = ['run.step', 'run.agent', 'run.host', 'run.skills', 'store.backend', 'account.access', 'app.lifecycle', 'app.attention']

/** What makes a module a plugin: an Enabled row, kept per person, per computer or per project. */
export interface PluginInfo {
  scope: SettingScope
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
