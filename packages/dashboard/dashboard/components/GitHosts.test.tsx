import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import { openMenu } from '../test-utils.js'

const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), sendForgetGitHostAccount: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
vi.mock('../rpc/server-logins.js', () => ({ onServerLogins: vi.fn(async () => ({ computer: 'Studio', servers: [] })), sendUseLoginsOn: vi.fn(), sendAllowLogins: vi.fn(), sendSettleLogin: vi.fn() }))

const { GitHostOff, GitHostsCard, useSessionAccount } = await import('./GitHosts.js')

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
  logins.sendStopGitHostLogin.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of Object.values(logins)) fn.mockReset()
})

describe('the account a run started now would work as', () => {
  const Says = ({ address, picked }: { address: string | undefined; picked?: string }) => <span data-testid="login">{useSessionAccount(address, undefined, picked) ?? 'none'}</span>

  test('the one the project\'s host marks as the runs\' own; none for a host no package answers for', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: [], provider: provider({ accounts: [{ login: 'other', runs: false, ok: true }, { login: 'octo', runs: true, ok: true }] }) }] })
    const { rerender } = render(<Says address="github.com/o/r" />)
    await waitFor(() => expect(screen.getByTestId('login').textContent).toBe('octo'))
    rerender(<Says address="gitlab.com/o/r" />)
    expect(screen.getByTestId('login').textContent).toBe('none')
    // One picked for this session, while the computer has it.
    rerender(<Says address="github.com/o/r" picked="other" />)
    expect(screen.getByTestId('login').textContent).toBe('other')
    rerender(<Says address="github.com/o/r" picked="gone" />)
    expect(screen.getByTestId('login').textContent).toBe('octo')
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
  test('one card, "Git host accounts", a section per host drawn from its package: OpenAgent\u2019s own accounts, the one runs use; another is used for runs with a press; one more is added from the card\u2019s title; a host with no package is one line', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site', 'gemskills'], provider: provider() }, { host: 'gitlab.example.com', projects: ['tool'] }] })
    render(<GitHostsCard />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).queryByText('Connected')).toBeNull()
    expect(screen.getByText('Git host accounts')).toBeTruthy()
    expect(within(card).getByText('Used by site, gemskills')).toBeTruthy()
    const octo = within(card).getByRole('listitem', { name: '@octo' })
    expect(octo.textContent).toContain('added to OpenAgent')
    // One host an account can be added at: its press is at the card's title, and none at the host's own line.
    expect(screen.getByRole('button', { name: 'Add a GitHub account' }).textContent).toBe('Add')
    expect(within(card).queryByRole('button', { name: /Add/ })).toBeNull()
    expect(card.textContent).not.toContain('We recommend')
    expect(octo.textContent).toContain('Runs use this')
    await openMenu(within(card).getByRole('button', { name: 'More for @octo-agent' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use for runs' }))
    await waitFor(() => expect(logins.sendUseGitHostAccount).toHaveBeenCalledWith('github.com', 'octo-agent'))
    expect(screen.getByLabelText('gitlab.example.com').textContent).toBe('gitlab.example.com · Used by tool. No package for it yet.')
  })

  test("each account has its picture at the host, as the package said it; its first letter with none", async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ accounts: [{ login: 'octo', runs: true, ok: true, avatar: 'https://github.com/octo.png?size=64' }, { login: 'octo-agent', runs: false, ok: true }] }) }] })
    render(<GitHostsCard />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).getByRole('listitem', { name: '@octo' }).querySelector('img')?.getAttribute('src')).toBe('https://github.com/octo.png?size=64')
    expect(within(card).getByRole('listitem', { name: '@octo-agent' }).querySelector('img')).toBeNull()
    expect(within(card).getByRole('listitem', { name: '@octo-agent' }).textContent).toMatch(/^O@octo-agent/)
  })

  test('any account is removed from its ⋯, after a yes that says what it means: the one runs use leaves runs with none; the press spins, and a refusal is said', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider() }] })
    render(<GitHostsCard />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    // The ⋯ is always there, not only on a hover.
    await openMenu(within(card).getByRole('button', { name: 'More for @octo' }))
    expect(screen.queryByRole('menuitem', { name: 'Use for runs' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const asked = within(card).getByRole('group', { name: 'Remove @octo' })
    expect(asked.textContent).toContain('Runs use @octo. Without it they have no GitHub account until you add one.')
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    expect(within(card).queryByRole('group', { name: 'Remove @octo' })).toBeNull()
    expect(logins.sendForgetGitHostAccount).not.toHaveBeenCalled()

    let answer: (value: { ok: true }) => void = () => {}
    logins.sendForgetGitHostAccount.mockImplementation(() => new Promise(resolve => (answer = resolve)))
    await openMenu(within(card).getByRole('button', { name: 'More for @octo-agent' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    const other = within(card).getByRole('group', { name: 'Remove @octo-agent' })
    expect(other.textContent).toContain('OpenAgent forgets @octo-agent. The login goes on working wherever else it is.')
    fireEvent.click(within(other).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(logins.sendForgetGitHostAccount).toHaveBeenCalledWith('github.com', 'octo-agent'))
    expect(within(other).getByRole('button', { name: 'Removing…' })).toBeTruthy()
    expect(within(within(card).getByRole('listitem', { name: '@octo-agent' })).getByRole('button', { name: 'More for @octo-agent' }).querySelector('.animate-spin')).not.toBeNull()
    answer({ ok: true })
    await waitFor(() => expect(within(card).queryByRole('group', { name: 'Remove @octo-agent' })).toBeNull())

    logins.sendForgetGitHostAccount.mockResolvedValue({ ok: false, error: 'gh could not forget it.' })
    await openMenu(within(card).getByRole('button', { name: 'More for @octo-agent' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    fireEvent.click(within(within(card).getByRole('group', { name: 'Remove @octo-agent' })).getByRole('button', { name: 'Remove' }))
    expect((await within(card).findByRole('alert')).textContent).toBe('gh could not forget it.')
  })

  test('Add, at the card\u2019s title, opens the dialog: it asks the package for a code, shows it with the page to type it at, and closes on the account once it is there', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider() }] })
    render(<GitHostsCard />)
    await screen.findByRole('region', { name: 'GitHub' })
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ loggingIn: { code: 'ABCD-1234', url: 'https://github.com/login/device' } }) }] })
    fireEvent.click(screen.getByRole('button', { name: 'Add a GitHub account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'github.com/login/device' }).getAttribute('href')).toBe('https://github.com/login/device')
    expect(within(dialog).getByText('Waiting for you at GitHub…')).toBeTruthy()
    // Rom's advice, where the account is chosen.
    expect(dialog.textContent).toContain('name it like you-agent')
    // The code is in the dialog alone: the card behind it stays as it was.
    expect(within(screen.getByRole('region', { name: 'GitHub', hidden: true })).queryByText('ABCD-1234')).toBeNull()
  })

  test('no tool, or no account: said in the card, with the press that opens the dialog; the dialog installs the tool with the command it runs, and says why the last install failed', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ installed: false, accounts: [], installFailed: 'curl: could not resolve host' }) }] })
    render(<GitHostsCard />)
    const card = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(card).getByText('gh, the tool for GitHub, is not installed.')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Add a GitHub account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    expect(within(dialog).getByText('brew install gh')).toBeTruthy()
    expect(within(dialog).getByRole('alert').textContent).toBe('curl: could not resolve host')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install gh' }))
    await waitFor(() => expect(logins.sendGitHostInstall).toHaveBeenCalledWith('github.com'))
    // No code is asked for before the tool is there.
    expect(logins.sendGitHostLogin).not.toHaveBeenCalled()
    cleanup()

    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider({ accounts: [] }) }] })
    render(<GitHostsCard />)
    const out = await screen.findByRole('region', { name: 'GitHub' })
    expect(within(out).getByText('OpenAgent has no GitHub account yet.')).toBeTruthy()
    // One press, where what is missing is said: not a second one at the card's title.
    expect(screen.getAllByRole('button', { name: 'Add a GitHub account' })).toHaveLength(1)
    fireEvent.click(within(out).getByRole('button', { name: 'Add a GitHub account' }))
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
  })

  test('two hosts with a package: Add is a menu of them', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ host: 'github.com', projects: ['site'], provider: provider() }, { host: 'git.example.com', projects: ['tool'], provider: provider({ name: 'Forge', tool: 'forge', accounts: [] }) }] })
    render(<GitHostsCard />)
    await screen.findByRole('region', { name: 'Forge' })
    await openMenu(screen.getByRole('button', { name: 'Add a git host account' }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['GitHub', 'Forge'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Forge' }))
    expect(await screen.findByRole('dialog', { name: 'Add a Forge account' })).toBeTruthy()
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('git.example.com'))
  })

  test('no project with a remote: no card, one line saying when one comes', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [] })
    render(<GitHostsCard />)
    expect(await screen.findByText(/None of your projects has a remote yet/)).toBeTruthy()
  })
})
