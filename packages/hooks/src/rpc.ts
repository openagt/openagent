// RPC (#2394), a utility and not a hook: nothing is ordered, and there are never two
// implementations. A module's server part (its package's `./server` entry) exports functions,
// each wrapped as `read(fn)` or `act(fn)`, and `ui` serves each one at `/_rpc/<module>/<name>`.
// Its UI part calls them through a client typed with `typeof import('./server')` ({@link RpcClient},
// {@link ComputerRpcClient}), so renaming a function on one side is a type error on the other.
// Whether a function only reads is its own word: after one that changes something, the project's
// data is taken in from origin again, and what was read of it is read anew.
import type { GitAccounts } from './account.js'
import type { InboxLine } from './agent.js'
import type { ProjectRef } from './project.js'
import type { RunFound, RunQuestion } from './run.js'
import type { Settings } from './settings.js'

/** Where a pull request stands on the git host: still being asked, or answered (with its merge commit when merged, and the last commit of the branch it merged, when the git host says it). */
export type MergeLookup = { pending: true } | { pending: false; commit?: string; head?: string }

/** What every function is handed: the settings, read and saved through the store, the registered projects, and OpenAgent's accounts at the git hosts. */
export interface RpcComputerHost {
  readonly settings: Settings
  /** The projects of this computer's registry, in its order. */
  projects(): Promise<ProjectRef[]>
  readonly accounts: GitAccounts
}

/** What a function of a project's module is handed: also the project it is called in, and where its runs have their work. */
export interface RpcHost extends RpcComputerHost {
  /** The project's folder: an absolute path. */
  root: string
  /**
   * The project the call is in, as a hook is given it: what a setting kept per project is read
   * and saved for. None for a session with no project, whose folder is no project's.
   */
  project(): Promise<ProjectRef | undefined>
  /** Where one run of the project has its work, as the run's host says (`RunHost.find`); undefined when the id names no run. */
  run(agentId: string): Promise<RunFound | undefined>
  /** The commit pull request `number` of `branch` merged as, as the project's git host says. */
  mergeCommit(branch: string, number: number): Promise<MergeLookup>
  /** The questions one run of the project still waits on, in the order asked: none for a run waiting on none, or an id that names no run. */
  questions(agentId: string): Promise<RunQuestion[]>
  /**
   * Say one line to a run of the project, through its host (`RunHost.steer`): a working run takes
   * it between two of its agent's steps, an ended one goes on with it. Throws, in words for the
   * person, where it cannot be said: a run another computer started, say.
   */
  say(agentId: string, line: InboxLine): Promise<void>
  /**
   * The modules on in the project, in the distribution's order, each with what it gives the
   * project's runs; for a session with no project, the ones it has as the distribution starts them.
   * With `every`, every module of the distribution, the plugins that are off too: what a profile,
   * made for any project, can leave out.
   */
  modulesOn(opts?: { every?: boolean }): Promise<ModuleOn[]>
}

/** A module on in a project, and what it gives the project's runs. */
export interface ModuleOn {
  /** The module, by its name. */
  name: string
  /** It is a plugin: a run can go without it (`RunOptions.plugins`). */
  plugin: boolean
  /** The skills it gives the runs, by name. */
  skills: string[]
  /** It has a step of the runs' pipeline. */
  steps: boolean
}

/** Whether a function only reads, or changes something. */
export type RpcKind = 'read' | 'act'

/**
 * One function of a module's server part: called with a JSON object, bounded in size, its answer
 * JSON. A project's module's is called in one project (`RpcHost`); the input's `agentId`, when it
 * has one, names the run the call is about. A module of the computer's is called in none, and
 * handed only what every function is (`RpcComputerHost`).
 */
export interface RpcFunction<I extends object = object, O = unknown, H extends RpcComputerHost = RpcHost> {
  (host: H, input: I): Promise<O>
  /** Whether it only reads ({@link read}) or changes something ({@link act}). */
  readonly rpc: RpcKind
}

function wrapped<I extends object, O, H extends RpcComputerHost>(rpc: RpcKind, fn: (host: H, input: I) => Promise<O>): RpcFunction<I, O, H> {
  return Object.assign((host: H, input: I) => fn(host, input), { rpc })
}

/** A function that only reads. */
export function read<I extends object, O, H extends RpcComputerHost = RpcHost>(fn: (host: H, input: I) => Promise<O>): RpcFunction<I, O, H> {
  return wrapped('read', fn)
}

/** A function that changes something: what was read of the project's data is read anew after it. */
export function act<I extends object, O, H extends RpcComputerHost = RpcHost>(fn: (host: H, input: I) => Promise<O>): RpcFunction<I, O, H> {
  return wrapped('act', fn)
}

/** Whether `value` is a function wrapped by {@link read} or {@link act}, and which: undefined for anything else. */
export function rpcKind(value: unknown): RpcKind | undefined {
  if (typeof value !== 'function') return undefined
  const kind = (value as { rpc?: unknown }).rpc
  return kind === 'read' || kind === 'act' ? kind : undefined
}

/**
 * The client a project's module's UI part calls its server part through, typed by the server file
 * itself (`RpcClient<typeof import('../src/server.js')>`): each of its functions by its name, called
 * in one project with its input, answering what it answers. Anything else the file exports is none.
 */
export type RpcClient<Server> = {
  readonly [K in keyof Server as Server[K] extends RpcFunction<never, unknown> ? K : never]: Server[K] extends RpcFunction<infer I extends object, infer O> ? (projectId: string, input: I) => Promise<Awaited<O>> : never
}

/**
 * The same for a module of the computer's, whose functions are called in no project: each with its
 * input alone. A function that needs a project (`RpcHost`) is none of it.
 */
export type ComputerRpcClient<Server> = {
  readonly [K in keyof Server as Server[K] extends RpcFunction<never, unknown, RpcComputerHost> ? K : never]: Server[K] extends RpcFunction<infer I extends object, infer O, RpcComputerHost> ? (input: I) => Promise<Awaited<O>> : never
}
