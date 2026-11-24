import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProjectRef } from './project.js'
import type { RunOptions, RunQuestion } from './run.js'
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
  /** Aborted when the app stops, or a plugin kept per person or per computer is switched off: a module's own timers end with it. */
  readonly signal: AbortSignal
  /** Where the app answers on this computer, for a module's own process to call it at; none before the app started. */
  readonly url?: string
}

/** What the app says of itself as it starts its modules ({@link AppContext}). */
export interface AppStart {
  /** Aborted when the app stops. */
  signal: AbortSignal
  url: string
}

/** The app's life, for a module that does work of its own: its timers, its own process. */
export interface AppLifecycle {
  /**
   * The app started, or the plugin was switched on since (one kept per person or per computer):
   * start the module's own background work. A plugin kept per project, or one that keeps its own
   * row, starts with the app wherever it is on, and its work asks where it is on now
   * ({@link AppContext.projects}, its row).
   */
  started?(app: AppContext): void | Promise<void>
  /** The app is stopping, or the plugin was switched off: called for the modules that were started, the last started first. */
  stopping?(): void | Promise<void>
  /** A project was added: called for the modules that are on in it. */
  projectAdded?(project: ProjectRef, app: AppContext): void | Promise<void>
  /** A project was removed: called for every module, each cleaning up its own data. */
  projectRemoved?(project: ProjectRef, app: AppContext): void | Promise<void>
}

/**
 * An address the app answers on its computer for a caller that is no page of its own: a browser
 * extension, a module's own process. Every path at `path` and below it is the route's. Nothing
 * checks who calls before it: the page's own check (the same origin) cannot hold for a caller
 * from elsewhere, so the route checks its caller itself, as a token it gave out.
 */
export interface AppRoute {
  /** Where it answers: `/_` and a name (`/_bridge`), and every path below that. */
  path: string
  /** Answer a request at the path or below it. */
  handle(req: IncomingMessage, res: ServerResponse): void | Promise<void>
}

/** What a route's path may be: `/_`, then a name of lower-case words joined by dashes. */
export const ROUTE_PATH = /^\/_[a-z][a-z0-9]*(-[a-z0-9]+)*$/

/** What fixes an item: one of the module's own `ui.action`s, by its id, or a page to open. */
export type AttentionFix = { label: string; action: string } | { label: string; href: string }

/** How a list marks an item at a glance: a question to answer, a pull request to merge, a branch never published, files never committed. */
export type AttentionMark = 'question' | 'pull-request' | 'branch' | 'changes'

/**
 * Something that needs the person: something to set up, or something waiting on them. A list
 * shows it as a row: what is needed, what it is about, then the rest; a row of an item about a
 * run opens the run, else what fixes it.
 */
export interface AttentionItem {
  kind: 'setup' | 'waiting'
  /**
   * What it is about: this computer, the project asked about, or a run: one of its runs (`run`),
   * or, with no `run`, the run the options asked with would start, which it stops. The shell draws
   * the `setup` items about this computer in its onboarding card and the person's menu, those
   * about the project on the project's pages, and those about the run to start above the message
   * box that would start it.
   */
  scope: 'computer' | 'project' | 'run'
  /** The run it is about, for an item about one of the project's runs. */
  run?: string
  /**
   * Which of the module's items about the project this is: the same thing said again keeps its
   * id, so it is new only once (a notification of it is not said twice), and a list keys its row
   * on it. Its scope and run when unsaid.
   */
  id?: string
  /** What the person reads first, in a few words: "Needs answer", "Claude Code is logged out". */
  words: string
  /** What it is about, as every list names it: the run's name, a pull request's title. */
  title?: string
  /** What it adds after that: the question the run asks, "2 files", "#12". */
  detail?: string
  /** Since when it waits, ISO: a list shows the newest first. */
  since?: string
  /** A plain dot when unsaid. */
  mark?: AttentionMark
  fix?: AttentionFix
}

/**
 * What a module is asked what needs the person with: the project shown, the run options picked
 * when there are some, and, with a project, its runs that wait on the person.
 */
export interface AttentionArgs {
  project?: ProjectRef
  options?: RunOptions
  /** The project's runs that ended waiting on the person, newest first, each with what it waits on. */
  waiting?: () => Promise<WaitingRun[]>
}

/** A run that ended waiting on the person, as a module that says what needs them reads it. */
export interface WaitingRun {
  id: string
  /** What every list names it by: its short name, else what it was asked; none for a run that has neither yet. */
  name?: string
  /** When it ended, ISO. */
  endedAt?: string
  /** The questions it still waits on, in the order asked: the last is the one it asks now. */
  questions: RunQuestion[]
}

/** What needs the person, as one module sees it. */
export type AppAttention = (args: AttentionArgs) => AttentionItem[] | Promise<AttentionItem[]>

/** An item, with the module that said it: the one whose `ui.action` its fix names. */
export interface Attention extends AttentionItem {
  module: string
}

/**
 * What every module on said needs the person, in the distribution's order, and whether each one
 * answered: one that threw gave nothing, so its items are not known to be gone, and a reader that
 * tells new items from old ones takes none of them as gone.
 */
export interface AttentionRead {
  items: Attention[]
  whole: boolean
}
