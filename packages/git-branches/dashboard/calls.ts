import { rpcClient, usePolled, type ModuleHost, type ReadState } from '@openagt/ui/module'
import type { Handoff } from '../src/server.js'

// The module's calls of its own server part (`../src/server.ts`), typed by it, in the project the
// place is drawn in. Each throws the reason a call failed, so a polled read keeps the last answer it had.

export type { Handoff, HandoffCommit, HandoffFile, Pressed, StartFrom, StartPlaces } from '../src/server.js'

/** The client of the server part, for a host that calls in a project: a place's (`UiHost`) or a view's (`ModuleHost`). */
export const server = (host: Pick<ModuleHost, 'call'>) => rpcClient<typeof import('../src/server.js')>(host)

/** A run, or one of its copies of repos (`repo`), as a place names it. */
export interface WorkOn {
  projectId: string
  agentId: string
  repo?: string
}

/** How long one read of a run's branch answers every place that asks for it: the bar's summary and each of its offers ask at once. */
const SHARED_MS = 1_000
const shared = new Map<string, { at: number; read: Promise<Handoff | null> }>()

/** What the run's branch, or a copy's, holds: one read shared by the places that ask within a second. */
export function readHandoff(host: Pick<ModuleHost, 'call'>, on: WorkOn): Promise<Handoff | null> {
  const key = `${on.projectId}\n${on.agentId}\n${on.repo ?? ''}`
  const known = shared.get(key)
  if (known && Date.now() - known.at < SHARED_MS) return known.read
  const read = server(host).handoff(on.projectId, { agentId: on.agentId, ...(on.repo !== undefined ? { repo: on.repo } : {}) })
  shared.set(key, { at: Date.now(), read })
  read.catch(() => shared.delete(key))
  return read
}

/** Forget what was read of the run's branch: a press changed it. */
export function forgetHandoff(on: WorkOn): void {
  shared.delete(`${on.projectId}\n${on.agentId}\n${on.repo ?? ''}`)
}

/** How often an ended run's branch is read while it shows: a push or a merge from a terminal changes what it says. */
const REST_MS = 15_000

/**
 * What the run's branch, or a copy's, holds, read while `enabled` (the run has ended: a branch still
 * being written to has nothing to hand off yet), remembered per run in this browser, so going back
 * to a run shows its last answer at once.
 */
export function useHandoff(host: ModuleHost, on: WorkOn, enabled: boolean, again: unknown = 0): { handoff: Handoff | null; state: ReadState } {
  const key = `git-branches:handoff:${on.projectId}:${on.agentId}${on.repo !== undefined ? `:${on.repo}` : ''}`
  const { value, state } = usePolled<Handoff | null>(enabled ? () => readHandoff(host, on) : null, null, REST_MS, [on.projectId, on.agentId, on.repo, enabled, again], { remember: key, stored: true })
  return { handoff: value, state }
}

/** The project's main branch by name, when the work was measured from it; work measured from a commit only knows it as "the main branch". */
export function mainBranchName(base: string | undefined): string {
  return base !== undefined && !/^[0-9a-f]{40}$/.test(base) ? base.replace(/^origin\//, '') : 'the main branch'
}

/**
 * Whether the branch gives the bar above the message box something to say: work it holds
 * (commits, changed files, files left uncommitted), work that was landed, or a branch that is gone
 * with work on it. A run that changed nothing has nothing said, and so no row.
 */
export function handoffSays(handoff: Handoff | null | undefined): boolean {
  if (!handoff) return false
  if (handoff.landed) return true
  if (!handoff.exists) return !handoff.unchanged
  return !handoff.empty || handoff.commits.length > 0 || Boolean(handoff.pendingFiles?.length)
}
