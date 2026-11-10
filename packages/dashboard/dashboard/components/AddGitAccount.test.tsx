import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'

const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)

const { AddGitAccountDialog, HostFix } = await import('./AddGitAccount.js')

const CODE = { code: 'ABCD-1234', url: 'https://github.com/login/device' }
const row = (over: Record<string, unknown> = {}) => ({
  host: 'github.com',
  projects: [],
  provider: { name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts: [{ login: 'octo', runs: true, ok: true }], ...over },
})
const hosts = (over: Record<string, unknown> = {}) => ({ hosts: [row(over)] })

beforeEach(() => {
  logins.onGitHosts.mockResolvedValue(hosts())
  logins.sendGitHostLogin.mockResolvedValue({ ok: true, ...CODE })
  logins.sendStopGitHostLogin.mockResolvedValue({ ok: true })
  logins.sendGitHostInstall.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  for (const fn of Object.values(logins)) fn.mockReset()
})

describe('the dialog that adds an account at a git host', () => {
  test('open, it asks for a code at once and shows it; the account once there is said, and the dialog closes on it', async () => {
    const onClose = vi.fn()
    render(<AddGitAccountDialog host="github.com" onClose={onClose} />)
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledTimes(1))
    logins.onGitHosts.mockResolvedValue(hosts({ loggingIn: CODE }))
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Copy the code' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    // The person signed in at the host: its package now lists one account more.
    logins.onGitHosts.mockResolvedValue(hosts({ accounts: [{ login: 'octo', runs: true, ok: true }, { login: 'octo-agent', runs: false, ok: true }] }))
    expect(await within(dialog).findByText('@octo-agent is added.', undefined, { timeout: 4000 })).toBeTruthy()
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('octo-agent'), { timeout: 3000 })
    // Nothing to give up: the login ended by itself.
    expect(logins.sendStopGitHostLogin).not.toHaveBeenCalled()
  })

  test('a login the host no longer took, added again, is the account it added', async () => {
    logins.onGitHosts.mockResolvedValue(hosts({ accounts: [{ login: 'octo', runs: true, ok: false }] }))
    const onClose = vi.fn()
    render(<AddGitAccountDialog host="github.com" onClose={onClose} />)
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalled())
    logins.onGitHosts.mockResolvedValue(hosts({ accounts: [{ login: 'octo', runs: true, ok: true }] }))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('octo'), { timeout: 5000 })
  })

  test('Cancel, or closing it, gives the login up; a closed dialog asks for nothing', async () => {
    logins.onGitHosts.mockResolvedValue(hosts({ loggingIn: CODE }))
    const onClose = vi.fn()
    const { rerender } = render(<AddGitAccountDialog host={undefined} onClose={onClose} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(logins.onGitHosts).not.toHaveBeenCalled()
    rerender(<AddGitAccountDialog host="github.com" onClose={onClose} />)
    const dialog = await screen.findByRole('dialog')
    // A login already under way is shown as it is: no second code is asked for.
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    expect(logins.sendGitHostLogin).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledWith()
    rerender(<AddGitAccountDialog host={undefined} onClose={onClose} />)
    await waitFor(() => expect(logins.sendStopGitHostLogin).toHaveBeenCalledWith('github.com'))
  })

  test('a login that ended with no account more says so, and a press asks for a new code; a code the package refused says why', async () => {
    logins.onGitHosts.mockResolvedValue(hosts({ loggingIn: CODE }))
    render(<AddGitAccountDialog host="github.com" onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    logins.onGitHosts.mockResolvedValue(hosts())
    expect(await within(dialog).findByText(/No account was added/, undefined, { timeout: 4000 })).toBeTruthy()
    logins.sendGitHostLogin.mockResolvedValue({ ok: false, error: 'gh could not reach github.com.' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get a new code' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('gh could not reach github.com.')
    expect(within(dialog).getByRole('button', { name: 'Get a new code' })).toBeTruthy()
  })

  test('the tool not here: its install first, with the command; once it is here the code is asked for by itself', async () => {
    logins.onGitHosts.mockResolvedValue(hosts({ installed: false, accounts: [] }))
    render(<AddGitAccountDialog host="github.com" onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('gh, the tool for GitHub, is not installed.')).toBeTruthy()
    expect(within(dialog).getByText('brew install gh')).toBeTruthy()
    logins.onGitHosts.mockResolvedValue(hosts({ accounts: [] }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install gh' }))
    await waitFor(() => expect(logins.sendGitHostInstall).toHaveBeenCalledWith('github.com'))
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
  })

  test('a host no package answers for says so', async () => {
    render(<AddGitAccountDialog host="gitlab.example.com" onClose={vi.fn()} />)
    expect(await screen.findByText('No package answers for gitlab.example.com yet.')).toBeTruthy()
    expect(logins.sendGitHostLogin).not.toHaveBeenCalled()
  })
})

describe('the press for a host with no account', () => {
  test('opens the dialog, and tells its place of the account once added; nothing for a host that has one', async () => {
    const onChanged = vi.fn(async () => {})
    const { rerender } = render(<HostFix row={row({ accounts: [] }) as never} onChanged={onChanged} />)
    logins.onGitHosts.mockResolvedValue(hosts({ accounts: [] }))
    fireEvent.click(screen.getByRole('button', { name: 'Add a GitHub account' }))
    await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalled())
    logins.onGitHosts.mockResolvedValue(hosts({ accounts: [{ login: 'octo-agent', runs: true, ok: true }] }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled(), { timeout: 5000 })
    rerender(<HostFix row={row() as never} onChanged={onChanged} />)
    expect(screen.queryByRole('button', { name: 'Add a GitHub account' })).toBeNull()
  })

  test('a tool this computer has no install for is said, with no press', () => {
    render(<HostFix row={row({ installed: false, install: undefined, accounts: [] }) as never} onChanged={vi.fn(async () => {})} />)
    expect(screen.getByText('Install gh by hand: GitHub makes none for this computer.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
