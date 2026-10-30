import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), sendForgetGitHostAccount: vi.fn(), sendGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
vi.mock('../rpc/server-logins.js', () => ({ onServerLogins: vi.fn(async () => ({ computer: 'Studio', servers: [] })), sendUseLoginsOn: vi.fn(), sendAllowLogins: vi.fn(), sendSettleLogin: vi.fn() }))

const { GitHostCards } = await import('./GitHosts.js')

const provider = (over: Record<string, unknown> = {}) => ({
  name: 'GitHub',
  requestWord: 'pull request',
  logo: '<svg viewBox="0 0 24 24"></svg>',
  tool: 'gh',
  installed: true,
  install: 'brew install gh',
  accounts: [
    { login: 'octo', terminal: true, runs: true, ok: true },
    { login: 'octo-agent', terminal: false, runs: false, ok: true },
  ],
  ...over,
})

beforeEach(() => {
  logins.sendUseGitHostAccount.mockResolvedValue({ ok: true })
  logins.sendForgetGitHostAccount.mockResolvedValue({ ok: true })
  logins.sendGitHostInstall.mockResolvedValue({ ok: true })
  logins.sendGitHostLogin.mockResolvedValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of Object.values(logins)) fn.mockReset()
})

describe('Git hosts', () => {
  test('a card per host, drawn from its package: the accounts its tool knows, the one runs use, the terminal’s; another is used for runs with a press; a host with no package is one line', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site', 'gemskills'], provider: provider() }, { host: 'gitlab.example.com', projects: ['tool'] }] })
    render(<GitHostCards />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).queryByText('Connected')).toBeNull()
    expect(within(card).getByText('github.com · used by site, gemskills')).toBeTruthy()
    const octo = within(card).getByRole('listitem', { name: '@octo' })
    expect(octo.textContent).toContain("the terminal's account")
    expect(octo.textContent).toContain('in use for runs')
    fireEvent.click(within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'Use for runs' }))
    await waitFor(() => expect(logins.sendUseGitHostAccount).toHaveBeenCalledWith('github.com', 'octo-agent'))
    expect(screen.getByLabelText('gitlab.example.com').textContent).toBe('gitlab.example.com · used by tool · no package for it yet')
  })

  test('an account runs do not use is removed from this computer with a press; the one runs use has no Remove, and a refusal is said', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider() }] })
    render(<GitHostCards />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(within(card).getByRole('listitem', { name: '@octo' })).queryByRole('button', { name: /Remove/ })).toBeNull()
    fireEvent.click(within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'Remove @octo-agent' }))
    await waitFor(() => expect(logins.sendForgetGitHostAccount).toHaveBeenCalledWith('github.com', 'octo-agent'))
    // While gh works, the pressed button says so, with a spinner, and no other press is taken.
    let answer: (value: { ok: true }) => void = () => {}
    logins.sendForgetGitHostAccount.mockImplementation(() => new Promise(resolve => (answer = resolve)))
    fireEvent.click(within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'Remove @octo-agent' }))
    const removing = within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'Remove @octo-agent' })
    await waitFor(() => expect(removing.textContent).toBe('Removing…'))
    expect(removing.querySelector('.animate-spin')).not.toBeNull()
    expect((within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'Use for runs' }) as HTMLButtonElement).disabled).toBe(true)
    answer({ ok: true })
    await waitFor(() => expect(removing.textContent).toBe('Remove'))
    logins.sendForgetGitHostAccount.mockResolvedValue({ ok: false, error: 'gh could not forget it.' })
    fireEvent.click(within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'Remove @octo-agent' }))
    expect((await within(card).findByRole('alert')).textContent).toBe('gh could not forget it.')
  })

  test('Add account asks the package for a code, and the card shows it with the page to type it at while the login waits', async () => {
    logins.onGitHosts.mockResolvedValueOnce({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider() }] })
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ loggingIn: { code: 'ABCD-1234', url: 'https://github.com/login/device' } }) }] })
    let answer: (value: { ok: true }) => void = () => {}
    logins.sendGitHostLogin.mockImplementation(() => new Promise(resolve => (answer = resolve)))
    render(<GitHostCards />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    const add = within(card.querySelector('header')!).getByRole('button', { name: 'Add account' }) as HTMLButtonElement
    fireEvent.click(add)
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
    // While the package asks for a code, the press spins and takes no other.
    await waitFor(() => expect(add.disabled).toBe(true))
    expect(add.querySelector('.animate-spin')).not.toBeNull()
    answer({ ok: true })
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'github.com/login/device' }).getAttribute('href')).toBe('https://github.com/login/device')
  })

  test('no tool is grey, with the press that installs it and the command it runs, and why the last install failed; no account is amber, with the press that logs one in', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ installed: false, accounts: [], installFailed: 'curl: could not resolve host' }) }] })
    render(<GitHostCards />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).getByText('Not installed')).toBeTruthy()
    expect(within(card).getByText('brew install gh')).toBeTruthy()
    expect(within(card).getByRole('alert').textContent).toBe('curl: could not resolve host')
    fireEvent.click(within(card).getByRole('button', { name: 'Install gh' }))
    await waitFor(() => expect(logins.sendGitHostInstall).toHaveBeenCalledWith('github.com'))
    cleanup()

    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ accounts: [] }) }] })
    render(<GitHostCards />)
    const out = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(out).getByText('Log in')).toBeTruthy()
    fireEvent.click(within(out).getByRole('button', { name: 'Log in to GitHub' }))
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
  })

  test('no project with a remote: no card, one line saying when one comes', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [] })
    render(<GitHostCards />)
    expect(await screen.findByText(/None of your projects has a remote yet/)).toBeTruthy()
  })
})
