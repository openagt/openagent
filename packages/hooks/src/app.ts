import type { ProjectRef } from './project.js'
import type { RunOptions } from './run.js'
import type { Settings } from './settings.js'
import type { Store } from './store.js'

/** What a module's life in the app is given. */
export interface AppContext {
  /**
   * The registered projects the module is on in: every one for a core module, or for a plugin kept
   * on per person or per computer; the ones whose Enabled row is on for a plugin kept per project.
   * Ask again each time: a person may switch it meanwhile.
   */
  projects(): Promise<ProjectRef[]>
  readonly store: Store
  readonly settings: Settings
  /** Aborted when the app stops: a module's own timers end with it. */
  readonly signal: AbortSignal
}

/** The app's life, for a module that does work of its own: its timers, its own process. */
export interface AppLifecycle {
  /** The app started: start the module's own background work. */
  started?(app: AppContext): void | Promise<void>
  /** The app is stopping: called for the modules that were started, the last started first. */
  stopping?(): void | Promise<void>
  /** A project was added: called for the modules that are on in it. */
  projectAdded?(project: ProjectRef, app: AppContext): void | Promise<void>
  /** A project was removed: called for every module, each cleaning up its own data. */
  projectRemoved?(project: ProjectRef, app: AppContext): void | Promise<void>
}

/** What fixes an item: one of the module's own `ui.action`s, by its id, or a page to open. */
export type AttentionFix = { label: string; action: string } | { label: string; href: string }

/** Something that needs the person: something to set up, or something waiting on them. */
export interface AttentionItem {
  kind: 'setup' | 'waiting'
  /** What it is about: this computer, the project asked about, or one of its runs. */
  scope: 'computer' | 'project' | 'run'
  /** The run it is about, for an item about a run. */
  run?: string
  /** What the person reads: "Claude Code is logged out". */
  words: string
  fix?: AttentionFix
}

/** What a module is asked what needs the person with: the project shown, and the run options picked when there are some. */
export interface AttentionArgs {
  project?: ProjectRef
  options?: RunOptions
}

/** What needs the person, as one module sees it. */
export type AppAttention = (args: AttentionArgs) => AttentionItem[] | Promise<AttentionItem[]>

/** An item, with the module that said it: the one whose `ui.action` its fix names. */
export interface Attention extends AttentionItem {
  module: string
}
