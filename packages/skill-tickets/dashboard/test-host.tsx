import type { ReactElement } from 'react'
import type { ModuleAgent, ModuleHost } from '@openagt/ui/module'
import markdown from '@openagt/ui-renderer-markdown/dashboard'
import { answering, answeringCalls, computerRenders, fakeHost as hostFor, mountedOf, renderWithHost as rendered, type Answers, type FakeHost, type MountedModules } from '@openagt/ui/module/testing'

export { NO_MODULES, type Answers, type FakeHost } from '@openagt/ui/module/testing'

/** What draws markdown on a tickets page, as the dashboard has it: the module that draws it. */
export const MARKDOWN = computerRenders(markdown, '@openagt/ui-renderer-markdown')

/** The modules a tickets page is drawn beside: only the one that draws markdown. */
export const WITH_MARKDOWN: MountedModules = mountedOf({ renders: MARKDOWN })

/** Render `ui` as the dashboard draws a module (`@openagt/ui/module/testing`), its markdown drawn as the dashboard draws it unless `modules` say otherwise. */
export function renderWithHost(ui: ReactElement, host: ModuleHost, modules: MountedModules = WITH_MARKDOWN) {
  return rendered(ui, host, modules)
}

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
