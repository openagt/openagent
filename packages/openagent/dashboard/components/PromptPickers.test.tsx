import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Preferences } from '../../src/index.js'
import { forgetRemembered } from '@openagt/skill-ui/module'

// The pickers around the message box that say who and where a run is: the computer it goes to,
// saved for the next opening; the coding agent's accounts, in the agent picker; the git host's
// account, at the end of the row above the box. Each for the computer the run goes to.

const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: Preferences = {}
let prefsLoaded = true
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  usePreferencesLoaded: () => prefsLoaded,
  updatePreferences,
  useProjectPresets: () => [],
  saveProjectPresetList: vi.fn(),
  useActiveProjectId: () => 'p1',
}))
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => [] }))
const onCommands = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onProjects: () => Promise.resolve([]), onCommands }))
vi.mock('../rpc/machines.js', async () => (await import('../test-machines.js')).machinesRpc)
const accounts = vi.hoisted(() => ({ onAgentAccounts: vi.fn(), sendUseAgentAccountFirst: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), onAgentState: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const models = vi.hoisted(() => ({ onModels: vi.fn() }))
vi.mock('../rpc/models.js', () => models)
const route = vi.hoisted(() => ({ openSettings: vi.fn() }))
vi.mock('../lib/use-route.js', () => route)
// The editor needs a real DOM; the pickers do not look at it.
vi.mock('./PromptEditor.js', async () => {
  const { forwardRef } = await import('react')
  return { PromptEditor: forwardRef(() => <input aria-label="prompt" />) }
})

import { daemon, machinesRpc, saveMachines } from '../test-machines.js'
const { Composer } = await import('./Composer.js')
const { GitAccountMenu } = await import('./GitHosts.js')
const { resetRunOnForTest, selectMachine } = await import('../lib/remote-target.js')

const STUDIO = 'http://192.168.1.5:4200'
const STUDIO_MACHINE = { id: STUDIO, label: 'Studio', url: STUDIO }
const MODELS = { 'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5' }] }, codex: { models: [{ id: 'gpt-5.6', name: 'GPT-5.6' }] } }
const CLAUDE = {
  now: 0,
  computer: 'mac',
  accounts: [
    { id: 'This computer', name: 'Ada', own: true, windows: [{ label: '5 h', percent: 3 }, { label: 'week', percent: 22 }], state: 'in-use' },
    { id: 'Dani', name: 'Dani', own: false, windows: [{ label: 'week', percent: 61.4 }], state: 'next' },
  ],
}
const GITHUB = {
  host: 'github.com',
  projects: ['shop'],
  provider: { name: 'GitHub', requestWord: 'pull request', tool: 'gh', installed: true, install: 'brew install gh', accounts: [{ login: 'octo', terminal: true, runs: true, ok: true }, { login: 'octo-agent', terminal: false, runs: false, ok: true }] },
}

const renderComposer = () => render(<Composer files={[]} onSubmit={vi.fn()} busy={false} submitLabel="Send" submitBusyLabel="Sending…" />)
const runOn = () => screen.getByRole('button', { name: 'Run on' })

beforeEach(async () => {
  prefs = {}
  prefsLoaded = true
  updatePreferences.mockReset()
  route.openSettings.mockReset()
  resetRunOnForTest()
  vi.clearAllMocks()
  await saveMachines()
  // What a saved machine says, by default: nothing, as one that is not asked this.
  machinesRpc.onMachineModels.mockResolvedValue(null)
  machinesRpc.onMachineAgentAccounts.mockResolvedValue(null)
  machinesRpc.onMachineGitHosts.mockResolvedValue(null)
  onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
  models.onModels.mockResolvedValue(MODELS)
  accounts.onAgentAccounts.mockImplementation(async (agent: string) => (agent === 'claude' ? CLAUDE : { now: 0, computer: 'mac', accounts: [] }))
  accounts.sendUseAgentAccountFirst.mockResolvedValue({ ok: true })
  logins.onGitHosts.mockResolvedValue({ hosts: [GITHUB] })
  logins.sendUseGitHostAccount.mockResolvedValue({ ok: true })
  logins.onAgentState.mockResolvedValue({ driver: 'claude-code', ready: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  resetRunOnForTest()
})

describe('the computer a run goes to is saved for the next opening', () => {
  test('a pick is saved, and this machine is saved as none', async () => {
    await saveMachines(STUDIO_MACHINE)
    renderComposer()
    fireEvent.click(runOn())
    fireEvent.click(await screen.findByRole('menuitem', { name: /Studio/ }))
    expect(updatePreferences).toHaveBeenLastCalledWith({ runOn: STUDIO })
    fireEvent.click(runOn())
    fireEvent.click(await screen.findByRole('menuitem', { name: /This machine/ }))
    expect(updatePreferences).toHaveBeenLastCalledWith({ runOn: '' })
  })

  test('the saved pick is picked again as the page opens, before its machine answered, and stays once it is online', async () => {
    await saveMachines(STUDIO_MACHINE)
    daemon.reachable = { [STUDIO]: true }
    prefs = { runOn: STUDIO }
    renderComposer()
    await waitFor(() => expect(runOn().textContent).toBe('Studio'))
    await waitFor(() => expect(machinesRpc.onMachinesReachable).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(runOn().textContent).toBe('Studio')
    expect(screen.queryByRole('status')).toBeNull()
    expect(updatePreferences).not.toHaveBeenCalled()
  })

  test('not before the preferences are read: an opening with none read yet picks nothing', async () => {
    await saveMachines(STUDIO_MACHINE)
    prefsLoaded = false
    prefs = { runOn: STUDIO }
    renderComposer()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(runOn().textContent).toBe('This machine')
  })

  test('a saved machine offline as the page opens: the run starts on this machine, the page says so, and the pick stays saved', async () => {
    await saveMachines(STUDIO_MACHINE)
    daemon.reachable = { [STUDIO]: false }
    prefs = { runOn: STUDIO }
    renderComposer()
    expect((await screen.findByRole('status')).textContent).toBe('Studio is offline, so runs start on this machine. Pick it again once it is on.')
    expect(runOn().textContent).toBe('This machine')
    expect(updatePreferences).not.toHaveBeenCalled()
    // The person's pick ends the note.
    fireEvent.click(runOn())
    fireEvent.click(await screen.findByRole('menuitem', { name: /This machine/ }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('a saved machine no longer saved: the run starts on this machine, the page says so, and the pick is let go', async () => {
    prefs = { runOn: STUDIO }
    renderComposer()
    expect((await screen.findByRole('status')).textContent).toBe('The computer you last picked to run on is no longer saved, so runs start on this machine.')
    expect(runOn().textContent).toBe('This machine')
    expect(updatePreferences).toHaveBeenCalledWith({ runOn: '' })
  })
})

describe('the agent picker holds each agent\'s accounts, on the computer the run goes to', () => {
  test("an agent's row says the account its runs take first; its part lists its models, then its accounts, which put another first, or add one", async () => {
    renderComposer()
    fireEvent.click(await screen.findByRole('button', { name: /^Driver: / }))
    const row = await screen.findByRole('menuitem', { name: /Claude Code/ })
    await waitFor(() => expect(row.textContent).toBe('Claude CodeAda · 22%'))
    fireEvent.click(row)
    const part = (await screen.findByText('Accounts')).closest('[role=menu]')!
    expect([...part.querySelectorAll('[role=menuitem]')].map(item => item.textContent)).toEqual(['Opus 5.5', 'Ada22%', 'Dani61%', 'Add account…'])
    fireEvent.click(screen.getByRole('menuitem', { name: /Dani/ }))
    expect(accounts.sendUseAgentAccountFirst).toHaveBeenCalledWith('claude', 'Dani')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account…' }))
    expect(route.openSettings).toHaveBeenCalledWith('accounts')
  })

  test('an agent with no account read has no accounts part, and Codex none while it is not installed and has one account', async () => {
    accounts.onAgentAccounts.mockImplementation(async (agent: string) => (agent === 'codex' ? { now: 0, computer: 'mac', accounts: [{ id: 'This computer', name: 'Ada L', own: true, windows: [] }] } : { now: 0, computer: 'mac', accounts: [] }))
    models.onModels.mockResolvedValue({ ...MODELS, codex: { models: [], error: '`codex` not found', missing: true } })
    renderComposer()
    fireEvent.click(await screen.findByRole('button', { name: /^Driver: / }))
    await waitFor(() => expect(accounts.onAgentAccounts).toHaveBeenCalledWith('codex'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByRole('menuitem', { name: /Codex/ }).textContent).toBe('Codex')
    expect(screen.getByRole('menuitem', { name: /Claude Code/ }).textContent).toBe('Claude Code')
  })

  test('with a machine picked, its accounts are asked of it and picked there, and adding one opens its page', async () => {
    await saveMachines(STUDIO_MACHINE)
    selectMachine(STUDIO)
    machinesRpc.onMachineModels.mockResolvedValue(MODELS)
    machinesRpc.onMachineAgentAccounts.mockImplementation(async (_id: string, agent: string) => (agent === 'claude' ? { ...CLAUDE, computer: 'studio' } : null))
    renderComposer()
    await waitFor(() => expect(machinesRpc.onMachineAgentAccounts).toHaveBeenCalledWith(STUDIO, 'claude'))
    fireEvent.click(await screen.findByRole('button', { name: /^Driver: / }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Claude Code/ }))
    expect(await screen.findByText('Accounts on Studio')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /Dani/ }))
    expect(machinesRpc.sendMachineAgentAccountFirst).toHaveBeenCalledWith(STUDIO, 'claude', 'Dani')
    expect(accounts.sendUseAgentAccountFirst).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account…' }))
    expect(route.openSettings).toHaveBeenCalledWith('devices', STUDIO)
  })
})

describe('each saved computer that answers is asked ahead what the pickers show of it', () => {
  test('picked, it shows its model names, its accounts and its git account from the first frame, never this computer\'s or a blank', async () => {
    await saveMachines(STUDIO_MACHINE)
    daemon.reachable = { [STUDIO]: true }
    prefs = { model: 'opus' }
    machinesRpc.onMachineModels.mockResolvedValue({ ...MODELS, 'claude-code': { models: [{ id: 'opus', name: 'Opus' }] } })
    machinesRpc.onMachineAgentAccounts.mockImplementation(async (_id: string, agent: string) => (agent === 'claude' ? { ...CLAUDE, computer: 'studio' } : null))
    machinesRpc.onMachineGitHosts.mockResolvedValue({ hosts: [{ ...GITHUB, provider: { ...GITHUB.provider, accounts: [{ login: 'octo-vps', terminal: false, runs: true, ok: true }] } }] })
    renderComposer()
    await waitFor(() => expect(machinesRpc.onMachineGitHosts).toHaveBeenCalledWith(STUDIO))
    await waitFor(() => expect(machinesRpc.onMachineAgentAccounts).toHaveBeenCalledWith(STUDIO, 'codex'))
    expect(machinesRpc.onMachineModels).toHaveBeenCalledWith(STUDIO)
    await new Promise(resolve => setTimeout(resolve, 20))
    // From here on the computer never answers again: what shows is what was asked ahead.
    const never = () => new Promise<never>(() => {})
    machinesRpc.onMachineModels.mockImplementation(never)
    machinesRpc.onMachineAgentAccounts.mockImplementation(never)
    machinesRpc.onMachineGitHosts.mockImplementation(never)
    act(() => selectMachine(STUDIO))
    expect(screen.getByRole('button', { name: /^Driver: / }).getAttribute('aria-label')).toBe('Driver: Claude Code · Model: Opus')
    render(<GitAccountMenu address="github.com/acme/shop" machineId={STUDIO} on="Studio" busy={false} onAdd={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'GitHub account: @octo-vps' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Driver: / }))
    expect(screen.getByRole('menuitem', { name: /Claude Code/ }).textContent).toBe('Claude CodeAda · 22%')
  })
})

describe('the git host account a run pushes as', () => {
  test("the project's host's account its runs use; its menu uses another for runs, or adds one", async () => {
    const onAdd = vi.fn()
    render(<GitAccountMenu address="github.com/acme/shop" machineId={undefined} on={undefined} busy={false} onAdd={onAdd} />)
    const trigger = await screen.findByRole('button', { name: 'GitHub account: @octo' })
    expect(trigger.textContent).toBe('@octo')
    fireEvent.click(trigger)
    expect(screen.getByText('GitHub account')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '@octo-agent' }))
    expect(logins.sendUseGitHostAccount).toHaveBeenCalledWith('github.com', 'octo-agent')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account…' }))
    expect(onAdd).toHaveBeenCalled()
  })

  test("with a machine picked, the accounts are that machine's, asked of it and used there", async () => {
    machinesRpc.onMachineGitHosts.mockResolvedValue({ hosts: [{ ...GITHUB, provider: { ...GITHUB.provider, accounts: [{ login: 'octo-vps', terminal: false, runs: true, ok: true }, { login: 'octo', terminal: false, runs: false, ok: true }] } }] })
    render(<GitAccountMenu address="github.com/acme/shop" machineId={STUDIO} on="Studio" busy={false} onAdd={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'GitHub account: @octo-vps' }))
    expect(screen.getByText('GitHub account on Studio')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '@octo' }))
    expect(machinesRpc.sendMachineGitHostAccount).toHaveBeenCalledWith(STUDIO, 'github.com', 'octo')
    expect(logins.sendUseGitHostAccount).not.toHaveBeenCalled()
  })

  test('a host with no account logged in says so, and its press goes where one is added; another host, or none said, draws nothing', async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ ...GITHUB, provider: { ...GITHUB.provider, accounts: [] } }] })
    const onAdd = vi.fn()
    const { unmount } = render(<GitAccountMenu address="github.com/acme/shop" machineId={undefined} on={undefined} busy={false} onAdd={onAdd} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Log in to GitHub' }))
    expect(onAdd).toHaveBeenCalled()
    unmount()
    const other = render(<GitAccountMenu address="gitlab.com/acme/shop" machineId={undefined} on={undefined} busy={false} onAdd={vi.fn()} />)
    await waitFor(() => expect(logins.onGitHosts).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(other.container.textContent).toBe('')
    other.unmount()
    const silent = render(<GitAccountMenu address="github.com/acme/shop" machineId={STUDIO} on="Studio" busy={false} onAdd={vi.fn()} />)
    await waitFor(() => expect(machinesRpc.onMachineGitHosts).toHaveBeenCalledWith(STUDIO))
    expect(silent.container.textContent).toBe('')
  })
})
