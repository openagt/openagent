import { vi } from 'vitest'
import { render as rtlRender, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ModuleHostContext, type ModuleAgent, type ModuleCommandResult, type ModuleHost } from '@openagt/dashboard/module'
import { ModulesContext, type MountedModules } from '../../openagent/dashboard/lib/use-modules.js'

// The dashboard as a module page sees it, faked: every service a spy, the module's commands
// answered by a table of the tickets command's outputs. `useModuleHost` hands a host that carries
// its own `runCommand` back as it is, so the pages under test never reach a real dashboard.

/** The `tickets` command's answers, keyed by project then by the command line joined with spaces. */
export type Answers = Record<string, Record<string, unknown>>

export interface FakeHost extends ModuleHost {
  runCommand: ReturnType<typeof vi.fn<ModuleHost['runCommand']>>
  act: ReturnType<typeof vi.fn<ModuleHost['act']>>
  openAgent: ReturnType<typeof vi.fn<ModuleHost['openAgent']>>
  openPage: ReturnType<typeof vi.fn<ModuleHost['openPage']>>
  startRun: ReturnType<typeof vi.fn<ModuleHost['startRun']>>
  configureRun: ReturnType<typeof vi.fn<ModuleHost['configureRun']>>
  agents: ReturnType<typeof vi.fn<ModuleHost['agents']>>
}

/** A host whose commands answer from `answers`; a command line with no answer fails, naming itself. */
export function fakeHost(answers: Answers = {}, agents: Record<string, ModuleAgent[]> = {}): FakeHost {
  const answer = async (projectId: string, args: string[]): Promise<ModuleCommandResult> => {
    const line = args.join(' ')
    const known = answers[projectId]?.[line]
    return known === undefined ? { ok: false, error: `no answer for ${projectId}: tickets ${line}` } : { ok: true, output: known }
  }
  return {
    package: '@openagt/skill-tickets',
    runCommand: vi.fn(answer),
    act: vi.fn(answer),
    read: vi.fn(async () => ({ ok: false as const, error: 'this module has no server part' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    startRun: vi.fn(async (_projectId: string, _prompt: string) => ({ ok: true as const, agentId: 'started' })),
    configureRun: vi.fn(),
    agents: vi.fn(async (projectId: string) => agents[projectId] ?? []),
    machines: vi.fn(async () => ({ version: '0.0.0', machines: [] })),
    addMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
}

/** No module offers anything on links: the default for pages whose tests are not about the slot. */
export const NO_MODULES: MountedModules = { pages: [], cards: [], linkActions: [], panels: [], runSlots: [], settings: [], loaded: true }

/** Render a page inside the fake host, and inside whatever link actions installed modules offer. */
export function renderWithHost(ui: ReactElement, host: ModuleHost, modules: MountedModules = NO_MODULES): RenderResult {
  return rtlRender(
    <ModulesContext.Provider value={modules}>
      <ModuleHostContext.Provider value={host}>{ui}</ModuleHostContext.Provider>
    </ModulesContext.Provider>,
  )
}
