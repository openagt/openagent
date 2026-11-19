import { pathToFileURL } from 'node:url'
import { findAgent, findCheckout, isRunId, projectBranches, type BranchesFor } from '../store/index.js'
import { leftNothing } from './agent-handoff.js'
import { cachedPrsForBranch, type LinkedPr } from './pull-requests.js'
import type { Cached } from './cache.js'
import type { Settings } from '@openagt/hooks'
import { rpcKind, type MergeLookup, type RpcComputerHost, type RpcFunction, type RpcHost, type RpcKind, type RunFound } from '@openagt/hooks/rpc'

// The daemon's side of a module's server part (`@openagt/hooks/rpc`): the host a function is given
// (the settings; for a project's module, the project's folder and what is known of its runs) and the
// one way a function is called. What is known is the core's; what a module makes of it is its own.

/** What {@link serverHost} reads through; each defaults to the production reader. */
export interface ServerHostDeps {
  branches?: BranchesFor
  agent?: (root: string, agentId: string) => Promise<{ id: string; status?: string; host?: string; branch?: string; pr?: { number: number }; base?: string; baseCommit?: string; landed?: string } | undefined>
  /** This machine's name, against a run's `host`. */
  host?: string
  prs?: (root: string, branch: string) => Promise<Cached<LinkedPr[]>>
}

/** The host a function of a module of the computer's is given, called in no project. */
export function computerHost(settings: Settings): RpcComputerHost {
  return { settings }
}

/** The host a function called in the project at `root` is given. */
export function serverHost(root: string, settings: Settings, deps: ServerHostDeps = {}): RpcHost {
  return {
    settings,
    root,
    async run(agentId: string): Promise<RunFound | undefined> {
      if (typeof agentId !== 'string' || !isRunId(agentId)) return undefined
      const checkout = await findCheckout(root, agentId, deps.branches ?? projectBranches)
      const agent = await (deps.agent ?? findAgent)(root, agentId).catch(() => undefined)
      if (!checkout && !agent) return undefined
      return {
        ...(checkout ? { checkout: checkout.path } : {}),
        ...(agent
          ? {
              record: {
                ...(agent.status !== undefined ? { status: agent.status } : {}),
                ...(agent.host !== undefined ? { host: agent.host } : {}),
                ...(agent.branch !== undefined ? { branch: agent.branch } : {}),
                ...(agent.pr ? { pr: { number: agent.pr.number } } : {}),
                ...(agent.base !== undefined ? { base: agent.base } : {}),
                ...(agent.baseCommit !== undefined ? { baseCommit: agent.baseCommit } : {}),
                ...(agent.landed !== undefined ? { landed: agent.landed } : {}),
              },
            }
          : {}),
        changedNothing: agent ? leftNothing(agent, deps.host) : false,
      }
    },
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
