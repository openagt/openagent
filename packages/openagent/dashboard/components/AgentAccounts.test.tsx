import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '@openagt/skill-ui/module'

const accounts = vi.hoisted(() => ({ onAgentAccounts: vi.fn(), sendUseAgentAccountFirst: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onAgentState: vi.fn(), sendAgentFix: vi.fn(), onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const servers = vi.hoisted(() => ({ onServerLogins: vi.fn(), sendUseLoginsOn: vi.fn(), sendAllowLogins: vi.fn(), sendSettleLogin: vi.fn() }))
vi.mock('../rpc/server-logins.js', () => servers)

const { AddedAccountsUsage, freeIn } = await import('./AgentAccounts.js')
const { AccountsSettings } = await import('./Accounts.js')
const { ModulesContext } = await import('../lib/use-modules.js')

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
  accounts.onAgentAccounts.mockImplementation(async (agent: string) => ({ computer: 'Studio', ...(agent === 'codex' ? codex : claude) }))
}

/** Each agent's state: Claude Code's as given, Codex connected unless said. */
function states(claude: object, codex: object = { driver: 'codex', ready: true }): void {
  logins.onAgentState.mockImplementation(async (driver: string) => (driver === 'codex' ? codex : claude))
}

beforeEach(() => {
  states({ driver: 'claude-code', ready: true })
  logins.onGitHosts.mockResolvedValue({ hosts: [] })
  servers.onServerLogins.mockResolvedValue({ computer: 'Studio', servers: [] })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of Object.values(accounts)) fn.mockReset()
  for (const fn of Object.values(logins)) fn.mockReset()
  for (const fn of Object.values(servers)) fn.mockReset()
})

describe('Agent accounts', () => {
  test('a Claude Code that is not here says so in grey, with the press that installs it and the command it runs; logged out is amber, with the press that logs it in', async () => {
    views({ now: NOW, accounts: [{ id: 'This computer', name: 'This computer', own: true, windows: [] }] })
    states({ driver: 'claude-code', ready: false, problem: '`claude` not found', fix: { kind: 'install', command: 'curl -fsSL https://claude.ai/install.sh | bash' } })
    logins.sendAgentFix.mockResolvedValue({ ok: true })
    render(<AccountsSettings />)
    const card = await screen.findByRole('region', { name: 'Claude Code' })
    expect(await within(card).findByText('Not installed')).toBeTruthy()
    expect(within(card).getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Install Claude Code' }))
    await waitFor(() => expect(logins.sendAgentFix).toHaveBeenCalledWith('claude-code'))
    cleanup()

    states({ driver: 'claude-code', ready: false, problem: '`claude` is not logged in.', fix: { kind: 'log-in', command: 'claude auth login' }, fixing: 'log-in' })
    render(<AccountsSettings />)
    const out = await screen.findByRole('region', { name: 'Claude Code' })
    expect(await within(out).findByText('Log in')).toBeTruthy()
    expect(within(out).getByRole('status').textContent).toMatch(/Say yes in the page this computer's browser opened/)
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

  test('a Codex that is not here is its state and the press that installs it', async () => {
    views(TWO)
    states({ driver: 'claude-code', ready: true }, { driver: 'codex', ready: false, problem: '`codex` not found', fix: { kind: 'install', command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' } })
    render(<AccountsSettings />)
    const card = await screen.findByRole('region', { name: 'Codex' })
    expect(await within(card).findByText('Not installed')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Install Codex' })).toBeTruthy()
    // An agent that can run has nothing to set up: its accounts are the skill's card.
    expect(screen.queryByRole('region', { name: 'Claude Code' })).toBeNull()
  })

  test("the agent picker offers no login the agent does not have, and names the one runs really take; alone it stays", async () => {
    const { firstAccount, runAccounts } = await import('./AgentAccounts.js')
    const row = (name: string, own: boolean, more: object = {}) => ({ id: name, name, own, windows: [], ...more })
    const view = { computer: 'Mac', now: 0, accounts: [row('Claude login on VPS', true, { loggedOut: true }), row('test', false), row('Suleiman', false)] }
    expect(runAccounts(view).map(account => account.name)).toEqual(['test', 'Suleiman'])
    expect(firstAccount(view)?.name).toBe('test')
    const alone = { computer: 'Mac', now: 0, accounts: [row('Claude login on VPS', true, { loggedOut: true })] }
    expect(runAccounts(alone).map(account => account.name)).toEqual(['Claude login on VPS'])
  })

  test("Settings draws the skill's own card, the Overview's; a skill that did not load says so", async () => {
    views(TWO)
    const nothing = { pages: [], cards: [], linkActions: [], panels: [], runSlots: [], settings: [], everyPage: [], loaded: true }
    const card = { id: 'accounts', label: 'Accounts', package: '@openagt/skill-account-rotation', projects: [], computer: true, Card: () => <p>The skill's card</p> }
    const { unmount } = render(
      <ModulesContext.Provider value={{ ...nothing, cards: [card] }}>
        <AccountsSettings />
      </ModulesContext.Provider>,
    )
    expect(await screen.findByText("The skill's card")).toBeTruthy()
    unmount()
    render(
      <ModulesContext.Provider value={nothing}>
        <AccountsSettings />
      </ModulesContext.Provider>,
    )
    expect(await screen.findByText('The accounts card did not load.')).toBeTruthy()
  })
})
