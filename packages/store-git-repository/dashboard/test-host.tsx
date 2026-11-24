import { vi } from 'vitest'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import type { ReactElement } from 'react'

// What the module's UI tests share: a git host as the shell reads it, and a host whose calls of the
// module's server part a test answers. Each test file fakes the shell's git hosts and its press that
// adds an account (`useGitHosts`, `HostFix`), whose own tests are the shell's.

/** A git host's row as the shell reads it, with OpenAgent's accounts there. */
export const github = (accounts: { login: string; runs: boolean; ok: boolean }[]) => ({
  host: 'github.com',
  projects: [],
  provider: { name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts },
})

/** Render `ui` with a host whose calls of the server part `answer` answers. */
export function renderCalling(ui: ReactElement, answer: (name: string, input: Record<string, unknown>) => unknown) {
  const callComputer = vi.fn(async (name: string, input: object): Promise<ModuleCallResult> => {
    const output = await answer(name, input as Record<string, unknown>)
    return output instanceof Error ? { ok: false, error: output.message } : { ok: true, output: output ?? null }
  })
  const host = fakeHost('@openagt/store-git-repository', { callComputer })
  return { ...renderWithHost(ui, host), callComputer, sent: (name: string) => callComputer.mock.calls.filter(([called]) => called === name).map(([, input]) => input) }
}
