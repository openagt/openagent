import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), sendGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)

const { GitHostsSettings } = await import('./GitHosts.js')

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
  logins.sendGitHostInstall.mockResolvedValue({ ok: true })
  logins.sendGitHostLogin.mockResolvedValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
})

afterEach(() => {
  cleanup()
  for (const fn of Object.values(logins)) fn.mockReset()
})

describe('Git hosts', () => {
  test('a card per host, drawn from its package: the accounts its tool knows, the one runs use, the terminal’s; another is used for runs with a press; a host with no package is one line', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site', 'gemskills'], provider: provider() }, { host: 'gitlab.example.com', projects: ['tool'] }] })
    render(<GitHostsSettings />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).getByText('Connected')).toBeTruthy()
    expect(within(card).getByText('github.com · used by site, gemskills')).toBeTruthy()
    const octo = within(card).getByRole('listitem', { name: '@octo' })
    expect(octo.textContent).toContain("the terminal's account")
    expect(octo.textContent).toContain('in use for runs')
    fireEvent.click(within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'Use for runs' }))
    await waitFor(() => expect(logins.sendUseGitHostAccount).toHaveBeenCalledWith('github.com', 'octo-agent'))
    expect(screen.getByLabelText('gitlab.example.com').textContent).toBe('gitlab.example.com · used by tool · no package for it yet')
  })

  test('Add account asks the package for a code, and the card shows it with the page to type it at while the login waits', async () => {
    logins.onGitHosts.mockResolvedValueOnce({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider() }] })
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ loggingIn: { code: 'ABCD-1234', url: 'https://github.com/login/device' } }) }] })
    render(<GitHostsSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'github.com/login/device' }).getAttribute('href')).toBe('https://github.com/login/device')
  })

  test('no tool is grey, with the press that installs it and the command it runs, and why the last install failed; no account is amber, with the press that logs one in', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ installed: false, accounts: [], installFailed: 'curl: could not resolve host' }) }] })
    render(<GitHostsSettings />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).getByText('Not installed')).toBeTruthy()
    expect(within(card).getByText('brew install gh')).toBeTruthy()
    expect(within(card).getByRole('alert').textContent).toBe('curl: could not resolve host')
    fireEvent.click(within(card).getByRole('button', { name: 'Install gh' }))
    await waitFor(() => expect(logins.sendGitHostInstall).toHaveBeenCalledWith('github.com'))
    cleanup()

    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ accounts: [] }) }] })
    render(<GitHostsSettings />)
    const out = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(out).getByText('Log in')).toBeTruthy()
    fireEvent.click(within(out).getByRole('button', { name: 'Log in to GitHub' }))
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
  })

  test('no project with a remote: no card, one line saying when one comes', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [] })
    render(<GitHostsSettings />)
    expect(await screen.findByText(/None of your projects has a remote yet/)).toBeTruthy()
  })
})
