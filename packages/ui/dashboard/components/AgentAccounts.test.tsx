import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const accounts = vi.hoisted(() => ({ onAgentAccounts: vi.fn(), sendUseAgentAccountFirst: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onAgentState: vi.fn(), sendAgentFix: vi.fn(), onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)


const { AddedAccountsUsage, freeIn } = await import('./AgentAccounts.js')
const { AccountsList } = await import('./Accounts.js')
const { AgentFix } = await import('./Logins.js')
const { ModulesContext, mountedOf } = await import('../lib/use-modules.js')

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

})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of Object.values(accounts)) fn.mockReset()
  for (const fn of Object.values(logins)) fn.mockReset()

})

describe('Agent accounts', () => {
  /** The agents' package's press, which the dashboard draws for an agent with no account: here a stand-in that says what it was given. */
  const connect = {
    place: 'agent.connect' as const,
    id: 'connect',
    package: 'an-agents-module',
    projects: [],
    computer: true as const,
    View: ({ agent, primary, label, small, onConnected }: { agent: string; primary: boolean; label?: string; small?: boolean; onConnected: () => void }) => (
      <button type="button" data-agent={agent} data-primary={primary} data-small={small} onClick={onConnected}>
        {label}
      </button>
    ),
  }

  test('an agent whose program is not here: the press that installs it, with the command it runs, what it says while it does, and why it failed, an address in it a link', async () => {
    const missing = { driver: 'claude-code' as const, ready: false, problem: '`claude` not found', fix: { kind: 'install' as const, command: 'curl -fsSL https://claude.ai/install.sh | bash', problem: '`claude` not found' } }
    logins.sendAgentFix.mockResolvedValue({ ok: true })
    const onChanged = vi.fn()
    const { rerender } = render(<AgentFix state={missing} onChanged={onChanged} />)
    expect(screen.getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Install Claude Code' }))
    await waitFor(() => expect(logins.sendAgentFix).toHaveBeenCalledWith('claude-code'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    rerender(<AgentFix state={{ ...missing, fixing: 'install' }} onChanged={onChanged} />)
    expect(screen.getByRole('status').textContent).toBe('Installing Claude Code…')
    rerender(<AgentFix state={{ ...missing, failed: 'See https://claude.ai/status\ncurl: (6) Could not resolve host' }} onChanged={onChanged} />)
    expect(screen.getByRole('link', { name: 'https://claude.ai/status' }).getAttribute('href')).toBe('https://claude.ai/status')
    expect(screen.getByRole('alert').textContent).toBe('See https://claude.ai/status\ncurl: (6) Could not resolve host')
  })

  test("an agent that is here and has no account: the press is its package's own, \"Add account\", never a log-in of the computer's CLI run from the page", async () => {
    const out = { driver: 'codex' as const, ready: false, problem: '`codex` is not logged in.', fix: { kind: 'log-in' as const, command: 'codex login', problem: '`codex` is not logged in.' } }
    const onChanged = vi.fn()
    render(
      <ModulesContext.Provider value={mountedOf({ views: { 'agent.connect': [connect] } })}>
        <AgentFix state={out} onChanged={onChanged} size="sm" variant="secondary" />
      </ModulesContext.Provider>,
    )
    const press = screen.getByRole('button', { name: 'Add account' })
    expect([press.dataset['agent'], press.dataset['primary'], press.dataset['small']]).toEqual(['codex', 'false', 'true'])
    expect(screen.queryByText('codex login')).toBeNull()
    fireEvent.click(press)
    expect(onChanged).toHaveBeenCalled()
    expect(logins.sendAgentFix).not.toHaveBeenCalled()
    cleanup()
    // Nothing to fix, nothing drawn.
    const { container } = render(<AgentFix state={{ driver: 'codex', ready: true }} onChanged={onChanged} />)
    expect(container.textContent).toBe('')
  })

  test('the Permissions page has no part of its own for a coding agent that cannot run: what is missing is a row of the accounts card', async () => {
    views({ now: NOW, accounts: [] })
    states({ driver: 'claude-code', ready: false, problem: '`claude` is not logged in.', fix: { kind: 'log-in', command: 'claude auth login' } }, { driver: 'codex', ready: false, problem: '`codex` not found', fix: { kind: 'install', command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' } })
    render(<AccountsList />)
    expect(await screen.findByText('Git host accounts')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Claude Code' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Codex' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Log this computer in/ })).toBeNull()
  })

  test('the usage card shows the added accounts under the person\'s own bar, and nothing with one account', async () => {
    views(TWO)
    const { unmount } = render(<AddedAccountsUsage />)
    const rows = await screen.findByLabelText('Other Claude accounts')
    expect(rows.textContent).toMatch(/^Dani20% this week·as of /)
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

  test("the agent picker offers no login the agent does not have, and names the one runs really take; alone it stays", async () => {
    const { firstAccount, runAccounts } = await import('./AgentAccounts.js')
    const row = (name: string, own: boolean, more: object = {}) => ({ id: name, name, own, windows: [], ...more })
    const view = { computer: 'Mac', now: 0, accounts: [row('Claude login on VPS', true, { loggedOut: true }), row('test', false), row('Suleiman', false)] }
    expect(runAccounts(view).map(account => account.name)).toEqual(['test', 'Suleiman'])
    expect(firstAccount(view)?.name).toBe('test')
    const alone = { computer: 'Mac', now: 0, accounts: [row('Claude login on VPS', true, { loggedOut: true })] }
    expect(runAccounts(alone).map(account => account.name)).toEqual(['Claude login on VPS'])
  })

  test("the Permissions page draws the modules' parts; with none, the rest of the page", async () => {
    views(TWO)
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
