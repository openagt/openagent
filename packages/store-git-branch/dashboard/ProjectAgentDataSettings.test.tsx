import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import type { ProjectAgentData } from '../src/server.js'
import { offered, pick, showing } from '../../ui/dashboard/test-controls.js'
import { ProjectAgentDataSettings } from './ProjectAgentDataSettings.js'

let data: ProjectAgentData
let share: (input: Record<string, unknown>) => unknown
const call = vi.fn(async (_projectId: string, name: string, input: object): Promise<ModuleCallResult> => ({ ok: true, output: name === 'data' ? data : name === 'share' ? share(input as Record<string, unknown>) : { ok: true } }))
const sent = (name: string) => call.mock.calls.filter(([, called]) => called === name).map(([projectId, , input]) => [projectId, input])
const host = fakeHost('@openagt/store-git-branch', { call })
const render = () => renderWithHost(<ProjectAgentDataSettings projects={[{ id: 'p1', name: 'shop' }]} />, host)

const keptIn = () => screen.getByRole('combobox', { name: 'Kept in' })
/** A line whose words are split by a link or a button in it, read whole. */
const line = (text: string) => (_: string, element: Element | null) => element?.tagName === 'P' && element.textContent === text

beforeEach(() => {
  data = {
    place: 'personal',
    folder: { path: '~/.openagent', remote: 'github.com/me/agent', remoteUrl: 'https://github.com/me/agent' },
    canShare: true,
    kept: [{ name: 'runs', count: 86 }, { name: 'tickets', count: 12 }, { name: 'plans', count: 0 }, { name: 'queue.md' }],
    accounts: { host: 'github.com', logins: ['me-agent', 'reviewer-agent'], runs: 'me-agent' },
  }
  share = () => ({ ok: true })
  call.mockClear()
  host.openSettings.mockClear()
})
afterEach(cleanup)

describe('Settings › Project › Project agent data', () => {
  test('says where the project’s data is, links the folder and its repository, and what its folder holds', async () => {
    render()
    await waitFor(() => expect(showing(keptIn())).toBe('Your folder'))
    expect(screen.getByText(line('In your folder ~/.openagent, synced with github.com/me/agent.'))).toBeTruthy()
    expect(screen.getByRole('link', { name: 'github.com/me/agent' }).getAttribute('href')).toBe('https://github.com/me/agent')
    fireEvent.click(screen.getByRole('button', { name: '~/.openagent' }))
    expect(host.openSettings).toHaveBeenCalledWith('agent-data')
    // A folder that holds nothing is left out.
    expect(screen.getByText('runs (86)').parentElement!.textContent).toBe('runs (86)·tickets (12)·queue.md')
  })

  test('moving the data to the repository asks first, says who can read it, then moves it', async () => {
    render()
    await waitFor(() => expect(showing(keptIn())).toBe('Your folder'))
    await pick(keptIn(), 'This project’s repository')
    expect(await screen.findByText('Keep this project’s agent data in its repository?')).toBeTruthy()
    expect(screen.getByText(/Everyone who can read the repository can read it/)).toBeTruthy()
    expect(sent('share')).toEqual([])
    // Pushed as one of OpenAgent's accounts, never the person's own login: the one runs use, or another picked.
    await pick(screen.getByRole('combobox', { name: 'Send as' }), '@reviewer-agent')
    data = { ...data, place: 'repository', account: 'reviewer-agent' }
    fireEvent.click(screen.getByRole('button', { name: 'Move and push' }))
    await waitFor(() => expect(sent('share')).toEqual([['p1', { on: true, login: 'reviewer-agent' }]]))
    expect(await screen.findByText('In this project’s repository, on the branch agent-data, sent as @reviewer-agent. Everyone who can read the repository can read it.')).toBeTruthy()
    await pick(screen.getByRole('combobox', { name: 'Send as' }), '@me-agent')
    await waitFor(() => expect(sent('sendAs')).toEqual([['p1', { login: 'me-agent' }]]))
  })

  test("with no account of OpenAgent's at the remote's host, the data cannot move: the dialog says where one is added", async () => {
    data = { ...data, accounts: { host: 'github.com', logins: [] } }
    render()
    await waitFor(() => expect(showing(keptIn())).toBe('Your folder'))
    await pick(keptIn(), 'This project’s repository')
    expect(await screen.findByText(/OpenAgent has no account at github\.com to send it as, and never uses your own login/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Move and push' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('data in the repository moves back to your folder at once; a refusal is said', async () => {
    data = { ...data, place: 'repository' }
    share = () => ({ ok: false, error: 'the personal folder could not be written' })
    render()
    await waitFor(() => expect(showing(keptIn())).toBe('This project’s repository'))
    await pick(keptIn(), 'Your folder')
    await waitFor(() => expect(sent('share')).toEqual([['p1', { on: false }]]))
    expect(await screen.findByText('the personal folder could not be written')).toBeTruthy()
  })

  test('a project with no remote cannot keep its data in its repository; nothing kept yet says so', async () => {
    data = { ...data, folder: { path: '~/.openagent' }, canShare: false, kept: [] }
    render()
    await waitFor(() => expect(showing(keptIn())).toBe('Your folder'))
    expect(screen.getByText(line('In your folder ~/.openagent, only on this computer.'))).toBeTruthy()
    expect(await offered(keptIn())).toContainEqual(['This project’s repository (it has no remote)', true])
    expect(screen.getByText('Nothing yet.')).toBeTruthy()
  })
})
