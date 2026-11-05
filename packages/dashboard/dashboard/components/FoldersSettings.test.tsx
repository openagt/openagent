import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FoldersView } from '../rpc/folders.js'

let view: FoldersView
const onFolders = vi.fn(async () => view)
const sendSyncPersonalFolder = vi.fn(async (_address: string) => ({ ok: true }) as { ok: true } | { ok: false; error: string })
const sendStopSyncingPersonalFolder = vi.fn(async () => ({ ok: true as const }))
vi.mock('../rpc/folders.js', () => ({ onFolders, sendSyncPersonalFolder, sendStopSyncingPersonalFolder }))

const { FoldersSettings } = await import('./FoldersSettings.js')

beforeEach(() => {
  view = { personal: { path: '~/.openagent', unsent: 0, projects: ['test-project', 'oa-newuser'] }, shared: ['openagent'] }
  onFolders.mockClear()
  sendSyncPersonalFolder.mockClear()
  sendStopSyncingPersonalFolder.mockClear()
})
afterEach(cleanup)

describe('Settings › Folders', () => {
  test('says where the records are: the folder on this computer only, the projects in it, and the shared ones on their own branch', async () => {
    render(<FoldersSettings />)
    expect(await screen.findByText('~/.openagent · test-project, oa-newuser. Only on this computer.')).toBeTruthy()
    expect(screen.getByText("openagent · on the branch agent-data. Change it in the project's menu.")).toBeTruthy()
  })

  test('syncing asks for the repository, sends what was typed, and then says what it syncs with', async () => {
    render(<FoldersSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync with a repository' }))
    expect(screen.getByText(/Make an empty private repository, then paste its address/)).toBeTruthy()
    const sync = screen.getByRole('button', { name: 'Sync' })
    expect((sync as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Repository address'), { target: { value: 'github.com/me/agent' } })
    view = { ...view, personal: { ...view.personal, remote: 'github.com/me/agent', unsent: 2 } }
    fireEvent.click(sync)
    await waitFor(() => expect(sendSyncPersonalFolder).toHaveBeenCalledWith('github.com/me/agent'))
    expect(await screen.findByText('~/.openagent · test-project, oa-newuser. Synced with github.com/me/agent. 2 changes not sent yet.')).toBeTruthy()
    expect(screen.queryByLabelText('Repository address')).toBeNull()
  })

  test("a repository that refuses: its reason is said and the address stays to fix", async () => {
    sendSyncPersonalFolder.mockResolvedValueOnce({ ok: false, error: 'the repository could not be reached: not found' })
    render(<FoldersSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sync with a repository' }))
    fireEvent.change(screen.getByLabelText('Repository address'), { target: { value: 'github.com/me/typo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('the repository could not be reached: not found')).toBeTruthy()
    expect((screen.getByLabelText('Repository address') as HTMLInputElement).value).toBe('github.com/me/typo')
  })

  test('a synced folder can stop syncing', async () => {
    view = { ...view, personal: { ...view.personal, remote: 'github.com/me/agent' } }
    render(<FoldersSettings />)
    view = { ...view, personal: { path: view.personal.path, unsent: 0, projects: view.personal.projects } }
    fireEvent.click(await screen.findByRole('button', { name: 'Stop syncing' }))
    await waitFor(() => expect(sendStopSyncingPersonalFolder).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Sync with a repository' })).toBeTruthy()
  })
})
