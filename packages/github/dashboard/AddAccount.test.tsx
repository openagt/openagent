import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import type { AccountsRead } from './calls.js'
import { AccountFix, AddAccountDialog } from './AddAccount.js'

// The dialog that adds an account of OpenAgent's on GitHub, its module's calls as a test answers
// them: `accounts` is what gh says now, which a test changes as the person would at GitHub.

const CODE = { code: 'ABCD-1234', url: 'https://github.com/login/device' }
const read = (over: Partial<AccountsRead> = {}): AccountsRead => ({
  host: 'github.com',
  name: 'GitHub',
  requestWord: 'pull request',
  logo: '<svg/>',
  tool: 'gh',
  installed: true,
  install: 'brew install gh',
  accounts: [{ login: 'octo', runs: true, ok: true, avatar: '' }],
  projects: [],
  ...over,
})

let accounts = read()
const login = vi.fn<() => object>()
const stopLogin = vi.fn<() => object>()
const install = vi.fn<() => object>()
const call = vi.fn(async (_projectId: string, name: string): Promise<ModuleCallResult> => {
  if (name === 'accounts') return { ok: true, output: accounts }
  if (name === 'login') return { ok: true, output: login() }
  if (name === 'stopLogin') return { ok: true, output: stopLogin() }
  if (name === 'install') return { ok: true, output: install() }
  return { ok: false, error: `no ${name} here` }
})
const host = fakeHost('@openagt/github', { call })
const draw = (node: React.ReactElement) => renderWithHost(node, host)

beforeEach(() => {
  accounts = read()
  login.mockReturnValue({ ok: true, ...CODE })
  stopLogin.mockReturnValue({ ok: true })
  install.mockReturnValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  for (const fn of [login, stopLogin, install]) fn.mockReset()
  call.mockClear()
})

describe('the dialog that adds a GitHub account', () => {
  test('open, it asks for a code at once and shows it; the account once there is said, and the dialog closes on it', async () => {
    const onClose = vi.fn()
    draw(<AddAccountDialog open onClose={onClose} />)
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    accounts = read({ loggingIn: CODE })
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Copy the code' })).toBeTruthy()
    expect(within(dialog).getByText('Sign in there as the account OpenAgent should use. Your own logins stay as they are.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    // The person signed in at GitHub: gh now lists one account more.
    accounts = read({ accounts: [{ login: 'octo', runs: true, ok: true, avatar: '' }, { login: 'octo-agent', runs: false, ok: true, avatar: '' }] })
    expect(await within(dialog).findByText('@octo-agent is added.', undefined, { timeout: 4000 })).toBeTruthy()
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('octo-agent'), { timeout: 3000 })
    // Nothing to give up: the login ended by itself.
    expect(stopLogin).not.toHaveBeenCalled()
  })

  test('once the code is shown, the link to open has the focus, and each of the dialog’s live lines is said on its own', async () => {
    draw(<AddAccountDialog open onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    const link = await within(dialog).findByRole('link', { name: 'github.com/login/device' })
    await waitFor(() => expect(document.activeElement).toBe(link))
    expect(within(dialog).getAllByRole('status').map(line => line.textContent)).toEqual(['Open github.com/login/device and enter this code:ABCD-1234', 'Waiting for you at GitHub…'])
  })

  test('a login GitHub no longer took, added again, is the account it added', async () => {
    accounts = read({ accounts: [{ login: 'octo', runs: true, ok: false, avatar: '' }] })
    const onClose = vi.fn()
    draw(<AddAccountDialog open onClose={onClose} />)
    await waitFor(() => expect(login).toHaveBeenCalled())
    accounts = read()
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('octo'), { timeout: 5000 })
  })

  test('Cancel, or closing it, gives the login up; a closed dialog asks for nothing', async () => {
    accounts = read({ loggingIn: CODE })
    const onClose = vi.fn()
    const { rerender } = draw(<AddAccountDialog open={false} onClose={onClose} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(call).not.toHaveBeenCalled()
    rerender(<AddAccountDialog open onClose={onClose} />)
    const dialog = await screen.findByRole('dialog')
    // A login already under way is shown as it is: no second code is asked for.
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    expect(login).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledWith()
    rerender(<AddAccountDialog open={false} onClose={onClose} />)
    await waitFor(() => expect(stopLogin).toHaveBeenCalled())
  })

  test('a login that ended with no account more says so, and a press asks for a new code; a code gh refused says why, its address a link, and the press tries again', async () => {
    accounts = read({ loggingIn: CODE })
    draw(<AddAccountDialog open onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    accounts = read()
    expect(await within(dialog).findByText(/No account was added/, undefined, { timeout: 4000 })).toBeTruthy()
    expect(within(dialog).queryByText(/Sign in there/)).toBeNull()
    login.mockReturnValue({ ok: false, error: 'error connecting to github.com; check your internet connection or https://githubstatus.com' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get a new code' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toBe('Could not get a code from GitHub:\nerror connecting to github.com; check your internet connection or https://githubstatus.com')
    expect(within(alert).getByRole('link', { name: 'https://githubstatus.com' }).getAttribute('href')).toBe('https://githubstatus.com')
    // No code was shown this time: the press asks again, it gets no "new" code, and nothing says to sign in "there".
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(within(dialog).queryByText(/Sign in there/)).toBeNull()
  })

  test('gh not here: its install first, with the command; once it is here the code is asked for by itself', async () => {
    accounts = read({ installed: false, accounts: [] })
    draw(<AddAccountDialog open onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('gh, the tool for GitHub, is not installed.')).toBeTruthy()
    expect(within(dialog).getByText('brew install gh')).toBeTruthy()
    accounts = read({ accounts: [] })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install gh' }))
    await waitFor(() => expect(install).toHaveBeenCalled())
    await waitFor(() => expect(login).toHaveBeenCalled())
  })
})

describe('the press for no account', () => {
  test('opens the dialog, and tells its place of the account once added; nothing once there is one', async () => {
    const onChanged = vi.fn(async () => {})
    accounts = read({ accounts: [] })
    const { rerender } = draw(<AccountFix accounts={read({ accounts: [] })} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a GitHub account' }))
    await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    await waitFor(() => expect(login).toHaveBeenCalled())
    accounts = read({ accounts: [{ login: 'octo-agent', runs: true, ok: true, avatar: '' }] })
    await waitFor(() => expect(onChanged).toHaveBeenCalled(), { timeout: 5000 })
    rerender(<AccountFix accounts={read()} onChanged={onChanged} />)
    expect(screen.queryByRole('button', { name: 'Add a GitHub account' })).toBeNull()
  })

  test('gh with no install for this computer is said, with no press', () => {
    const { install: _none, ...rest } = read({ installed: false, accounts: [] })
    draw(<AccountFix accounts={rest} onChanged={vi.fn(async () => {})} />)
    expect(screen.getByText('Install gh by hand: GitHub makes none for this computer.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
