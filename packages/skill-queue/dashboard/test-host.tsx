import { answering, fakeHost as hostFor, type Answers, type FakeHost } from '@openagt/ui/module/testing'
import type { ModuleCallResult } from '@openagt/ui/module'
import type { Taker } from '../src/server.js'

export { NO_MODULES, renderWithHost, type FakeHost } from '@openagt/ui/module/testing'

// The dashboard as the queue's card and page see it, faked: the module's commands answered by a
// table of the queue command's outputs, and every run started given an id of its own.

/**
 * A host whose `queue` command answers from `answers`; a command line with no answer fails, naming
 * itself. Its server part answers who takes from the queue with `taker`, never with `pending`, and
 * fails without one.
 */
export function fakeHost(answers: Answers = {}, taker?: Taker | 'pending'): FakeHost {
  const answer = answering('queue', answers)
  let runs = 0
  const call = async (_projectId: string, name: string): Promise<ModuleCallResult> => {
    if (name !== 'taker' || taker === undefined) return { ok: false, error: `no answer for ${name}` }
    return taker === 'pending' ? new Promise(() => {}) : { ok: true, output: taker }
  }
  return hostFor('@openagt/skill-queue', { runCommand: answer, act: answer, call, startRun: async () => ({ ok: true as const, agentId: `run-${++runs}` }) })
}
