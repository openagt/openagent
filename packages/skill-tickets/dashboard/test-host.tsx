import type { ModuleAgent } from '@openagt/dashboard/module'
import { answering, fakeHost as hostFor, type Answers, type FakeHost } from '@openagt/dashboard/module/testing'

export { NO_MODULES, renderWithHost, type Answers, type FakeHost } from '@openagt/dashboard/module/testing'

// The dashboard as a tickets page sees it, faked: the module's commands answered by a table of
// the tickets command's outputs, and each project's agents as `agents` lists them.

/** A host whose `tickets` command answers from `answers`; a command line with no answer fails, naming itself. */
export function fakeHost(answers: Answers = {}, agents: Record<string, ModuleAgent[]> = {}): FakeHost {
  const answer = answering('tickets', answers)
  return hostFor('@openagt/skill-tickets', {
    runCommand: answer,
    act: answer,
    startRun: async () => ({ ok: true as const, agentId: 'started' }),
    agents: async projectId => agents[projectId] ?? [],
  })
}
