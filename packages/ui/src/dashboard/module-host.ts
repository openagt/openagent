import { pathToFileURL } from 'node:url'
import { isRunId } from '../store/index.js'
import { cachedPrsForBranch, type LinkedPr } from './pull-requests.js'
import type { Cached } from './cache.js'
import type { GitAccess, ProjectRef, RunFound, RunQuestion, Settings, InboxLine } from '@openagt/hooks'
import { rpcKind, type MergeLookup, type ModuleOn, type RpcComputerHost, type RpcFunction, type RpcHost, type RpcKind } from '@openagt/hooks/rpc'

// The daemon's side of a module's server part (`@openagt/hooks/rpc`): the host a function is given
// (the settings; for a project's module, the project's folder and the project, where its runs have
// their work, the questions they wait on, a line said to one, a landing written down on one's
// record, how git reaches a remote as an account, and what the modules on give its runs) and the one way a function is
// called. Where a run's work is, is its host's to say; what a module makes of it is its own.

/** What {@link serverHost} reads and says through. */
export interface ServerHostDeps {
  /** The project the call is in, as a hook is given it; none for a session with no project. */
  project: () => Promise<ProjectRef | undefined>
  /** Where a run of the project has its work, as the run's host says it (`RunHost.find`). */
  find: (agentId: string) => Promise<RunFound | undefined>
  /** The questions a run of the project still waits on, as its events say. */
  questions: (agentId: string) => Promise<RunQuestion[]>
  /** Say one line to a run of the project through its host; throws why it is not said. */
  say: (agentId: string, line: InboxLine) => Promise<void>
  /** Write down on a run's record that its work was landed; throws why it is not written. */
  landed: (agentId: string, landed: { commit: string; from: string }) => Promise<void>
  /** How git reaches a remote as an account, as the distribution's `account.access` says. */
  gitAccess: (remote: string) => Promise<GitAccess | undefined>
  /** The modules on in the project, with what each gives its runs. */
  modulesOn: (opts?: { every?: boolean }) => Promise<ModuleOn[]>
  /** The project's pull requests from a branch, as the git host last said; the production reader when absent. */
  prs?: (root: string, branch: string) => Promise<Cached<LinkedPr[]>>
}

/** The host a function of a module of the computer's is given, called in no project. */
export function computerHost(settings: Settings): RpcComputerHost {
  return { settings }
}

/** The host a function called in the project at `root` is given. A string that is no run's id is never asked about, nor said anything. */
export function serverHost(root: string, settings: Settings, deps: ServerHostDeps): RpcHost {
  return {
    settings,
    root,
    project: deps.project,
    modulesOn: deps.modulesOn,
    async run(agentId: string): Promise<RunFound | undefined> {
      if (typeof agentId !== 'string' || !isRunId(agentId)) return undefined
      return deps.find(agentId)
    },
    async questions(agentId: string): Promise<RunQuestion[]> {
      if (typeof agentId !== 'string' || !isRunId(agentId)) return []
      return deps.questions(agentId)
    },
    async say(agentId: string, line: InboxLine): Promise<void> {
      if (typeof agentId !== 'string' || !isRunId(agentId)) throw new Error('unknown session')
      return deps.say(agentId, line)
    },
    async landed(agentId: string, landed: { commit: string; from: string }): Promise<void> {
      if (typeof agentId !== 'string' || !isRunId(agentId)) throw new Error('unknown session')
      return deps.landed(agentId, landed)
    },
    gitAccess: remote => deps.gitAccess(remote),
    async mergeCommit(branch: string, number: number): Promise<MergeLookup> {
      const read = await (deps.prs ?? cachedPrsForBranch)(root, branch).catch((): Cached<LinkedPr[]> => ({ value: undefined, pending: false }))
      if (read.pending && read.value === undefined) return { pending: true }
      const pr = read.value?.find(pr => pr.number === number)
      return pr?.mergeCommit ? { pending: false, commit: pr.mergeCommit, ...(pr.headRefOid ? { head: pr.headRefOid } : {}) } : { pending: false }
    },
  }
}

/** One function of a server part, as the daemon calls it: with the host of the call it is, a project's or the computer's. */
type ServerFunction = RpcFunction<object, unknown, RpcComputerHost>

/** The functions of each server part, by name, imported once per daemon, by its file: every export it wraps as a read or an act. */
const imported = new Map<string, Promise<Map<string, ServerFunction> | undefined>>()

function load(file: string): Promise<Map<string, ServerFunction> | undefined> {
  let loading = imported.get(file)
  if (!loading) {
    loading = import(pathToFileURL(file).href).then(
      (module: Record<string, unknown>) => new Map(Object.entries(module).flatMap(([name, value]) => (rpcKind(value) ? [[name, value as ServerFunction]] : []))),
      () => undefined,
    )
    imported.set(file, loading)
  }
  return loading
}

/** Whether function `name` of the server part at `file` only reads or changes something; undefined when the part has no such function. */
export async function functionKind(file: string, name: string): Promise<RpcKind | undefined> {
  return rpcKind((await load(file))?.get(name))
}

/** How large the input of one call may be, as JSON: what a page asks with, never a payload. */
export const MAX_CALL_INPUT = 16 * 1024
/** How long one call may take before it answers an error instead. */
export const CALL_TIMEOUT_MS = 20_000

/** What a call answered: its JSON, or why there is none. */
export type ModuleCallResult = { ok: true; output: unknown } | { ok: false; error: string }

/**
 * Call function `name` of the server part at `file` with `host` and `input`. Refused: a part that
 * did not load, a function it does not have, an input that is not an object or is too large. A
 * function that throws or runs past {@link CALL_TIMEOUT_MS} answers an error; nothing a function
 * does stops the daemon.
 */
export async function callModuleFunction(file: string, name: string, host: RpcComputerHost, input: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<ModuleCallResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'a call takes an object' }
  if (JSON.stringify(input).length > MAX_CALL_INPUT) return { ok: false, error: 'the call input is too large' }
  const functions = await load(file)
  if (!functions) return { ok: false, error: 'the module’s server part did not load' }
  const fn = functions.get(name)
  if (!fn) return { ok: false, error: `the module has no function ${name}` }
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<ModuleCallResult>(resolve => {
    timer = setTimeout(() => resolve({ ok: false, error: `the call ${name} took too long` }), timeoutMs)
  })
  try {
    return await Promise.race([
      fn(host, input).then(
        (output): ModuleCallResult => ({ ok: true, output: output ?? null }),
        (error: unknown): ModuleCallResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}
