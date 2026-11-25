import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, openMenu, renderWithHost } from '@openagt/ui/module/testing'
import type { AccountsRead } from './calls.js'
import { AccountsSection } from './Accounts.js'

// GitHub's part of the Permissions page, "Git host accounts", its module's calls as a test
// answers them: `accounts` is what gh says now.

const read = (over: Partial<AccountsRead> = {}): AccountsRead => ({
  host: 'github.com',
  name: 'GitHub',
  requestWord: 'pull request',
  logo: '<svg viewBox="0 0 24 24"></svg>',
  tool: 'gh',
  installed: true,
  install: 'brew install gh',
  accounts: [
    { login: 'octo', runs: true, ok: true, avatar: '' },
    { login: 'octo-agent', runs: false, ok: true, avatar: '' },
  ],
  projects: ['site'],
  ...over,
})

let accounts = read()
const pressed = { useForRuns: vi.fn<(input: object) => unknown>(), forget: vi.fn<(input: object) => unknown>(), login: vi.fn<(input: object) => unknown>(), stopLogin: vi.fn<(input: object) => unknown>(), install: vi.fn<(input: object) => unknown>() }
const call = vi.fn(async (_projectId: string, name: string, input: object): Promise<ModuleCallResult> => {
  if (name === 'accounts') return { ok: true, output: accounts }
  const press = pressed[name as keyof typeof pressed]
  if (press) return { ok: true, output: await press(input) }
  return { ok: false, error: `no ${name} here` }
})
const host = fakeHost('@openagt/github', { call })
const draw = () => renderWithHost(<AccountsSection />, host)

beforeEach(() => {
  accounts = read()
  pressed.useForRuns.mockReturnValue({ ok: true })
  pressed.forget.mockReturnValue({ ok: true })
  pressed.install.mockReturnValue({ ok: true })
  pressed.login.mockReturnValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
  pressed.stopLogin.mockReturnValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  for (const fn of Object.values(pressed)) fn.mockReset()
  call.mockClear()
})

describe('Git host accounts', () => {
  test("OpenAgent's own accounts, the one runs use; another is used for runs with a press; one more is added from the part's title", async () => {
    draw()
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).queryByText('Connected')).toBeNull()
    expect(screen.getByText('Git host accounts')).toBeTruthy()
    // Its accounts stand alone, with no line that names GitHub, nor a sentence over them (his pick).
    expect(within(card).queryByRole('heading', { name: 'GitHub' })).toBeNull()
    expect(screen.queryByText(/never your own login/)).toBeNull()
    const octo = within(card).getByRole('listitem', { name: '@octo' })
    expect(octo.textContent).toContain('Added to OpenAgent')
    // The press that adds one is at the part's title, and none in the card.
    expect(screen.getByRole('button', { name: 'Add a GitHub account' }).textContent).toBe('Add')
    expect(within(card).queryByRole('button', { name: /Add/ })).toBeNull()
    expect(octo.textContent).toContain('Runs use this')
    await openMenu(within(card).getByRole('button', { name: 'More for @octo-agent' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use for runs' }))
    await waitFor(() => expect(pressed.useForRuns).toHaveBeenCalledWith({ login: 'octo-agent' }))
  })

  test('each account has its picture on GitHub, as gh said it; its first letter with none', async () => {
    accounts = read({ accounts: [{ login: 'octo', runs: true, ok: true, avatar: 'https://github.com/octo.png?size=64' }, { login: 'octo-agent', runs: false, ok: true, avatar: '' }] })
    draw()
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).getByRole('listitem', { name: '@octo' }).querySelector('img')?.getAttribute('src')).toBe('https://github.com/octo.png?size=64')
    expect(within(card).getByRole('listitem', { name: '@octo-agent' }).querySelector('img')).toBeNull()
    expect(within(card).getByRole('listitem', { name: '@octo-agent' }).textContent).toMatch(/^O@octo-agent/)
  })

  test('any account is removed from its ⋯, after a yes that says what it means: the one runs use leaves runs with none; the press spins, and a refusal is said', async () => {
    draw()
    const card = await screen.findByRole('region', { name: 'GitHub' })
    // The ⋯ is always there, not only on a hover.
    await openMenu(within(card).getByRole('button', { name: 'More for @octo' }))
    expect(screen.queryByRole('menuitem', { name: 'Use for runs' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const asked = within(card).getByRole('group', { name: 'Remove @octo' })
    expect(asked.textContent).toContain('Runs use @octo. Without it they have no GitHub account until you add one.')
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    expect(within(card).queryByRole('group', { name: 'Remove @octo' })).toBeNull()
    expect(pressed.forget).not.toHaveBeenCalled()

    let answer: (value: { ok: true }) => void = () => {}
    pressed.forget.mockImplementation(() => new Promise(resolve => (answer = resolve)))
    await openMenu(within(card).getByRole('button', { name: 'More for @octo-agent' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const other = within(card).getByRole('group', { name: 'Remove @octo-agent' })
    expect(other.textContent).toContain('OpenAgent forgets @octo-agent. The login goes on working wherever else it is.')
    fireEvent.click(within(other).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(pressed.forget).toHaveBeenCalledWith({ login: 'octo-agent' }))
    expect(within(other).getByRole('button', { name: 'Removing…' })).toBeTruthy()
    expect(within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'More for @octo-agent' }).querySelector('.animate-spin')).not.toBeNull()
    answer({ ok: true })
    await waitFor(() => expect(within(card).queryByRole('group', { name: 'Remove @octo-agent' })).toBeNull())

    pressed.forget.mockReturnValue({ ok: false, error: 'gh could not forget it.' })
    await openMenu(within(card).getByRole('button', { name: 'More for @octo-agent' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    fireEvent.click(within(within(card).getByRole('group', { name: 'Remove @octo-agent' })).getByRole('button', { name: 'Remove' }))
    expect((await within(card).findByRole('alert')).textContent).toBe('gh could not forget it.')
  })

  test('Add, at the title, opens the dialog: it asks gh for a code, shows it with the page to type it at, and the card behind stays as it was', async () => {
    draw()
    await screen.findByRole('region', { name: 'GitHub' })
    accounts = read({ loggingIn: { code: 'ABCD-1234', url: 'https://github.com/login/device' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add a GitHub account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    await waitFor(() => expect(pressed.login).toHaveBeenCalled())
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'github.com/login/device' }).getAttribute('href')).toBe('https://github.com/login/device')
    expect(within(dialog).getByText('Waiting for you at GitHub…')).toBeTruthy()
    // Rom's advice, where the account is chosen.
    expect(dialog.textContent).toContain('name it like you-agent')
    expect(within(screen.getByRole('region', { name: 'GitHub', hidden: true })).queryByText('ABCD-1234')).toBeNull()
  })

  test('no gh, or no account: said in the card, with the press that opens the dialog; the dialog installs gh with the command it runs, and says why the last install failed', async () => {
    accounts = read({ installed: false, accounts: [], installFailed: 'curl: could not resolve host' })
    draw()
    const card = await screen.findByRole('region', { name: 'GitHub' })
    // No account is a row of the card: GitHub's name, what is missing, and its press.
    const row = within(card).getByRole('listitem', { name: 'GitHub' })
    expect(within(row).getByText('gh, the tool for GitHub, is not installed.')).toBeTruthy()
    // gh is not here: nothing to add an account with at the title.
    expect(screen.getAllByRole('button', { name: 'Add a GitHub account' })).toHaveLength(1)
    expect(within(row).getByRole('button', { name: 'Add a GitHub account' }).textContent).toBe('Add account')
    fireEvent.click(within(row).getByRole('button', { name: 'Add a GitHub account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    expect(within(dialog).getByText('brew install gh')).toBeTruthy()
    expect(within(dialog).getByRole('alert').textContent).toBe('curl: could not resolve host')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install gh' }))
    await waitFor(() => expect(pressed.install).toHaveBeenCalled())
    // No code is asked for before gh is there.
    expect(pressed.login).not.toHaveBeenCalled()
    cleanup()
    forgetRemembered()
    localStorage.clear()

    accounts = read({ accounts: [] })
    draw()
    const out = await screen.findByRole('region', { name: 'GitHub' })
    const none = within(out).getByRole('listitem', { name: 'GitHub' })
    expect(within(none).getByText('No account')).toBeTruthy()
    // The row's own press, and "Add" at the title as with accounts there (his pick).
    expect(screen.getAllByRole('button', { name: 'Add a GitHub account' }).map(press => press.textContent)).toEqual(['Add', 'Add account'])
    fireEvent.click(within(none).getByRole('button', { name: 'Add a GitHub account' }))
    await waitFor(() => expect(pressed.login).toHaveBeenCalled())
  })

})
