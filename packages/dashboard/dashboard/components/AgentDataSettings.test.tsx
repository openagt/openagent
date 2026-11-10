import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PersonalFolderView } from '../rpc/personal-folder.js'

let view: PersonalFolderView
const onPersonalFolder = vi.fn(async () => view)
const sendSyncPersonalFolder = vi.fn(async (_address: string, _login?: string) => ({ ok: true }) as { ok: true } | { ok: false; error: string })
const sendStopSyncingPersonalFolder = vi.fn(async () => ({ ok: true as const }))
const sendPersonalFolderAs = vi.fn(async (_login: string) => ({ ok: true as const }))
vi.mock('../rpc/personal-folder.js', () => ({ onPersonalFolder, sendSyncPersonalFolder, sendStopSyncingPersonalFolder, sendPersonalFolderAs }))
// The notice of what is not backed up has its own tests (BackupNotice.test.tsx).
vi.mock('./BackupNotice.js', async importOriginal => ({ ...(await importOriginal<object>()), BackupNotice: () => null }))
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), sendForgetGitHostAccount: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(async () => ({ ok: true })), sendGitHostInstall: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const github = (accounts: { login: string; runs: boolean; ok: boolean }[]) => ({
  hosts: [{ host: 'github.com', projects: [], provider: { name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts } }],
})

const { AgentDataSettings } = await import('./AgentDataSettings.js')

beforeEach(() => {
  view = { path: '~/.openagent', unsent: 0, projects: ['test-project', 'oa-newuser'], hosts: [{ host: 'github.com', logins: ['me-agent', 'reviewer-agent'], runs: 'reviewer-agent' }] }
  onPersonalFolder.mockClear()
  sendSyncPersonalFolder.mockClear()
  sendStopSyncingPersonalFolder.mockClear()
  logins.onGitHosts.mockResolvedValue(github([{ login: 'me-agent', runs: false, ok: true }, { login: 'reviewer-agent', runs: true, ok: true }]))
  logins.sendGitHostLogin.mockResolvedValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
})
afterEach(cleanup)

describe('Settings › Agent data', () => {
  test('says where the folder is, the projects that keep their data in it, and that it is on this computer only', async () => {
    render(<AgentDataSettings />)
    expect(await screen.findByText('~/.openagent · test-project, oa-newuser. Only on this computer.')).toBeTruthy()
  })

  test('syncing asks for the repository, sends what was typed, and then says what it syncs with', async () => {
    render(<AgentDataSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync with a repository' }))
    expect(screen.getByText(/Make an empty private repository, then paste its address/)).toBeTruthy()
    const sync = screen.getByRole('button', { name: 'Sync' })
    expect((sync as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Repository address'), { target: { value: 'github.com/me/agent' } })
    view = { ...view, remote: 'github.com/me/agent', remoteUrl: 'https://github.com/me/agent', account: 'reviewer-agent', unsent: 2 }
    fireEvent.click(sync)
    // Sent as one of OpenAgent's accounts at the host: the one runs use, unless another is picked.
    expect(screen.getByRole('combobox', { name: 'Back up as' }).textContent).toContain('@reviewer-agent')
    await waitFor(() => expect(sendSyncPersonalFolder).toHaveBeenCalledWith('github.com/me/agent', 'reviewer-agent'))
    // The address is a link inside the line, so the line is read whole.
    const line = (text: string) => (_: string, element: Element | null) => element?.tagName === 'P' && element.textContent === text
    expect(await screen.findByText(line('~/.openagent · test-project, oa-newuser. Backed up to github.com/me/agent as @reviewer-agent. 2 changes waiting to back up.'))).toBeTruthy()
    expect(screen.queryByLabelText('Repository address')).toBeNull()
    expect(screen.getByRole('link', { name: 'github.com/me/agent' }).getAttribute('href')).toBe('https://github.com/me/agent')
  })

  test("with no account of OpenAgent's at the host, nothing is sent: one is added right here, and Sync stays off until then", async () => {
    view = { ...view, hosts: [] }
    logins.onGitHosts.mockResolvedValue(github([]))
    render(<AgentDataSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync with a repository' }))
    fireEvent.change(screen.getByLabelText('Repository address'), { target: { value: 'github.com/me/agent' } })
    expect(await screen.findByText(/OpenAgent backs up to GitHub with an account of its own, never your own login/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add a GitHub account' }))
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
  })

  test('a synced folder says the account it is backed up as', async () => {
    view = { ...view, remote: 'github.com/me/agent', remoteUrl: 'https://github.com/me/agent', account: 'me-agent' }
    render(<AgentDataSettings />)
    const line = (text: string) => (_: string, element: Element | null) => element?.tagName === 'P' && element.textContent === text
    expect(await screen.findByText(line('~/.openagent · test-project, oa-newuser. Backed up to github.com/me/agent as @me-agent.'))).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Back up as' }).textContent).toContain('@me-agent')
  })

  test('a synced folder at a git host with no account named says it is not backed up, and leaves the fix to the notice above', async () => {
    view = { ...view, remote: 'github.com/me/agent', remoteUrl: 'https://github.com/me/agent', unsent: 3 }
    render(<AgentDataSettings />)
    const line = (text: string) => (_: string, element: Element | null) => element?.tagName === 'P' && element.textContent === text
    expect(await screen.findByText(line('~/.openagent · test-project, oa-newuser. Synced with github.com/me/agent, not backed up yet.'))).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Back up as' })).toBeNull()
  })

  test("a repository that refuses: its reason is said and the address stays to fix", async () => {
    sendSyncPersonalFolder.mockResolvedValueOnce({ ok: false, error: 'the repository could not be reached: not found' })
    render(<AgentDataSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync with a repository' }))
    fireEvent.change(screen.getByLabelText('Repository address'), { target: { value: 'github.com/me/typo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('the repository could not be reached: not found')).toBeTruthy()
    expect((screen.getByLabelText('Repository address') as HTMLInputElement).value).toBe('github.com/me/typo')
  })

  test('a synced folder can stop syncing', async () => {
    view = { ...view, remote: 'github.com/me/agent' }
    render(<AgentDataSettings />)
    view = { path: view.path, unsent: 0, projects: view.projects, hosts: view.hosts }
    fireEvent.click(await screen.findByRole('button', { name: 'Stop syncing' }))
    await waitFor(() => expect(sendStopSyncingPersonalFolder).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Sync with a repository' })).toBeTruthy()
  })
})
