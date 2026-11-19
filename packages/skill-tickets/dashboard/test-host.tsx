import type { ModuleAgent } from '@openagt/ui/module'
import { answering, answeringCalls, fakeHost as hostFor, type Answers, type FakeHost } from '@openagt/ui/module/testing'

export { NO_MODULES, renderWithHost, type Answers, type FakeHost } from '@openagt/ui/module/testing'

// The dashboard as a tickets page sees it, faked: the module's server part and its command
// answered by one table, a read by its function (`list`, `meta`, `show <file>`) and a change by the
// command's line (`release <file> --force`), and each project's agents as `agents` lists them.

/** A host whose server part and `tickets` command answer from `answers`; a call or a command line with no answer fails, naming itself. */
export function fakeHost(answers: Answers = {}, agents: Record<string, ModuleAgent[]> = {}): FakeHost {
  return hostFor('@openagt/skill-tickets', {
    call: answeringCalls(answers),
    act: answering('tickets', answers),
    startRun: async () => ({ ok: true as const, agentId: 'started' }),
    agents: async projectId => agents[projectId] ?? [],
  })
}
