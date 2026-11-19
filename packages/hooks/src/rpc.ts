// RPC (#2394), a utility and not a hook: nothing is ordered, and there are never two
// implementations. A module's server part (its package's `./server` entry) exports functions,
// each wrapped as `read(fn)` or `act(fn)`, and `ui` serves each one at `/_rpc/<module>/<name>`.
// Its UI part calls them through a client typed with `typeof import('./server')` ({@link RpcClient}),
// so renaming a function on one side is a type error on the other. Whether a function only reads
// is its own word: a computer that lets its server only watch calls the reads alone.

/** What `ui` knows about one run of the project: facts, never a verdict about what the run's files are. */
export interface RunFound {
  /** The run's own checkout while it has one: an absolute path. */
  checkout?: string
  /** The run's record, when the project keeps one for it. */
  record?: {
    status?: string
    /** The machine the run ran on. */
    host?: string
    /** The branch the run left its work on, by its last recorded name. */
    branch?: string
    pr?: { number: number }
    /** The branch the run was told to start from, by its name; absent on a run that started from origin's default branch. */
    base?: string
    /** The commit the run's own work begins at, for a run that made its own branch: what its changes are measured from when the default branch cannot tell them. */
    baseCommit?: string
    /** The last commit of the run's work, once its main agent landed it: its branch is gone, and its work is read here. */
    landed?: string
  }
  /** The run ended on this machine without a pull request and was not landed, so a branch it no longer has held nothing. */
  changedNothing: boolean
}

/** Where a pull request stands on the git host: still being asked, or answered (with its merge commit when merged, and the last commit of the branch it merged, when the git host says it). */
export type MergeLookup = { pending: true } | { pending: false; commit?: string; head?: string }

/** What a function is handed: the project it is called in, and what `ui` knows about the project's runs. */
export interface RpcHost {
  /** The project's folder: an absolute path. */
  root: string
  /** What is known of one run of the project, or undefined when the id names no run. */
  run(agentId: string): Promise<RunFound | undefined>
  /** The commit pull request `number` of `branch` merged as, as the project's git host says. */
  mergeCommit(branch: string, number: number): Promise<MergeLookup>
}

/** Whether a function only reads, or changes something. */
export type RpcKind = 'read' | 'act'

/**
 * One function of a module's server part: called in a project with a JSON object, bounded in size,
 * its answer JSON. The input's `agentId`, when it has one, names the run the call is about, and a
 * run that works on a saved machine is called over there.
 */
export interface RpcFunction<I extends object = object, O = unknown> {
  (host: RpcHost, input: I): Promise<O>
  /** Whether it only reads ({@link read}) or changes something ({@link act}). */
  readonly rpc: RpcKind
}

function wrapped<I extends object, O>(rpc: RpcKind, fn: (host: RpcHost, input: I) => Promise<O>): RpcFunction<I, O> {
  return Object.assign((host: RpcHost, input: I) => fn(host, input), { rpc })
}

/** A function that only reads: a computer that lets its server only watch calls it. */
export function read<I extends object, O>(fn: (host: RpcHost, input: I) => Promise<O>): RpcFunction<I, O> {
  return wrapped('read', fn)
}

/** A function that changes something: refused to a caller that may only watch. */
export function act<I extends object, O>(fn: (host: RpcHost, input: I) => Promise<O>): RpcFunction<I, O> {
  return wrapped('act', fn)
}

/** Whether `value` is a function wrapped by {@link read} or {@link act}, and which: undefined for anything else. */
export function rpcKind(value: unknown): RpcKind | undefined {
  if (typeof value !== 'function') return undefined
  const kind = (value as { rpc?: unknown }).rpc
  return kind === 'read' || kind === 'act' ? kind : undefined
}

/**
 * The client a module's UI part calls its server part through, typed by the server file itself
 * (`RpcClient<typeof import('../src/server.js')>`): each of its functions by its name, called in
 * one project with its input, answering what it answers. Anything else the file exports is none.
 */
export type RpcClient<Server> = {
  readonly [K in keyof Server as Server[K] extends RpcFunction<never, unknown> ? K : never]: Server[K] extends RpcFunction<infer I extends object, infer O> ? (projectId: string, input: I) => Promise<Awaited<O>> : never
}
