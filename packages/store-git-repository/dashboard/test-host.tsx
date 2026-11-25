import { vi } from 'vitest'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import type { ReactElement } from 'react'
import type { HostAccounts } from '@openagt/hooks'

// What the module's UI tests share: OpenAgent's accounts at GitHub as the modules' `account.access`
// answers them, and a host whose calls of the module's server part a test answers. Each test file
// fakes the press of the module that adds an account (`ModuleFixPress`), whose own tests are the shell's.

/** OpenAgent's accounts at GitHub, with the press of github's that adds one. */
export const github = (logins: string[], runs?: string): HostAccounts => ({ host: 'github.com', logins, ...(runs !== undefined ? { runs } : {}), add: { module: 'github', action: 'add-account', label: 'Add a GitHub account' } })

/** Render `ui` with a host whose calls of the server part `answer` answers. */
export function renderCalling(ui: ReactElement, answer: (name: string, input: Record<string, unknown>) => unknown) {
  const callComputer = vi.fn(async (name: string, input: object): Promise<ModuleCallResult> => {
    const output = await answer(name, input as Record<string, unknown>)
    return output instanceof Error ? { ok: false, error: output.message } : { ok: true, output: output ?? null }
  })
  const host = fakeHost('@openagt/store-git-repository', { callComputer })
  return { ...renderWithHost(ui, host), callComputer, sent: (name: string) => callComputer.mock.calls.filter(([called]) => called === name).map(([, input]) => input) }
}
