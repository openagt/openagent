import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ProjectAgentData } from '../rpc/project-agent-data.js'
import { offered, pick, showing } from '../test-controls.js'

let data: ProjectAgentData | null
const onProjectAgentData = vi.fn(async (_projectId: string) => data)
const sendShareRecords = vi.fn(async (_projectId: string, _on: boolean, _login?: string) => ({ ok: true }) as { ok: true } | { ok: false; error: string })
const sendProjectDataAs = vi.fn(async (_projectId: string, _login: string) => ({ ok: true as const }))
const openSettings = vi.hoisted(() => vi.fn())
vi.mock('../rpc/project-agent-data.js', () => ({ onProjectAgentData, sendProjectDataAs }))
vi.mock('../rpc/projects.js', () => ({ sendShareRecords }))
vi.mock('../lib/use-route.js', async importOriginal => ({ ...(await importOriginal<object>()), openSettings }))

const { ProjectAgentDataSettings } = await import('./ProjectAgentDataSettings.js')

const keptIn = () => screen.getByRole('combobox', { name: 'Kept in' })
/** A line whose words are split by a link or a button in it, read whole. */
const line = (text: string) => (_: string, element: Element | null) => element?.tagName === 'P' && element.textContent === text

beforeEach(() => {
  data = {
    place: 'personal',
    folder: { path: '~/.openagent', remote: 'github.com/me/agent', remoteUrl: 'https://github.com/me/agent' },
    canShare: true,
    kept: [
      { kind: 'runs', count: 86, skill: 'logs' },
      { kind: 'tickets', count: 12, skill: 'tickets' },
      { kind: 'queue', count: 0, skill: 'queue' },
    ],
    accounts: { host: 'github.com', logins: ['me-agent', 'reviewer-agent'], runs: 'me-agent' },
  }
  onProjectAgentData.mockClear()
  sendShareRecords.mockClear()
  openSettings.mockClear()
})
afterEach(cleanup)

describe('Settings › Project › Project agent data', () => {
  test('says where the project’s data is, links the folder and its repository, and what each skill keeps there', async () => {
    render(<ProjectAgentDataSettings projectId="p1" />)
    await waitFor(() => expect(showing(keptIn())).toBe('Your folder'))
    expect(screen.getByText(line('In your folder ~/.openagent, synced with github.com/me/agent.'))).toBeTruthy()
    expect(screen.getByRole('link', { name: 'github.com/me/agent' }).getAttribute('href')).toBe('https://github.com/me/agent')
    fireEvent.click(screen.getByRole('button', { name: '~/.openagent' }))
    expect(openSettings).toHaveBeenCalledWith('agent-data')
    // A kind with nothing kept is left out.
    expect(screen.getByText('86 runs (logs) · 12 tickets (tickets)')).toBeTruthy()
  })

  test('moving the data to the repository asks first, says who can read it, then moves it', async () => {
    render(<ProjectAgentDataSettings projectId="p1" />)
    await waitFor(() => expect(showing(keptIn())).toBe('Your folder'))
    await pick(keptIn(), 'This project’s repository')
    expect(await screen.findByText('Keep this project’s agent data in its repository?')).toBeTruthy()
    expect(screen.getByText(/Everyone who can read the repository can read it/)).toBeTruthy()
    expect(sendShareRecords).not.toHaveBeenCalled()
    // Pushed as one of OpenAgent's accounts, never the person's own login: the one runs use, or another picked.
    await pick(screen.getByRole('combobox', { name: 'Push as' }), '@reviewer-agent')
    data = { ...data!, place: 'repository', account: 'reviewer-agent' }
    fireEvent.click(screen.getByRole('button', { name: 'Move and push' }))
    await waitFor(() => expect(sendShareRecords).toHaveBeenCalledWith('p1', true, 'reviewer-agent'))
    expect(await screen.findByText('In this project’s repository, on the branch agent-data, sent as @reviewer-agent. Everyone who can read the repository can read it.')).toBeTruthy()
    await pick(screen.getByRole('combobox', { name: 'Send as' }), '@me-agent')
    await waitFor(() => expect(sendProjectDataAs).toHaveBeenCalledWith('p1', 'me-agent'))
  })

  test("with no account of OpenAgent's at the remote's host, the data cannot move: the dialog says where one is added", async () => {
    data = { ...data!, accounts: { host: 'github.com', logins: [] } }
    render(<ProjectAgentDataSettings projectId="p1" />)
    await waitFor(() => expect(showing(keptIn())).toBe('Your folder'))
    await pick(keptIn(), 'This project’s repository')
    expect(await screen.findByText(/OpenAgent has no account at github\.com to send it as, and never uses your own login/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Move and push' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('data in the repository moves back to your folder at once; a refusal is said', async () => {
    data = { ...data!, place: 'repository' }
    sendShareRecords.mockResolvedValueOnce({ ok: false, error: 'the personal folder could not be written' })
    render(<ProjectAgentDataSettings projectId="p1" />)
    await waitFor(() => expect(showing(keptIn())).toBe('This project’s repository'))
    await pick(keptIn(), 'Your folder')
    await waitFor(() => expect(sendShareRecords).toHaveBeenCalledWith('p1', false))
    expect(await screen.findByText('the personal folder could not be written')).toBeTruthy()
  })

  test('a project with no remote cannot keep its data in its repository; nothing kept yet says so', async () => {
    data = { ...data!, folder: { path: '~/.openagent' }, canShare: false, kept: [] }
    render(<ProjectAgentDataSettings projectId="p1" />)
    await waitFor(() => expect(showing(keptIn())).toBe('Your folder'))
    expect(screen.getByText(line('In your folder ~/.openagent, only on this computer.'))).toBeTruthy()
    expect(await offered(keptIn())).toContainEqual(['This project’s repository (it has no remote)', true])
    expect(screen.getByText('Nothing yet.')).toBeTruthy()
  })

  test('a project on another computer: its data is there', async () => {
    data = null
    render(<ProjectAgentDataSettings projectId="elsewhere~p1" />)
    expect(await screen.findByText('This project’s agent data is on the computer the project is on.')).toBeTruthy()
  })
})
