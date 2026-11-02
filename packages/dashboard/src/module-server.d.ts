// `@openagt/dashboard/module-server`: what the daemon offers a module's server part.
//
// A module's server part is the file its package exports as `./server`. The daemon imports it once,
// in its own process, and calls one of its reads when the module's browser part asks for it
// (`host.read(name, input)` there). The server part imports nothing from OpenAgent at run time:
// these are types only, and its default export is a plain object that satisfies `ModuleServer`.

/** What the core knows about one run: facts, never a verdict about what the run's files are. */
export interface RunFacts {
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

/** What a read is given: the project it reads, and what the core knows about the project's runs. */
export interface ModuleServerHost {
  /** The project's folder: an absolute path. */
  root: string
  /** The facts about one run of the project, or undefined when the id names no run. */
  run(agentId: string): Promise<RunFacts | undefined>
  /** The commit pull request `number` of `branch` merged as, as the project's git host says. */
  mergeCommit(branch: string, number: number): Promise<MergeLookup>
}

/**
 * What a module's browser part sent with a read: JSON, bounded in size. `agentId`, when present,
 * names the run the read is about; a run relayed to a saved machine is read over there.
 */
export type ModuleReadInput = { agentId?: string } & Record<string, unknown>

/** One read of a module's server part: its answer must be JSON. */
export type ModuleRead = (host: ModuleServerHost, input: ModuleReadInput) => Promise<unknown>

/** What a module's `./server` file default-exports. */
export interface ModuleServer {
  reads: Record<string, ModuleRead>
}
