import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const onPerson = vi.hoisted(() => vi.fn())
vi.mock('../rpc/person.js', () => ({ onPerson }))
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), sendGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const backup = vi.hoisted(() => ({ onBackup: vi.fn(), sendBackUpAs: vi.fn() }))
vi.mock('../rpc/backup.js', () => backup)
const openPage = vi.hoisted(() => vi.fn())
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, openPage } }
})
// The menu's theme row has its own suite; here it is the row's name.
vi.mock('./ThemeSubmenu.js', () => ({ ThemeSubmenu: () => <div role="menuitem">Theme</div> }))

const { PersonMenu, firstName } = await import('./PersonMenu.js')

beforeEach(() => {
  logins.onGitHosts.mockResolvedValue({ hosts: [] })
  backup.onBackup.mockResolvedValue({ gaps: [] })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  onPerson.mockReset()
  for (const fn of Object.values(logins)) fn.mockReset()
  backup.onBackup.mockReset()
})

describe('PersonMenu', () => {
  test('the person\'s row: their picture and first name, opening their whole name, the theme and Settings', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', github: 'ada', avatar: 'https://avatars.githubusercontent.com/u/1' })
    const onSettings = vi.fn()
    const { container } = render(<PersonMenu onSettings={onSettings} />)
    const row = await screen.findByRole('button', { name: 'Ada Lovelace: settings' })
    expect(row.textContent).toBe('Ada')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://avatars.githubusercontent.com/u/1')
    fireEvent.click(row)
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('@ada')).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Theme', 'Settings'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledTimes(1)
  })

  test('no accounts are in it: they are picked beside the message box, for the computer the run goes to', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', github: 'ada' })
    logins.onGitHosts.mockResolvedValue({ hosts: [GITHUB] })
    render(<PersonMenu onSettings={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings' }))
    await waitFor(() => expect(logins.onGitHosts).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Theme', 'Settings'])
  })

  test('drawn again, as a phone draws its sidebar at each opening, the row shows the person at once, while they are asked again', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', github: 'ada' })
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

  test('with no picture, the two letters the person\u2019s runs are marked with: a one-word name is its first two', async () => {
    onPerson.mockResolvedValue({ name: 'Demo' })
    render(<PersonMenu onSettings={() => {}} />)
    await screen.findByRole('button', { name: 'Demo: settings' })
    expect(screen.getByText('DE')).toBeTruthy()
  })
})

const GITHUB = {
  host: 'github.com',
  projects: ['site'],
  provider: { name: 'GitHub', requestWord: 'pull request', tool: 'gh', installed: true, install: 'brew install gh', accounts: [{ login: 'octo', terminal: true, runs: true, ok: true }, { login: 'octo-agent', terminal: false, runs: false, ok: true }] },
}

describe('PersonMenu: what is missing', () => {
  test('something runs need is missing: a dot on the picture, and the menu says first what fixes it, opening where it is fixed', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace', github: 'ada' })
    logins.onGitHosts.mockResolvedValue({ hosts: [{ ...GITHUB, provider: { ...GITHUB.provider, accounts: [{ login: 'octo', terminal: true, runs: true, ok: false }] } }] })
    const onSettings = vi.fn()
    const { container } = render(<PersonMenu onSettings={onSettings} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings, something is missing' }))
    expect(container.ownerDocument.querySelector('[data-testid="missing-dot"]')).toBeTruthy()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add your GitHub account again…' }))
    expect(openPage).toHaveBeenCalledWith('permissions')
    expect(onSettings).not.toHaveBeenCalled()
  })

  test('agent data not backed up: a dot on the picture, and an item that opens Settings › Your agent data to back it up', async () => {
    onPerson.mockResolvedValue({ name: 'Ada Lovelace' })
    backup.onBackup.mockResolvedValue({ gaps: [{ kind: 'personal', address: 'github.com/ada/agent', host: 'github.com', waiting: 2 }] })
    const onSettings = vi.fn()
    const { container } = render(<PersonMenu onSettings={onSettings} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ada Lovelace: settings, something is missing' }))
    expect(container.ownerDocument.querySelector('[data-testid="missing-dot"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Back up your agent data…' }))
    expect(onSettings).toHaveBeenCalledWith('agent-data')
  })
})
