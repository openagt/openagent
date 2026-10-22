import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const accounts = vi.hoisted(() => ({ onAgentAccounts: vi.fn(), sendAddAgentAccount: vi.fn(), sendRemoveAgentAccount: vi.fn(), sendUseAgentAccountFirst: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onAgentState: vi.fn(), sendAgentFix: vi.fn(), onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)

const { AgentAccountsSettings, AddedAccountsUsage, freeIn } = await import('./AgentAccounts.js')

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00Z')

const TWO = {
  now: NOW,
  accounts: [
    { id: 'This computer', name: 'Suleiman', own: true, windows: [{ label: '5 h', percent: 3 }, { label: 'week', percent: 22 }], state: 'limited', limitedUntil: NOW + 2 * HOUR + 10 * 60_000 },
    { id: 'Dani', name: 'Dani', own: false, added: '2026-10-22T09:00:00Z', windows: [{ label: 'week', percent: 20 }], asOf: NOW - HOUR, state: 'in-use' },
  ],
}

/** Codex's own login alone, read live: its free plan's one window is a month. */
const CODEX_ONE = { now: NOW, accounts: [{ id: 'This computer', name: 'Suleiman S', own: true, windows: [{ label: 'month', percent: 7 }] }] }

/** Each agent's accounts: Claude's as given, Codex's own alone unless said. */
function views(claude: object, codex: object = CODEX_ONE): void {
  accounts.onAgentAccounts.mockImplementation(async (agent: string) => (agent === 'codex' ? codex : claude))
}

/** Each agent's state: Claude Code's as given, Codex connected unless said. */
function states(claude: object, codex: object = { driver: 'codex', ready: true }): void {
  logins.onAgentState.mockImplementation(async (driver: string) => (driver === 'codex' ? codex : claude))
}

beforeEach(() => {
  states({ driver: 'claude-code', ready: true })
  logins.onGitHosts.mockResolvedValue({ hosts: [] })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of Object.values(accounts)) fn.mockReset()
  for (const fn of Object.values(logins)) fn.mockReset()
})

describe('Agent accounts', () => {
  test('a Claude Code that is not here says so in grey, with the press that installs it and the command it runs; logged out is amber, with the press that logs it in', async () => {
    views({ now: NOW, accounts: [{ id: 'This computer', name: 'This computer', own: true, windows: [] }] })
    states({ driver: 'claude-code', ready: false, problem: '`claude` not found', fix: { kind: 'install', command: 'curl -fsSL https://claude.ai/install.sh | bash' } })
    logins.sendAgentFix.mockResolvedValue({ ok: true })
    render(<AgentAccountsSettings />)
    const card = screen.getByRole('region', { name: 'Claude Code' })
    expect(await within(card).findByText('Not installed')).toBeTruthy()
    expect(within(card).getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Install Claude Code' }))
    await waitFor(() => expect(logins.sendAgentFix).toHaveBeenCalledWith('claude-code'))
    cleanup()

    states({ driver: 'claude-code', ready: false, problem: '`claude` is not logged in.', fix: { kind: 'log-in', command: 'claude auth login' }, fixing: 'log-in' })
    render(<AgentAccountsSettings />)
    const out = screen.getByRole('region', { name: 'Claude Code' })
    expect(await within(out).findByText('Log in')).toBeTruthy()
    expect(within(out).getByRole('status').textContent).toMatch(/Say yes in the page this computer's browser opened/)
  })

  test('a Claude Code card lists the accounts in the order runs use them: whose, how full their longest window is, which one runs use now and when a limited one frees; only an added one is removed', async () => {
    views(TWO)
    accounts.sendRemoveAgentAccount.mockResolvedValue({ ok: true })
    render(<AgentAccountsSettings />)
    const card = screen.getByRole('region', { name: 'Claude Code' })
    expect(await within(card).findByText('Connected')).toBeTruthy()
    const own = await within(card).findByRole('listitem', { name: 'Suleiman' })
    expect(own.textContent).toContain("this computer's login")
    expect(own.textContent).toContain('22% this week')
    expect(own.textContent).toContain('limited, free in 2 h 10 min')
    expect(within(own).queryByRole('button', { name: /Remove/ })).toBeNull()
    const dani = within(card).getByRole('listitem', { name: 'Dani' })
    expect(dani.textContent).toContain(`added ${new Date('2026-10-22T09:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)
    expect(dani.textContent).toMatch(/20% this week · as of/)
    expect(dani.textContent).toContain('in use')
    fireEvent.click(within(dani).getByRole('button', { name: "Remove Dani's account" }))
    await waitFor(() => expect(accounts.sendRemoveAgentAccount).toHaveBeenCalledWith('claude', 'Dani'))
  })

  test('adding asks whose account it is, then says to say yes in the browser while the login is made; a refused name is said', async () => {
    views(TWO)
    accounts.sendAddAgentAccount.mockResolvedValueOnce({ ok: false, error: 'There is an account named Dani already.' })
    render(<AgentAccountsSettings />)
    const card = screen.getByRole('region', { name: 'Claude Code' })
    fireEvent.click(await within(card).findByRole('button', { name: 'Add account' }))
    const name = within(card).getByRole('textbox', { name: 'Whose account' })
    const login = within(card).getByRole('button', { name: 'Log in to Claude' }) as HTMLButtonElement
    expect(login.disabled).toBe(true)
    fireEvent.change(name, { target: { value: 'Dani' } })
    fireEvent.click(login)
    expect((await within(card).findByRole('alert')).textContent).toBe('There is an account named Dani already.')

    accounts.sendAddAgentAccount.mockResolvedValueOnce({ ok: true })
    views({ ...TWO, adding: { name: 'Rom' } })
    fireEvent.change(name, { target: { value: 'Rom' } })
    fireEvent.click(login)
    await waitFor(() => expect(accounts.sendAddAgentAccount).toHaveBeenLastCalledWith('claude', 'Rom'))
    expect((await within(card).findByRole('status')).textContent).toBe("Adding Rom's account: say yes in the page this computer's browser opened, signed in to Rom's Claude account.")
  })

  test('the usage card shows the added accounts under the person\'s own bar, and nothing with one account', async () => {
    views(TWO)
    const { unmount } = render(<AddedAccountsUsage />)
    const rows = await screen.findByLabelText('Other Claude accounts')
    expect(rows.textContent).toMatch(/^Dani20% this week · as of /)
    expect(rows.textContent).not.toContain('Suleiman')
    unmount()
    views({ now: NOW, accounts: [TWO.accounts[0]] })
    const { container } = render(<AddedAccountsUsage />)
    await waitFor(() => expect(accounts.onAgentAccounts).toHaveBeenCalledTimes(2))
    expect(container.textContent).toBe('')
  })

  test('how long until a limit frees, in hours and minutes', () => {
    expect(freeIn(NOW + 2 * HOUR + 10 * 60_000, NOW)).toBe('2 h 10 min')
    expect(freeIn(NOW + 3 * HOUR, NOW)).toBe('3 h')
    expect(freeIn(NOW + 30_000, NOW)).toBe('1 min')
    expect(freeIn(NOW + 20 * 24 * HOUR, NOW)).toBe('20 days')
  })

  test('a Codex card beside Claude Code\'s, the same: its accounts by how full their month is, adding by a name first, then the sign-in, with the link to copy into a private window', async () => {
    views(TWO, {
      now: NOW,
      accounts: [
        { id: 'This computer', name: 'Suleiman S', own: true, windows: [{ label: 'month', percent: 7 }], state: 'in-use' },
        { id: 'Rom', name: 'Rom', own: false, added: '2026-10-22T09:00:00Z', windows: [{ label: '5 h', percent: 40 }, { label: 'week', percent: 12 }], state: 'next' },
      ],
      adding: { name: 'Dani', url: 'https://auth.example/sign-in' },
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<AgentAccountsSettings />)
    const card = screen.getByRole('region', { name: 'Codex' })
    expect((await within(card).findByRole('listitem', { name: 'Suleiman S' })).textContent).toContain('7% this month')
    expect(within(card).getByRole('listitem', { name: 'Rom' }).textContent).toContain('12% this week')
    const status = within(card).getByRole('status')
    expect(status.textContent).toContain("Adding Dani's account: sign in to Dani's ChatGPT account in the page this computer's browser opened.")
    fireEvent.click(within(status).getByRole('button', { name: 'Copy link for a private window' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://auth.example/sign-in'))
    expect(await within(status).findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  test('a Codex that is not here is its state and the press that installs it, with no accounts to add', async () => {
    views(TWO)
    states({ driver: 'claude-code', ready: true }, { driver: 'codex', ready: false, problem: '`codex` not found', fix: { kind: 'install', command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' } })
    render(<AgentAccountsSettings />)
    const card = screen.getByRole('region', { name: 'Codex' })
    expect(await within(card).findByText('Not installed')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Install Codex' })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Add account' })).toBeNull()
    expect(within(card).queryByRole('listitem')).toBeNull()
  })
})
