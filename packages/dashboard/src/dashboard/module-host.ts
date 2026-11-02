import { pathToFileURL } from 'node:url'
import { findAgent, findCheckout, isRunId, projectBranches, type BranchesFor } from '../store/index.js'
import { agentBranchFor, leftNothing } from './agent-handoff.js'
import { cachedPrsForBranch, type LinkedPr } from './pull-requests.js'
import type { Cached } from './cache.js'
import type { MergeLookup, ModuleRead, ModuleReadInput, ModuleServer, ModuleServerHost, RunFacts } from '../module-server.js'

// The daemon's side of a module's server part: the host a read is given (a project's folder and
// the facts about its runs) and the one way a read is called. The facts are the core's; what a
// module makes of them is its own.

/** What {@link serverHost} reads through; each defaults to the production reader. */
export interface ServerHostDeps {
  branches?: BranchesFor
  agent?: (root: string, agentId: string) => Promise<{ id: string; status?: string; host?: string; branch?: string; pr?: { number: number }; base?: string; baseCommit?: string; landed?: string } | undefined>
  /** This machine's name, against a run's `host`. */
  host?: string
  prs?: (root: string, branch: string) => Promise<Cached<LinkedPr[]>>
}

/** The host a read of the project at `root` is given. */
export function serverHost(root: string, deps: ServerHostDeps = {}): ModuleServerHost {
  return {
    root,
    async run(agentId: string): Promise<RunFacts | undefined> {
      if (typeof agentId !== 'string' || !isRunId(agentId)) return undefined
      const checkout = await findCheckout(root, agentId, deps.branches ?? projectBranches)
      const agent = await (deps.agent ?? findAgent)(root, agentId).catch(() => undefined)
      if (!checkout && !agent) return undefined
      const branch = agent && agentBranchFor(agent)
      return {
        ...(checkout ? { checkout: checkout.path } : {}),
        ...(agent
          ? {
              record: {
                ...(agent.status !== undefined ? { status: agent.status } : {}),
                ...(agent.host !== undefined ? { host: agent.host } : {}),
                ...(branch !== undefined ? { branch } : {}),
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

/** Each server part, imported once per daemon, by its file. */
const imported = new Map<string, Promise<ModuleServer | undefined>>()

function load(file: string): Promise<ModuleServer | undefined> {
  let loading = imported.get(file)
  if (!loading) {
    loading = import(pathToFileURL(file).href).then(
      (module: { default?: unknown }) => {
        const server = module.default as Partial<ModuleServer> | undefined
        return server && typeof server === 'object' && server.reads && typeof server.reads === 'object' ? (server as ModuleServer) : undefined
      },
      () => undefined,
    )
    imported.set(file, loading)
  }
  return loading
}

/** How large the input of one read may be, as JSON: what a page asks with, never a payload. */
export const MAX_READ_INPUT = 16 * 1024
/** How long one read may take before it answers an error instead. */
export const READ_TIMEOUT_MS = 20_000

/** What a read answered: its JSON, or why there is none. */
export type ModuleReadResult = { ok: true; output: unknown } | { ok: false; error: string }

/**
 * Call read `name` of the server part at `file` with `host` and `input`. Refused: a part that did
 * not load, a read it does not have, an input that is not an object or is too large. A read that
 * throws or runs past {@link READ_TIMEOUT_MS} answers an error; nothing a read does stops the daemon.
 */
export async function callModuleRead(file: string, name: string, host: ModuleServerHost, input: unknown, timeoutMs = READ_TIMEOUT_MS): Promise<ModuleReadResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'a read takes an object' }
  if (JSON.stringify(input).length > MAX_READ_INPUT) return { ok: false, error: 'the read input is too large' }
  const server = await load(file)
  if (!server) return { ok: false, error: 'the module’s server part did not load' }
  const read: ModuleRead | undefined = Object.hasOwn(server.reads, name) ? server.reads[name] : undefined
  if (typeof read !== 'function') return { ok: false, error: `the module has no read ${name}` }
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<ModuleReadResult>(resolve => {
    timer = setTimeout(() => resolve({ ok: false, error: `the read ${name} took too long` }), timeoutMs)
  })
  try {
    return await Promise.race([
      read(host, input as ModuleReadInput).then(
        (output): ModuleReadResult => ({ ok: true, output: output ?? null }),
        (error: unknown): ModuleReadResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}
