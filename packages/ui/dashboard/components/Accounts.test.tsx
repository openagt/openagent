import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)

const { AccountsList } = await import('./Accounts.js')
const { ModulesContext, mountedOf } = await import('../lib/use-modules.js')

beforeEach(() => {
  logins.onGitHosts.mockResolvedValue({ hosts: [] })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of Object.values(logins)) fn.mockReset()
})

describe('the Permissions page', () => {
  test('it has no part of its own for a coding agent: what an agent needs is its module\'s part', async () => {
    render(<AccountsList />)
    expect(await screen.findByText('Git host accounts')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Claude Code' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Codex' })).toBeNull()
  })

  test("it draws the modules' parts; with none, the rest of the page", async () => {
    const part = {
      place: 'permissions.section' as const,
      id: 'accounts',
      label: 'Accounts',
      package: 'an-accounts-module',
      projects: [],
      computer: true as const,
      View: () => <p>The module's part</p>,
    }
    const { unmount } = render(
      <ModulesContext.Provider value={mountedOf({ views: { 'permissions.section': [part] } })}>
        <AccountsList />
      </ModulesContext.Provider>,
    )
    expect(await screen.findByText("The module's part")).toBeTruthy()
    unmount()
    render(
      <ModulesContext.Provider value={mountedOf()}>
        <AccountsList />
      </ModulesContext.Provider>,
    )
    expect(await screen.findByText('Git host accounts')).toBeTruthy()
    expect(screen.queryByText("The module's part")).toBeNull()
  })
})
