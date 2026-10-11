import { vi } from 'vitest'
import { render as rtlRender, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { ModuleHostContext, type ModuleHost } from '@openagt/dashboard/module'

// The dashboard as the Files module sees it, faked: every service a spy. The tests mock the
// module's own reads (`reads.ts`), so the host's `read` is never what answers them.

/** A host whose every service is a spy. */
export function fakeHost(): ModuleHost {
  return {
    package: '@openagt/files',
    runCommand: vi.fn(async () => ({ ok: false as const, error: 'no commands' })),
    act: vi.fn(async () => ({ ok: false as const, error: 'no commands' })),
    read: vi.fn(async () => ({ ok: false as const, error: 'reads are mocked' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    startRun: vi.fn(async () => ({ ok: false as const, error: 'no runs' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines: vi.fn(async () => ({ version: '0.0.0', machines: [] })),
    addMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
}

/** Render `ui` inside a fake host; `rerender` keeps the same host. */
export function renderWithHost(ui: ReactElement, host: ModuleHost = fakeHost()): RenderResult {
  const wrap = (node: ReactNode) => <ModuleHostContext.Provider value={host}>{node}</ModuleHostContext.Provider>
  const result = rtlRender(wrap(ui))
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)) }
}
