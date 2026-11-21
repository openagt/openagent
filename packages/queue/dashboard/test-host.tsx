import { answering, answeringCalls, fakeHost as hostFor, type Answers, type FakeHost } from '@openagt/ui/module/testing'
import type { ModuleCallResult } from '@openagt/ui/module'
import type { PlacedEntry } from '../src/queue.js'
import type { Taker } from '../src/server.js'

export { NO_MODULES, renderWithHost, type FakeHost } from '@openagt/ui/module/testing'

// The dashboard as the queue's card and page see it, faked: the module's server part answered by
// each project's entries, its command's changes by a table of the command's outputs, and every
// run started given an id of its own.

/** Entries given by their lines alone: each in no priority section. */
export const placed = (...lines: string[]): PlacedEntry[] => lines.map(entry => ({ entry }))

/**
 * A host whose server part answers each project's `entries` from `queues`, and who takes from the
 * queue with `taker`, never with `pending`, failing without one; its `queue` command answers from
 * `commands`. A call or a command line with no answer fails, naming itself.
 */
export function fakeHost(queues: Record<string, PlacedEntry[]> = {}, taker?: Taker | 'pending', commands: Answers = {}): FakeHost {
  const entries = answeringCalls(Object.fromEntries(Object.entries(queues).map(([projectId, placed]) => [projectId, { entries: placed }])))
  const answer = answering('queue', commands)
  let runs = 0
  const call = async (projectId: string, name: string, input: object): Promise<ModuleCallResult> => {
    if (name === 'entries') return entries(projectId, name, input)
    if (name !== 'taker' || taker === undefined) return { ok: false, error: `no answer for ${projectId}: ${name}` }
    return taker === 'pending' ? new Promise(() => {}) : { ok: true, output: taker }
  }
  return hostFor('@openagt/queue', { act: answer, call, startRun: async () => ({ ok: true as const, agentId: `run-${++runs}` }) })
}
