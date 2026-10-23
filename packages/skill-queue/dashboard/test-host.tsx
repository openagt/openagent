import { vi } from 'vitest'
import { render as rtlRender, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ModuleHostContext, type ModuleCommandResult, type ModuleHost } from '@openagt/dashboard/module'
import { ModulesContext, type MountedModules } from '../../openagent/dashboard/lib/use-modules.js'

// The dashboard as the module's card sees it, faked: every service a spy, the module's commands
// answered by a table of the queue command's outputs. `useModuleHost` hands a host that carries
// its own `runCommand` back as it is, so the card under test never reaches a real dashboard.

/** The `queue` command's answers, keyed by project then by the command line joined with spaces. */
export type Answers = Record<string, Record<string, unknown>>

export interface FakeHost extends ModuleHost {
  runCommand: ReturnType<typeof vi.fn<ModuleHost['runCommand']>>
  startRun: ReturnType<typeof vi.fn<ModuleHost['startRun']>>
  configureRun: ReturnType<typeof vi.fn<ModuleHost['configureRun']>>
  act: ReturnType<typeof vi.fn<ModuleHost['act']>>
  agents: ReturnType<typeof vi.fn<ModuleHost['agents']>>
  openAgent: ReturnType<typeof vi.fn<ModuleHost['openAgent']>>
  openPage: ReturnType<typeof vi.fn<ModuleHost['openPage']>>
}

/** A host whose commands answer from `answers`; a command line with no answer fails, naming itself. */
export function fakeHost(answers: Answers = {}): FakeHost {
  const answer = async (projectId: string, args: string[]): Promise<ModuleCommandResult> => {
    const line = args.join(' ')
    const known = answers[projectId]?.[line]
    return known === undefined ? { ok: false, error: `no answer for ${projectId}: queue ${line}` } : { ok: true, output: known }
  }
  let runs = 0
  return {
    package: '@openagt/skill-queue',
    runCommand: vi.fn(answer),
    act: vi.fn<ModuleHost['act']>(answer),
    runComputerCommand: vi.fn(async () => ({ ok: false as const, error: 'not the computer\'s' })),
    runComputerCommandOn: vi.fn(async () => ({ ok: false as const, error: 'not the computer\'s' })),
    read: vi.fn(async () => ({ ok: false as const, error: 'this module has no server part' })),
    openAgent: vi.fn<ModuleHost['openAgent']>(),
    openPage: vi.fn<ModuleHost['openPage']>(),
    pageHref: (segment: string) => `/${segment}`,
    startRun: vi.fn(async () => ({ ok: true as const, agentId: `run-${++runs}` })),
    configureRun: vi.fn(),
    agents: vi.fn<ModuleHost['agents']>(async () => []),
    machines: vi.fn(async () => ({ version: '0.0.0', machines: [] })),
    addMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    removeMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    renameMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    letMachineIn: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    machineCode: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    computersThrough: vi.fn(async () => ({ ok: true as const, computers: [] })),
    machinePerson: vi.fn(async () => ({ ok: false as const, error: 'no person there', unknown: true as const })),
    removeMachineDevice: vi.fn(async () => ({ ok: false as const, error: 'no person there' })),
    addComputerThrough: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
}

/** No other module is installed: the card is rendered with nothing but its own package. */
export const NO_MODULES: MountedModules = { pages: [], cards: [], linkActions: [], panels: [], runSlots: [], settings: [], loaded: true }

/** Render the card or the page inside the fake host, with no other module mounted unless `modules` says which are. */
export function renderWithHost(ui: ReactElement, host: ModuleHost, modules: MountedModules = NO_MODULES): RenderResult {
  return rtlRender(
    <ModulesContext.Provider value={modules}>
      <ModuleHostContext.Provider value={host}>{ui}</ModuleHostContext.Provider>
    </ModulesContext.Provider>,
  )
}
