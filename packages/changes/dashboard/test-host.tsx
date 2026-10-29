import { vi } from 'vitest'
import { render as rtlRender, type RenderResult } from '@testing-library/react'
import { useState, type ReactElement, type ReactNode } from 'react'
import { ModuleHostContext, type ModuleHost } from '@openagt/dashboard/module'
import { PaneHeaderContext } from '../../openagent/dashboard/components/PaneHeader.js'

// The dashboard as the Changes module sees it, faked: every service a spy. The tests mock the
// module's own reads (`reads.ts`), so the host's `read` is never what answers them.

/** A host whose every service is a spy. */
export function fakeHost(): ModuleHost {
  return {
    package: '@openagt/changes',
    runCommand: vi.fn(async () => ({ ok: false as const, error: 'no commands' })),
    act: vi.fn(async () => ({ ok: false as const, error: 'no commands' })),
    runComputerCommand: vi.fn(async () => ({ ok: false as const, error: 'not the computer\'s' })),
    runComputerCommandOn: vi.fn(async () => ({ ok: false as const, error: 'not the computer\'s' })),
    read: vi.fn(async () => ({ ok: false as const, error: 'reads are mocked' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    pageHref: (segment: string) => `/${segment}`,
    openSettings: vi.fn(),
    gitHostPeople: vi.fn(async () => []),
    startRun: vi.fn(async () => ({ ok: false as const, error: 'no runs' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines: vi.fn(async () => ({ version: '0.0.0', machines: [] })),
    addMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    removeMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    renameMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    renameComputer: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    letMachineIn: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    machineCode: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    computersThrough: vi.fn(async () => ({ ok: true as const, computers: [] })),
    machinePerson: vi.fn(async () => ({ ok: false as const, error: 'no person there', unknown: true as const })),
    removeMachineDevice: vi.fn(async () => ({ ok: false as const, error: 'no person there' })),
    machineAccounts: vi.fn(async () => null),
    removeMachineAccount: vi.fn(async () => ({ ok: false as const, error: 'no server here' })),
    useLoginsOn: vi.fn(async () => ({ ok: false as const, error: 'no server here' })),
    addComputerThrough: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
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

/** Render `ui` inside a fake host, in a pane's card; `rerender` keeps the same host. */
export function renderWithHost(ui: ReactElement, host: ModuleHost = fakeHost()): RenderResult {
  const wrap = (node: ReactNode) => (
    <ModuleHostContext.Provider value={host}>
      <PaneCard>{node}</PaneCard>
    </ModuleHostContext.Provider>
  )
  const result = rtlRender(wrap(ui))
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)) }
}
