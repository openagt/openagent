import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Preferences } from '../../src/index.js'
import { forgetRemembered } from '../lib/use-async.js'

// The pickers around the message box that say who and where a run is: the computer it goes to,
// saved for the next opening; the coding agent's accounts, in the agent picker; the git host's
// account, a line of the gear's menu. Each for the computer the run goes to.

const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: Preferences = {}
let prefsLoaded = true
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  usePreferencesLoaded: () => prefsLoaded,
  updatePreferences,
  useActiveProjectId: () => 'p1',
}))
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => [] }))
const onCommands = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onProjects: () => Promise.resolve([]), onCommands, onRunHosts: async () => [] }))
const accounts = vi.hoisted(() => ({ onAgentAccounts: vi.fn(), sendUseAgentAccountFirst: vi.fn() }))
vi.mock('../rpc/accounts.js', () => accounts)
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendUseGitHostAccount: vi.fn(), onAgentState: vi.fn(), sendGitHostLogin: vi.fn(async () => ({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })), sendStopGitHostLogin: vi.fn(async () => ({ ok: true })), sendGitHostInstall: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const models = vi.hoisted(() => ({ onModels: vi.fn() }))
vi.mock('../rpc/models.js', () => models)
const route = vi.hoisted(() => ({ openSettings: vi.fn(), openPage: vi.fn() }))
vi.mock('../lib/host-services.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/host-services.js')>()
  return { ...actual, INERT_HOST_SERVICES: { ...actual.INERT_HOST_SERVICES, ...route } }
})
// The editor needs a real DOM; the pickers do not look at it.
vi.mock('./PromptEditor.js', async () => {
  const { forwardRef } = await import('react')
  return { PromptEditor: forwardRef(() => <input aria-label="prompt" />) }
})

const { Composer } = await import('./Composer.js')
const { useGitAccountSetup } = await import('./GitHosts.js')
const { GearMenu, gear, openSetupLine, setupLine } = await import('../test-utils.js')

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
  provider: { name: 'GitHub', requestWord: 'pull request', tool: 'gh', installed: true, install: 'brew install gh', accounts: [{ login: 'octo', runs: true, ok: true }, { login: 'octo-agent', runs: false, ok: true }] },
}

const renderComposer = () => render(<Composer files={[]} onSubmit={vi.fn()} busy={false} submitLabel="Send" submitBusyLabel="Sending…" />)

beforeEach(() => {
  prefs = {}
  prefsLoaded = true
  updatePreferences.mockReset()
  route.openSettings.mockReset()
  vi.clearAllMocks()
  onCommands.mockResolvedValue({ commands: [], gitHost: true, remote: true, address: 'github.com/acme/shop' })
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
})

describe('the agent picker holds each agent\'s accounts', () => {
  test("an agent's row says the account its runs take first; its part lists its models, then its accounts, which put another first, or add one", async () => {
    renderComposer()
    fireEvent.click(await screen.findByRole('button', { name: /^Coding agent: / }))
    const row = await screen.findByRole('menuitem', { name: /Claude Code/ })
    await waitFor(() => expect(row.textContent).toBe('Claude CodeAda·22%'))
    fireEvent.click(row)
    const part = (await screen.findByText('Accounts')).closest('[role=menu]')!
    expect([...part.querySelectorAll('[role=menuitem]')].map(item => item.textContent)).toEqual(['Opus 5.5', 'Ada22%', 'Dani61%', 'Add account…'])
    fireEvent.click(screen.getByRole('menuitem', { name: /Dani/ }))
    expect(accounts.sendUseAgentAccountFirst).toHaveBeenCalledWith('claude', 'Dani')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account…' }))
    expect(route.openPage).toHaveBeenCalledWith('permissions')
  })

  test('an agent with no account read has no accounts part, and Codex none while it is not installed and has one account', async () => {
    accounts.onAgentAccounts.mockImplementation(async (agent: string) => (agent === 'codex' ? { now: 0, computer: 'mac', accounts: [{ id: 'This computer', name: 'Ada L', own: true, windows: [] }] } : { now: 0, computer: 'mac', accounts: [] }))
    models.onModels.mockResolvedValue({ ...MODELS, codex: { models: [], error: '`codex` not found', missing: true } })
    renderComposer()
    fireEvent.click(await screen.findByRole('button', { name: /^Coding agent: / }))
    await waitFor(() => expect(accounts.onAgentAccounts).toHaveBeenCalledWith('codex'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByRole('menuitem', { name: /Codex/ }).textContent).toBe('Codex')
    expect(screen.getByRole('menuitem', { name: /Claude Code/ }).textContent).toBe('Claude Code')
  })

})

describe('the git host account a session pushes as', () => {
  /** The account's part of the gear, as the launcher draws it: its line in the gear's menu, the dialog beside it, and what the gear is told. */
  function Account({ address, picked, onPick }: { address: string; picked: string | undefined; onPick: (login: string) => void }) {
    const account = useGitAccountSetup(address, picked, onPick)
    return (
      <>
        <GearMenu lines={account.line} said={account.said ?? ''} warn={account.missing} />
        {account.dialog}
        <output data-testid="told">{JSON.stringify({ said: account.said, missing: account.missing, line: account.line !== null })}</output>
      </>
    )
  }
  const told = () => JSON.parse(screen.getByTestId('told').textContent!) as { said?: string; missing: boolean; line: boolean }
  /** A line's words as a screen reader hears them: without the account's picture, or the letter in its place. */
  const heard = (line: HTMLElement): string => {
    const copy = line.cloneNode(true) as HTMLElement
    for (const hidden of copy.querySelectorAll('[aria-hidden]')) hidden.remove()
    return copy.textContent ?? ''
  }

  /** The gear's menu has shut after a pick, all of it: a press on the gear while it shuts is lost. */
  const shut = () => waitFor(() => expect(screen.queryByRole('menu') === null && !gear().hasAttribute('data-popup-open')).toBe(true))

  test("the project's host's account its runs use, until one is picked for this session; the computer's pick is never changed; or adds one", async () => {
    const onPick = vi.fn()
    logins.onGitHosts.mockResolvedValue({ hosts: [{ ...GITHUB, provider: { ...GITHUB.provider, accounts: [{ ...GITHUB.provider.accounts[0], avatar: 'https://avatars.example/octo' }, GITHUB.provider.accounts[1]] } }] })
    const { rerender } = render(<Account address="github.com/acme/shop" picked={undefined} onPick={onPick} />)
    await waitFor(() => expect(told()).toEqual({ said: '@octo', missing: false, line: true }))
    // The line says the account, with its picture; the gear is not in the warning's colour.
    const line = await openSetupLine('GitHub account')
    expect(heard(line)).toBe('GitHub account: @octo')
    expect(line.querySelector('img')?.getAttribute('src')).toBe('https://avatars.example/octo')
    expect(gear().className).not.toContain('text-warning')
    expect(screen.getByText('GitHub account for this session')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '@octo-agent' }))
    expect(onPick).toHaveBeenCalledWith('octo-agent')
    expect(logins.sendUseGitHostAccount).not.toHaveBeenCalled()
    await shut()
    rerender(<Account address="github.com/acme/shop" picked="octo-agent" onPick={onPick} />)
    expect(told().said).toBe('@octo-agent')
    // With no picture, the account's first letter stands in its place.
    const picked = await setupLine('GitHub account')
    expect(heard(picked)).toBe('GitHub account: @octo-agent')
    expect([...picked.querySelectorAll('[aria-hidden]')].map(part => part.textContent)).toContain('O')
    // A pick the computer no longer has: the computer's again.
    rerender(<Account address="github.com/acme/shop" picked="gone" onPick={onPick} />)
    expect(told().said).toBe('@octo')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await shut()
    await openSetupLine('GitHub account')
    // One more is added here, in its dialog, and is then the one this session works as.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account…' }))
    expect(await screen.findByRole('dialog', { name: 'Add a GitHub account' })).toBeTruthy()
    await waitFor(() => expect(logins.sendGitHostLogin).toHaveBeenCalledWith('github.com'))
    logins.onGitHosts.mockResolvedValue({ hosts: [{ ...GITHUB, provider: { ...GITHUB.provider, accounts: [...GITHUB.provider.accounts, { login: 'new-agent', runs: false, ok: true }] } }] })
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('new-agent'), { timeout: 5000 })
  })

  test("a host with no account logged in says so on its line, the gear in the warning's colour, and the line's press opens the dialog that adds one, which outlives the menu; another host has no line", async () => {
    logins.onGitHosts.mockResolvedValue({ hosts: [{ ...GITHUB, provider: { ...GITHUB.provider, accounts: [] } }] })
    const { unmount } = render(<Account address="github.com/acme/shop" picked={undefined} onPick={vi.fn()} />)
    await waitFor(() => expect(told()).toEqual({ said: 'no GitHub account', missing: true, line: true }))
    expect(gear().className).toContain('text-warning')
    const line = await setupLine('GitHub account')
    expect(heard(line)).toBe('GitHub account: Add one…')
    // One press, no list to open.
    expect(line.getAttribute('aria-haspopup')).toBeNull()
    fireEvent.click(line)
    expect(await screen.findByRole('dialog', { name: 'Add a GitHub account' })).toBeTruthy()
    // The page behind the dialog is hidden from a screen reader, the gear with it: read off the page.
    await waitFor(() => expect(document.querySelector('[aria-label="Session setup"]')!.getAttribute('aria-expanded')).toBe('false'))
    expect(screen.getByRole('dialog', { name: 'Add a GitHub account' })).toBeTruthy()
    unmount()
    // The host's tool not installed is what the line and the hover say.
    logins.onGitHosts.mockResolvedValue({ hosts: [{ ...GITHUB, provider: { ...GITHUB.provider, installed: false, accounts: [] } }] })
    forgetRemembered()
    const missingTool = render(<Account address="github.com/acme/shop" picked={undefined} onPick={vi.fn()} />)
    await waitFor(() => expect(told()).toEqual({ said: 'gh not installed', missing: true, line: true }))
    expect(heard(await setupLine('GitHub account'))).toBe('GitHub account: gh not installed')
    missingTool.unmount()
    render(<Account address="gitlab.com/acme/shop" picked={undefined} onPick={vi.fn()} />)
    await waitFor(() => expect(logins.onGitHosts).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(told()).toEqual({ missing: false, line: false })
  })
})
