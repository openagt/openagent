import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { PersonalFolderView } from './calls.js'
import { github, renderCalling } from './test-host.js'

// The press of the module that adds an account, which says the module it was pressed for.
const shell = vi.hoisted(() => ({ added: [] as string[] }))
vi.mock('@openagt/ui/module', async original => ({
  ...(await original<typeof import('@openagt/ui/module')>()),
  ModuleFixPress: ({ fix }: { fix: { module: string; label: string } }) => (
    <button type="button" onClick={() => shell.added.push(fix.module)}>
      {fix.label}
    </button>
  ),
}))
// The notice of what is not backed up has its own tests (BackupNotice.test.tsx).
vi.mock('./BackupNotice.js', async importOriginal => ({ ...(await importOriginal<object>()), BackupNotice: () => null }))

const { AgentDataSettings } = await import('./AgentDataSettings.js')

let view: PersonalFolderView
let answers: Record<string, (input: Record<string, unknown>) => unknown>
const render = () => renderCalling(<AgentDataSettings />, (name, input) => (name === 'folder' ? view : (answers[name] ?? (() => ({ ok: true })))(input)))

beforeEach(() => {
  view = { path: '~/.openagent', unsent: 0, projects: ['test-project', 'oa-newuser'], hosts: [github(['me-agent', 'reviewer-agent'], 'reviewer-agent')] }
  answers = {}
  shell.added = []
})
afterEach(cleanup)

/** The paragraph whose whole text is this: a path in it is a strip of its own. */
const line = (text: string) => (_: string, element: Element | null) => element?.tagName === 'P' && element.textContent === text

describe('Settings › Your agent data', () => {
  test('says where the folder is, the projects that keep their data in it, and that it is on this computer only', async () => {
    render()
    expect(await screen.findByText(line('~/.openagent · test-project, oa-newuser. Only on this computer.'))).toBeTruthy()
  })

  test('syncing asks for the repository, sends what was typed, and then says what it syncs with', async () => {
    const { sent } = render()
    fireEvent.click(await screen.findByRole('button', { name: 'Sync with a repository' }))
    expect(screen.getByText(/Make an empty private repository, then paste its address/)).toBeTruthy()
    const sync = screen.getByRole('button', { name: 'Sync' })
    expect((sync as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Repository address'), { target: { value: 'github.com/me/agent' } })
    view = { ...view, remote: 'github.com/me/agent', remoteUrl: 'https://github.com/me/agent', account: 'reviewer-agent', unsent: 2 }
    fireEvent.click(sync)
    // Sent as one of OpenAgent's accounts at the host: the one runs use, unless another is picked.
    expect(screen.getByRole('combobox', { name: 'Back up as' }).textContent).toContain('@reviewer-agent')
    await waitFor(() => expect(sent('sync')).toEqual([{ address: 'github.com/me/agent', login: 'reviewer-agent' }]))
    // The address is a link inside the line, so the line is read whole.
    expect(await screen.findByText(line('~/.openagent · test-project, oa-newuser. Backed up to github.com/me/agent as @reviewer-agent. 2 changes waiting to back up.'))).toBeTruthy()
    expect(screen.queryByLabelText('Repository address')).toBeNull()
    expect(screen.getByRole('link', { name: 'github.com/me/agent' }).getAttribute('href')).toBe('https://github.com/me/agent')
  })

  test("with no account of OpenAgent's at the host, nothing is sent: one is added right here, and Sync stays off until then", async () => {
    view = { ...view, hosts: [github([])] }
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Sync with a repository' }))
    fireEvent.change(screen.getByLabelText('Repository address'), { target: { value: 'github.com/me/agent' } })
    expect(await screen.findByText(/OpenAgent backs up to github.com with an account of its own, never your own login/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add a GitHub account' }))
    expect(shell.added).toEqual(['github'])
  })

  test('a synced folder says the account it is backed up as', async () => {
    view = { ...view, remote: 'github.com/me/agent', remoteUrl: 'https://github.com/me/agent', account: 'me-agent' }
    render()
    expect(await screen.findByText(line('~/.openagent · test-project, oa-newuser. Backed up to github.com/me/agent as @me-agent.'))).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Back up as' }).textContent).toContain('@me-agent')
  })

  test('a synced folder at a git host with no account named says it is not backed up, and leaves the fix to the notice above', async () => {
    view = { ...view, remote: 'github.com/me/agent', remoteUrl: 'https://github.com/me/agent', unsent: 3 }
    render()
    expect(await screen.findByText(line('~/.openagent · test-project, oa-newuser. Synced with github.com/me/agent, not backed up yet.'))).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Back up as' })).toBeNull()
  })

  test('a repository that refuses: its reason is said and the address stays to fix', async () => {
    answers.sync = () => ({ ok: false, error: 'the repository could not be reached: not found' })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Sync with a repository' }))
    fireEvent.change(screen.getByLabelText('Repository address'), { target: { value: 'github.com/me/typo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('the repository could not be reached: not found')).toBeTruthy()
    expect((screen.getByLabelText('Repository address') as HTMLInputElement).value).toBe('github.com/me/typo')
  })

  test('a synced folder can stop syncing', async () => {
    view = { ...view, remote: 'github.com/me/agent' }
    const { sent } = render()
    view = { path: view.path, unsent: 0, projects: view.projects, hosts: view.hosts }
    fireEvent.click(await screen.findByRole('button', { name: 'Stop syncing' }))
    await waitFor(() => expect(sent('stopSyncing')).toEqual([{}]))
    expect(await screen.findByRole('button', { name: 'Sync with a repository' })).toBeTruthy()
  })
})
