import { render, type RenderResult } from '@testing-library/react'
import { useState, type ReactElement, type ReactNode } from 'react'
import { vi, type Mock } from 'vitest'
import { PaneHeaderContext } from '../components/PaneHeader.js'
import { ModulesContext, type MountedModules } from '../lib/use-modules.js'
import { ModuleHostContext, type ModuleCommandResult, type ModuleHost } from './index.js'

// What a module's tests need of the dashboard, faked (`@openagt/dashboard/module/testing`, which
// `moduleTests` in `./vite.ts` resolves): a host whose every service is a spy, and a render inside
// it. A service the host gains is faked here once, instead of in every module's tests.

export type { MountedModules }

/** The host with every service a spy, so a test reads what was asked of it: `host.openPage.mock.calls`. */
export type FakeHost = { [K in keyof ModuleHost]: ModuleHost[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : ModuleHost[K] }

/**
 * A host for the module of `pkg`. Each service answers as a dashboard with nothing to give would
 * (no commands, no agents, no machines), unless `services` says how it answers in this test.
 */
export function fakeHost(pkg: string, services: Partial<Omit<ModuleHost, 'package'>> = {}): FakeHost {
  const nothing = async () => ({ ok: false as const, error: 'not in this test' })
  const host: Omit<ModuleHost, 'package'> = {
    runCommand: nothing,
    act: nothing,
    runComputerCommand: nothing,
    runComputerCommandOn: nothing,
    read: nothing,
    openAgent: () => {},
    openPage: () => {},
    pageHref: segment => `/${segment}`,
    openSettings: () => {},
    gitHostPeople: async () => [],
    startRun: nothing,
    configureRun: () => {},
    agents: async () => [],
    machines: async () => ({ version: '0.0.0', machines: [] }),
    addMachine: nothing,
    removeMachine: nothing,
    renameMachine: nothing,
    renameComputer: nothing,
    letMachineIn: nothing,
    machineCode: nothing,
    computersThrough: async () => ({ ok: true as const, computers: [] }),
    addComputerThrough: nothing,
    machinePerson: async () => ({ ok: false as const, error: 'not in this test', unknown: true as const }),
    useLoginsOn: nothing,
    syncDataOn: nothing,
    agentDataRemote: async () => undefined,
    machineAccounts: async () => null,
    removeMachineAccount: nothing,
    removeMachineDevice: nothing,
    watchScreen: async () => undefined,
    sendToScreen: async () => false,
    ...services,
  }
  const spies = Object.entries(host).map(([name, service]) => [name, vi.isMockFunction(service) ? service : vi.fn(service)])
  return { package: pkg, ...Object.fromEntries(spies) } as FakeHost
}

/** A command's outputs, keyed by project, then by its arguments joined with spaces. */
export type Answers = Record<string, Record<string, unknown>>

/** How a module's command answers from `answers`; a command line with no answer fails, naming itself. */
export function answering(command: string, answers: Answers): (projectId: string, args: string[]) => Promise<ModuleCommandResult> {
  return async (projectId, args) => {
    const line = args.join(' ')
    const known = answers[projectId]?.[line]
    return known === undefined ? { ok: false, error: `no answer for ${projectId}: ${command} ${line}` } : { ok: true, output: known }
  }
}

/** No other module is installed. */
export const NO_MODULES: MountedModules = { pages: [], cards: [], linkActions: [], panels: [], runSlots: [], settings: [], everyPage: [], loaded: true }

/**
 * Render `ui` as the dashboard draws a module: inside `host`, beside the installed `modules` (none
 * unless said), in a pane's card for a module that fills a pane's header. `rerender` keeps all three.
 */
export function renderWithHost(ui: ReactElement, host: ModuleHost, modules: MountedModules = NO_MODULES): RenderResult {
  const wrap = (node: ReactNode) => (
    <ModulesContext.Provider value={modules}>
      <ModuleHostContext.Provider value={host}>
        <PaneCard>{node}</PaneCard>
      </ModuleHostContext.Provider>
    </ModulesContext.Provider>
  )
  const result = render(wrap(ui))
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)) }
}

/** A pane's card as the dashboard draws it: a header with the two places a pane fills, over the pane. */
function PaneCard({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  return (
    <section>
      <header>
        <div ref={setTitle} data-testid="pane-title" />
        <div ref={setActions} data-testid="pane-actions" />
      </header>
      <PaneHeaderContext.Provider value={{ title, actions }}>{children}</PaneHeaderContext.Provider>
    </section>
  )
}
