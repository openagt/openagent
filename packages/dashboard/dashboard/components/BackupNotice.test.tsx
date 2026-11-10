import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), sendForgetGitHostAccount: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const backup = vi.hoisted(() => ({ onBackup: vi.fn(), sendBackUpAs: vi.fn() }))
vi.mock('../rpc/backup.js', () => backup)

const { BackupNotice } = await import('./BackupNotice.js')

const provider = (accounts: { login: string; runs: boolean; ok: boolean }[], over: Record<string, unknown> = {}) => ({
  name: 'GitHub',
  requestWord: 'pull request',
  logo: '<svg viewBox="0 0 24 24"></svg>',
  tool: 'gh',
  installed: true,
  install: 'brew install gh',
  accounts,
  ...over,
})
const hosts = (accounts: { login: string; runs: boolean; ok: boolean }[], over: Record<string, unknown> = {}) => ({ hosts: [{ host: 'github.com', projects: [], provider: provider(accounts, over) }] })

const PERSONAL = { kind: 'personal', address: 'github.com/me/agent', url: 'https://github.com/me/agent', host: 'github.com', waiting: 3 }
const SHOP = { kind: 'project', projectId: 'p1', project: 'shop', address: 'github.com/acme/shop', url: 'https://github.com/acme/shop', host: 'github.com' }

beforeEach(() => {
  backup.onBackup.mockResolvedValue({ gaps: [PERSONAL] })
  backup.sendBackUpAs.mockResolvedValue({ ok: true })
  logins.sendGitHostLogin.mockResolvedValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
  logins.sendStopGitHostLogin.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of [...Object.values(logins), ...Object.values(backup)]) fn.mockReset()
})

/** A line read whole: its address is a link inside it. */
const line = (text: string) => (_: string, element: Element | null) => (element?.tagName === 'LI' || element?.tagName === 'P') && element.textContent === text

describe('what is not backed up, at the top of Settings › Agent data', () => {
  test('everything backed up: nothing is said', async () => {
    backup.onBackup.mockResolvedValue({ gaps: [] })
    logins.onGitHosts.mockResolvedValue(hosts([]))
    const { container } = render(<BackupNotice />)
    await waitFor(() => expect(backup.onBackup).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  test('with no account of OpenAgent at the host: what waits, and the press that adds one, here', async () => {
    logins.onGitHosts.mockResolvedValue(hosts([]))
    render(<BackupNotice />)
    expect(await screen.findByText('Not backed up')).toBeTruthy()
    expect(await screen.findByText(line('Your agent data to github.com/me/agent · 3 changes waiting'))).toBeTruthy()
    expect(screen.getByText(/OpenAgent backs up to GitHub with an account of its own, never your own login/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a GitHub account' }))
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
    expect(screen.queryByRole('button', { name: 'Back up' })).toBeNull()
  })

  test('the login under way: its code is shown in the dialog the press opens, and no second code is asked for', async () => {
    logins.onGitHosts.mockResolvedValue(hosts([], { loggingIn: { code: 'ABCD-1234', url: 'https://github.com/login/device' } }))
    render(<BackupNotice />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add a GitHub account' }))
    expect(await within(await screen.findByRole('dialog', { name: 'Add a GitHub account' })).findByText('ABCD-1234')).toBeTruthy()
    expect(logins.sendGitHostLogin).not.toHaveBeenCalled()
  })

  test('with accounts: the person picks one, the one runs use first, and Back up sends as it', async () => {
    backup.onBackup.mockResolvedValue({ gaps: [PERSONAL, SHOP] })
    logins.onGitHosts.mockResolvedValue(hosts([{ login: 'other', runs: false, ok: true }, { login: 'me-agent', runs: true, ok: true }]))
    render(<BackupNotice />)
    expect(await screen.findByText(line('Your agent data to github.com/me/agent · 3 changes waiting'))).toBeTruthy()
    expect(screen.getByText(line('shop’s shared data to github.com/acme/shop'))).toBeTruthy()
    const picks = await screen.findAllByRole('combobox', { name: 'Back up as' })
    expect(picks[0]!.textContent).toContain('@me-agent')
    backup.onBackup.mockResolvedValue({ gaps: [SHOP] })
    fireEvent.click(screen.getAllByRole('button', { name: 'Back up' })[0]!)
    await waitFor(() => expect(backup.sendBackUpAs).toHaveBeenCalledWith({ kind: 'personal' }, 'me-agent'))
    // Read again: the folder is backed up now, the project still waits.
    await waitFor(() => expect(screen.queryByText(line('Your agent data to github.com/me/agent · 3 changes waiting'))).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Back up' }))
    await waitFor(() => expect(backup.sendBackUpAs).toHaveBeenLastCalledWith({ kind: 'project', projectId: 'p1' }, 'me-agent'))
  })

  test('a back-up the host refuses says why, and the notice stays', async () => {
    backup.sendBackUpAs.mockResolvedValue({ ok: false, error: '@me-agent cannot push to github.com/me/agent' })
    logins.onGitHosts.mockResolvedValue(hosts([{ login: 'me-agent', runs: true, ok: true }]))
    render(<BackupNotice />)
    fireEvent.click(await screen.findByRole('button', { name: 'Back up' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('@me-agent cannot push to github.com/me/agent')
    expect(screen.getByText('Not backed up')).toBeTruthy()
  })
})
