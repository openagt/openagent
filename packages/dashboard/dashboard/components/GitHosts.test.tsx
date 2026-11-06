import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), sendForgetGitHostAccount: vi.fn(), sendGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
vi.mock('../rpc/server-logins.js', () => ({ onServerLogins: vi.fn(async () => ({ computer: 'Studio', servers: [] })), sendUseLoginsOn: vi.fn(), sendAllowLogins: vi.fn(), sendSettleLogin: vi.fn() }))

const { GitHostOff, GitHostsCard, useRunsAccount } = await import('./GitHosts.js')

const provider = (over: Record<string, unknown> = {}) => ({
  name: 'GitHub',
  requestWord: 'pull request',
  logo: '<svg viewBox="0 0 24 24"></svg>',
  tool: 'gh',
  installed: true,
  install: 'brew install gh',
  accounts: [
    { login: 'octo', runs: true, ok: true },
    { login: 'octo-agent', runs: false, ok: true },
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

describe('the account a run started now would work as', () => {
  const Says = ({ address }: { address: string | undefined }) => <span data-testid="login">{useRunsAccount(address, undefined) ?? 'none'}</span>

  test('the one the project\'s host marks as the runs\' own; none for a host no package answers for', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: [], provider: provider({ accounts: [{ login: 'other', runs: false, ok: true }, { login: 'octo', runs: true, ok: true }] }) }] })
    const { rerender } = render(<Says address="github.com/o/r" />)
    await waitFor(() => expect(screen.getByTestId('login').textContent).toBe('octo'))
    rerender(<Says address="gitlab.com/o/r" />)
    expect(screen.getByTestId('login').textContent).toBe('none')
  })
})

describe('the git host in a session\'s row', () => {
  const home = { url: 'https://github.com/o/r', name: 'GitHub' }

  test('the account its record keeps, off, with the host\'s logo, whichever account is in use now', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider() }] })
    const { container } = render(<GitHostOff home={home} account="suleimansh" />)
    const item = await screen.findByRole('button', { name: '@suleimansh' })
    expect((item as HTMLButtonElement).disabled).toBe(true)
    expect(container.textContent).toBe('@suleimansh')
    expect(item.querySelector<HTMLElement>('[aria-hidden]')!.style.maskImage).toContain(encodeURIComponent('<svg'))
  })

  test('a record with no account: its logo and name, off; no account, whichever is in use now', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider() }] })
    const { container } = render(<GitHostOff home={home} />)
    const item = await screen.findByRole('button', { name: 'GitHub' })
    expect((item as HTMLButtonElement).disabled).toBe(true)
    expect(container.textContent).toBe('GitHub')
    expect(container.textContent).not.toMatch(/@|octo/)
    // The host's own logo, from its package.
    expect(item.querySelector<HTMLElement>('[aria-hidden]')!.style.maskImage).toContain(encodeURIComponent('<svg'))
  })

  test('nothing for a project with no page on a git host, and nothing until the logo is read, so it lands whole', async () => {
    let answer: (view: unknown) => void = () => {}
    logins.onGitHosts.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    const { container, rerender } = render(<GitHostOff home={home} />)
    expect(container.textContent).toBe('')
    answer({ hosts: [{ host: 'github.com', projects: [], provider: provider() }] })
    await screen.findByRole('button', { name: 'GitHub' })
    rerender(<GitHostOff home={null} />)
    expect(container.textContent).toBe('')
  })
})

describe('Git hosts', () => {
  test('a card per host, drawn from its package: OpenAgent\u2019s own accounts, the one runs use; another is used for runs with a press; the -agent advice; a host with no package is one line', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site', 'gemskills'], provider: provider() }, { host: 'gitlab.example.com', projects: ['tool'] }] })
    render(<GitHostsCard />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).queryByText('Connected')).toBeNull()
    expect(within(card).getByText('github.com · used by site, gemskills')).toBeTruthy()
    const octo = within(card).getByRole('listitem', { name: '@octo' })
    expect(octo.textContent).toContain('added to OpenAgent')
    // octo is no account of an agent's own: the advice says to make one.
    expect(card.textContent).toContain('We recommend creating dedicated GitHub accounts with limited access for your agents')
    expect(octo.textContent).toContain('in use for runs')
    fireEvent.click(within(card).getByRole('button', { name: 'Details of @octo-agent' }))
    fireEvent.click(within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'Use for runs' }))
    await waitFor(() => expect(logins.sendUseGitHostAccount).toHaveBeenCalledWith('github.com', 'octo-agent'))
    expect(screen.getByLabelText('gitlab.example.com').textContent).toBe('gitlab.example.com · used by tool · no package for it yet')
  })

  test('an account runs do not use is removed from this computer with a press; the one runs use has no Remove, and a refusal is said', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider() }] })
    render(<GitHostsCard />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    fireEvent.click(within(card).getByRole('button', { name: 'Details of @octo' }))
    expect(within(within(card).getByRole('listitem', { name: '@octo' })).queryByRole('button', { name: /Remove/ })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Details of @octo-agent' }))
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
    render(<GitHostsCard />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    const add = within(card).getByRole('button', { name: 'Add account' }) as HTMLButtonElement
    fireEvent.click(add)
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
    // While the package asks for a code, the press spins and takes no other.
    await waitFor(() => expect(add.disabled).toBe(true))
    expect(add.querySelector('.animate-spin')).not.toBeNull()
    answer({ ok: true })
    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'github.com/login/device' }).getAttribute('href')).toBe('https://github.com/login/device')
  })

  test('no tool is grey, with the press that installs it and the command it runs, and why the last install failed; no account is amber, "No account", with the press that adds one', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ installed: false, accounts: [], installFailed: 'curl: could not resolve host' }) }] })
    render(<GitHostsCard />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).getByText('Not installed')).toBeTruthy()
    expect(within(card).getByText('brew install gh')).toBeTruthy()
    expect(within(card).getByRole('alert').textContent).toBe('curl: could not resolve host')
    fireEvent.click(within(card).getByRole('button', { name: 'Install gh' }))
    await waitFor(() => expect(logins.sendGitHostInstall).toHaveBeenCalledWith('github.com'))
    cleanup()

    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ accounts: [] }) }] })
    render(<GitHostsCard />)
    const out = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(out).getByText('No account')).toBeTruthy()
    fireEvent.click(within(out).getByRole('button', { name: 'Add a GitHub account' }))
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
  })

  test('no project with a remote: no card, one line saying when one comes', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [] })
    render(<GitHostsCard />)
    expect(await screen.findByText(/None of your projects has a remote yet/)).toBeTruthy()
  })
})
