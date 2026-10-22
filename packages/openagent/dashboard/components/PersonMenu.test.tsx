import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const onPerson = vi.hoisted(() => vi.fn())
vi.mock('../rpc/person.js', () => ({ onPerson }))
const accounts = vi.hoisted(() => ({ onClaudeAccounts: vi.fn(), sendUseClaudeAccountFirst: vi.fn(), sendAddClaudeAccount: vi.fn(), sendRemoveClaudeAccount: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), sendGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
// The menu's theme and notifications rows have their own suites; here they are the rows' names.
vi.mock('./ThemeSubmenu.js', () => ({ ThemeSubmenu: () => <div role="menuitem">Theme</div> }))
vi.mock('./NotificationsSubmenu.js', () => ({ NotificationsSubmenu: () => <div role="menuitem">Notifications</div> }))

const { PersonMenu, firstName, initials } = await import('./PersonMenu.js')

// No account read yet: no Claude row, as the other rows' tests expect.
beforeEach(() => {
  accounts.onClaudeAccounts.mockResolvedValue({ now: 0, accounts: [] })
  logins.onGitHosts.mockResolvedValue({ hosts: [] })
  logins.onAgentState.mockResolvedValue({ driver: 'claude-code', ready: true })
})

afterEach(() => {
  cleanup()
  onPerson.mockReset()
  accounts.onClaudeAccounts.mockReset()
  accounts.sendUseClaudeAccountFirst.mockReset()
  for (const fn of Object.values(logins)) fn.mockReset()
})

describe('PersonMenu', () => {
  test('the person\'s row: their picture and first name, opening their whole name, the theme, the notifications, and Settings', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada', avatar: 'https://avatars.githubusercontent.com/u/1' })
    const onSettings = vi.fn()
    const { container } = render(<PersonMenu onSettings={onSettings} />)
    const row = await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    expect(row.textContent).toBe('Ada')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1')
    fireEvent.click(row)
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('@ada')).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Theme', 'Notifications', 'Settings'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledTimes(1)
  })

  test('a Claude row says which account runs use first and how full its week is; its submenu puts another first, or opens Settings to add one', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace' })
    accounts.onClaudeAccounts.mockResolvedValue({
      now: 0,
      accounts: [
        { id: 'This computer', name: 'Ada', own: true, weekPercent: 22, state: 'in-use' },
        { id: 'Dani', name: 'Dani', own: false, weekPercent: 61.4, asOf: 0, state: 'next' },
      ],
    })
    accounts.sendUseClaudeAccountFirst.mockResolvedValue({ ok: true })
    const onSettings = vi.fn()
    render(<PersonMenu onSettings={onSettings} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings' }))
    const row = await screen.findByRole('menuitem', { name: /Claude/ })
    expect(row.textContent).toBe('ClaudeAda · 22%')
    fireEvent.click(row)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Dani/ }))
    expect(accounts.sendUseClaudeAccountFirst).toHaveBeenCalledWith('Dani')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account…' }))
    expect(onSettings).toHaveBeenCalledWith('agent-accounts')
  })

  test('with no picture, or one that does not load, their initials', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', avatar: 'https://example.com/gone.png' })
    const { container } = render(<PersonMenu onSettings={() => {}} />)
    await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('AL')).toBeTruthy()
  })

  test('the first name is the first word; a one-word name, a login say, is itself', () => {
    expect(firstName('Suleiman Shahbari')).toBe('Suleiman')
    expect(firstName('  Ada King Lovelace ')).toBe('Ada')
    expect(firstName('suleimansh')).toBe('suleimansh')
  })

  test('initials: the first and last word\'s, or one for one word', () => {
    expect(initials('Suleiman Shahbari')).toBe('SS')
    expect(initials('Ada King Lovelace')).toBe('AL')
    expect(initials('octo')).toBe('O')
    expect(initials('  ')).toBe('?')
  })
})

const GITHUB = {
  host: 'github.com',
  projects: ['site'],
  provider: { name: 'GitHub', requestWord: 'pull request', tool: 'gh', installed: true, install: 'brew install gh', accounts: [{ login: 'octo', terminal: true, runs: true, ok: true }, { login: 'octo-agent', terminal: false, runs: false, ok: true }] },
}

describe('PersonMenu: the git host and what is missing', () => {
  test('a GitHub row says the account runs use; its submenu uses another for runs, or opens Git hosts to add one', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada' })
    logins.onGitHosts.mockResolvedValue({ hosts: [GITHUB] })
    logins.sendUseGitHostAccount.mockResolvedValue({ ok: true })
    const onSettings = vi.fn()
    render(<PersonMenu onSettings={onSettings} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings' }))
    const row = await screen.findByRole('menuitem', { name: /GitHub/ })
    expect(row.textContent).toContain('@octo')
    fireEvent.click(row)
    fireEvent.click(await screen.findByRole('menuitem', { name: '@octo-agent' }))
    expect(logins.sendUseGitHostAccount).toHaveBeenCalledWith('github.com', 'octo-agent')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account…' }))
    expect(onSettings).toHaveBeenCalledWith('git-hosts')
  })

  test('something runs need is missing: a dot on the picture, and the menu says what first, opening where it is fixed', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada' })
    logins.onAgentState.mockResolvedValue({ driver: 'claude-code', ready: false, problem: '`claude` is not logged in.', fix: { kind: 'log-in', command: 'claude auth login' } })
    const onSettings = vi.fn()
    const { container } = render(<PersonMenu onSettings={onSettings} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings, something is missing' }))
    expect(container.ownerDocument.querySelector('[data-testid="missing-dot"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Claude Code is not logged in.' }))
    expect(onSettings).toHaveBeenCalledWith('agent-accounts')
  })
})
