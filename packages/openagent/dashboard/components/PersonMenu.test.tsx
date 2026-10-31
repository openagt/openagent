import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered } from '@openagt/skill-ui/module'

const onPerson = vi.hoisted(() => vi.fn())
vi.mock('../rpc/person.js', () => ({ onPerson }))
const accounts = vi.hoisted(() => ({ onAgentAccounts: vi.fn(), sendUseAgentAccountFirst: vi.fn(), sendAddAgentAccount: vi.fn(), sendRemoveAgentAccount: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), sendGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
// The menu's theme and notifications rows have their own suites; here they are the rows' names.
vi.mock('./ThemeSubmenu.js', () => ({ ThemeSubmenu: () => <div role="menuitem">Theme</div> }))
vi.mock('./NotificationsSubmenu.js', () => ({ NotificationsSubmenu: () => <div role="menuitem">Notifications</div> }))

const { PersonMenu, firstName, initials } = await import('./PersonMenu.js')

beforeEach(() => {
  accounts.onAgentAccounts.mockResolvedValue({ now: 0, accounts: [] })
  logins.onGitHosts.mockResolvedValue({ hosts: [] })
  logins.onAgentState.mockResolvedValue({ driver: 'claude-code', ready: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  onPerson.mockReset()
  accounts.onAgentAccounts.mockReset()
  accounts.sendUseAgentAccountFirst.mockReset()
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

  test('no accounts are in it: they are picked beside the message box, for the computer the run goes to', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada' })
    logins.onGitHosts.mockResolvedValue({ hosts: [GITHUB] })
    accounts.onAgentAccounts.mockResolvedValue({ now: 0, accounts: [{ id: 'This computer', name: 'Ada', own: true, windows: [{ label: 'week', percent: 22 }] }] })
    render(<PersonMenu onSettings={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings' }))
    await waitFor(() => expect(logins.onGitHosts).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Theme', 'Notifications', 'Settings'])
  })

  test('drawn again, as a phone draws its sidebar at each opening, the row shows the person at once, while they are asked again', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada' })
    const first = render(<PersonMenu onSettings={() => {}} />)
    await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    first.unmount()
    onPerson.mockImplementation(() => new Promise(() => {}))
    render(<PersonMenu onSettings={() => {}} />)
    expect(screen.getByRole('button', { name: 'Ada Lovelace: settings' })).toBeTruthy()
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

describe('PersonMenu: what is missing', () => {
  test('something runs need is missing: a dot on the picture, and the menu says what first, opening where it is fixed', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', login: 'ada' })
    logins.onAgentState.mockResolvedValue({ driver: 'claude-code', ready: false, problem: '`claude` is not logged in.', fix: { kind: 'log-in', command: 'claude auth login' } })
    const onSettings = vi.fn()
    const { container } = render(<PersonMenu onSettings={onSettings} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings, something is missing' }))
    expect(container.ownerDocument.querySelector('[data-testid="missing-dot"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Claude Code is not logged in.' }))
    expect(onSettings).toHaveBeenCalledWith('accounts')
  })
})
