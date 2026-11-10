import { answering, fakeHost as hostFor, type Answers, type FakeHost } from '@openagt/dashboard/module/testing'

export { NO_MODULES, renderWithHost, type FakeHost } from '@openagt/dashboard/module/testing'

// The dashboard as the queue's card and page see it, faked: the module's commands answered by a
// table of the queue command's outputs, and every run started given an id of its own.

/** A host whose `queue` command answers from `answers`; a command line with no answer fails, naming itself. */
export function fakeHost(answers: Answers = {}): FakeHost {
  const answer = answering('queue', answers)
  let runs = 0
  return hostFor('@openagt/skill-queue', { runCommand: answer, act: answer, startRun: async () => ({ ok: true as const, agentId: `run-${++runs}` }) })
}
