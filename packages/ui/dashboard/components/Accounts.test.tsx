import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const { AccountsList } = await import('./Accounts.js')
const { ModulesContext, mountedOf } = await import('../lib/use-modules.js')

afterEach(() => {
  cleanup()
  forgetRemembered()
})

describe('the Permissions page', () => {
  test("it has no part of its own: a coding agent's and a git host's accounts are their modules' parts", () => {
    const { container } = render(<AccountsList />)
    expect(screen.queryByRole('region', { name: 'Claude Code' })).toBeNull()
    expect(screen.queryByText('Git host accounts')).toBeNull()
    expect(container.textContent).toBe('')
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
    expect(screen.queryByText("The module's part")).toBeNull()
  })
})
