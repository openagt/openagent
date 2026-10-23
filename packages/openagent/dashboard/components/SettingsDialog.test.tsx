import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { refreshPreferences } from '../lib/preferences.js'
import { forgetRemembered } from '../lib/use-async.js'
import { ModulesContext, byMountOrder, type MountedModules } from '../lib/use-modules.js'
import { CalendarClock, Network, Smartphone } from 'lucide-react'
import { checked, choices, closeList, offered, openList, pick, showing } from '../test-controls.js'

// The reads Settings makes, answered as an empty machine: no saved machines, no editors detected, no
// stored preferences.
const prefsRead = vi.hoisted(() => vi.fn(async (): Promise<Record<string, unknown>> => ({})))
// What the page saves, one call per pick with the keys it changed. Answered as a daemon that could
// not store it: the page then keeps showing the pick it was given, which is what the tests read.
const prefsSaved = vi.hoisted(() => vi.fn(async (_patch: Record<string, unknown>) => ({ ok: false as const, error: 'failed to save preferences' })))
vi.mock('../rpc/preferences.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../rpc/preferences.js')>()),
  onPreferences: prefsRead,
  patchPreferences: prefsSaved,
}))
vi.mock('../rpc/machines.js', async () => (await import('../test-machines.js')).machinesRpc)
// The coding agents' own lists, as the daemon asked them: Claude Code answered, Codex could not.
const onModels = vi.hoisted(() =>
  vi.fn(async () => ({
    'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5' }, { id: 'claude-fable-5-1', name: 'Fable 5.1' }] },
    codex: { models: [], error: 'not logged in' },
  })),
)
vi.mock('../rpc/models.js', () => ({ onModels }))
// Its own suite reads the accounts; here the entry is its name.
vi.mock('./AgentAccounts.js', () => ({ AGENT_ACCOUNTS_ENTRY: 'agent-accounts', AgentAccountsSettings: () => <p>Claude accounts</p> }))
vi.mock('./GitHosts.js', () => ({ GitHostsSettings: () => <p>Git hosts</p> }))
const projectAccounts = vi.hoisted(() => ({ onProjectAccounts: vi.fn(async () => ({})), sendProjectAccounts: vi.fn() }))
vi.mock('../rpc/logins.js', () => projectAccounts)
vi.mock('../rpc/reads.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../rpc/reads.js')>()),
  onBridgeToken: vi.fn(async () => null),
  onBridgeBrowser: vi.fn(async () => ({ state: 'off' as const })),
  onPreferences: vi.fn(async () => ({})),
  onDetectedEditors: vi.fn(async () => []),
  onDashboard: vi.fn(async () => null),
  onOnboardingSuggestion: vi.fn(async () => null),
}))

import { SettingsDialog } from './SettingsDialog.js'
import type { ProjectSummary } from '../../src/index.js'

const onClose = vi.fn()

/** Settings as the shell holds it: the entry shown is the address's, and picking one changes it. */
function Shown({ start, scope, projects }: { start: string; scope: string | null; projects: ProjectSummary[] }) {
  const [entry, setEntry] = useState(start)
  return <SettingsDialog entry={entry} onEntry={setEntry} onClose={onClose} scope={scope} projects={projects} />
}

/** Settings opened on `entry` (its first one when `''`), with the sidebar's pick and the registered projects. */
const open = (entry = '', { scope = null, projects = [] }: { scope?: string | null; projects?: Partial<ProjectSummary>[] } = {}) =>
  render(<Shown start={entry} scope={scope} projects={projects as ProjectSummary[]} />)

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
  prefsSaved.mockClear()
  onClose.mockClear()
  vi.unstubAllGlobals()
})

/** A row picked from a list, by its label: the button that shows its pick and opens its list. */
const select = (label: string) => screen.getByRole('combobox', { name: label })
/** What the page saved, in order: the keys of each pick. */
const saves = () => prefsSaved.mock.calls.map(([patch]) => patch)

describe('Settings dropdowns (#1172)', () => {
  test('no dropdown renders with nothing in it', async () => {
    // The reported paper cut was an empty dropdown at the bottom of this page: a control you can
    // open and not use, which reads as broken rather than as "no choices here". The control itself
    // did not survive the deletions on this branch, so this asserts the property rather than
    // hunting the instance — the next dynamic option list is the one that would bring it back.
    open('appearance')
    const usable = async (names: string[]) => {
      const selects = screen.getAllByRole('combobox')
      // Settings really did render its controls: the project select, then each row picked from a list, by its name.
      expect(selects.map(select => select.getAttribute('aria-label'))).toEqual(names)
      for (const select of selects) {
        expect((await choices(select)).length).toBeGreaterThan(0)
        // And none shows an empty button: the pick is said in words before the list is opened.
        expect(showing(select)).not.toBe('')
      }
    }
    await usable(['Project', 'Theme', 'Editor'])
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    await usable(['Project', 'Agent', 'Model'])
  })

  test('an editor list the daemon could not fill still leaves a usable Editor row', async () => {
    // Its options are the one list on the page assembled at run time. Auto-detect is a real
    // choice rather than a placeholder, so the row stays operable with nothing detected.
    open('appearance')
    expect(await choices(select('Editor'))).toEqual(['Auto-detect'])
    // It is the pick, though its value is no text.
    expect(showing(select('Editor'))).toBe('Auto-detect')
  })

  test('picking a theme saves it, and the row shows it', async () => {
    prefsRead.mockResolvedValueOnce({})
    refreshPreferences()
    open()
    await waitFor(() => expect(showing(select('Theme'))).toBe('System'))
    expect(await choices(select('Theme'))).toEqual(['System', 'Light', 'Dark'])
    await pick(select('Theme'), 'Dark')
    expect(saves()).toEqual([{ theme: 'dark' }])
    expect(showing(select('Theme'))).toBe('Dark')
  })
})

describe('Settings › Agent', () => {
  test("the Model row offers the agent's own list, the start menu's, after the agent's own default", async () => {
    prefsRead.mockResolvedValueOnce({})
    refreshPreferences()
    open('agent')
    await waitFor(async () =>
      expect(await offered(select('Model'))).toEqual([
        ["the CLI's own default", false],
        ['Opus 5.5', false],
        ['Fable 5.1', false],
      ]),
    )
    expect(showing(select('Model'))).toBe("the CLI's own default")
    // Each is saved by the id the agent gave it, and the agent's own default as no model at all.
    await pick(select('Model'), 'Opus 5.5')
    await pick(select('Model'), 'Fable 5.1')
    await pick(select('Model'), "the CLI's own default")
    expect(saves()).toEqual([{ model: 'opus' }, { model: 'claude-fable-5-1' }, { model: '' }])
    expect(showing(select('Model'))).toBe("the CLI's own default")
  })

  test('a saved model the agent does not list is kept, by its id, since a start is still given it', async () => {
    prefsRead.mockResolvedValueOnce({ model: 'fable' })
    refreshPreferences()
    open('agent')
    await waitFor(() => expect(showing(select('Model'))).toBe('fable'))
    await waitFor(async () => expect((await choices(select('Model'))).slice(0, -1)).toEqual(["the CLI's own default", 'Opus 5.5', 'Fable 5.1']))
    expect((await offered(select('Model'))).at(-1)).toEqual(['fable', false])
    // The line is the saved id itself, not only its words: it is the one the list marks as the pick.
    const lines = within(await openList(select('Model'))).getAllByRole('option')
    expect(lines.map(line => line.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true'])
    await closeList(select('Model'))
  })

  test('an agent that could not list its models says why, in a line that cannot be picked', async () => {
    prefsRead.mockResolvedValueOnce({ driver: 'codex' })
    refreshPreferences()
    open('agent')
    await waitFor(() => expect(showing(select('Agent'))).toBe('Codex'))
    await waitFor(async () =>
      expect(await offered(select('Model'))).toEqual([
        ["the CLI's own default", false],
        ['not logged in', true],
      ]),
    )
  })

  test("picking another agent leaves the model unpinned: a model is one agent's own", async () => {
    prefsRead.mockResolvedValueOnce({ model: 'opus' })
    refreshPreferences()
    open('agent')
    await waitFor(() => expect(showing(select('Model'))).toBe('Opus 5.5'))
    expect(await choices(select('Agent'))).toEqual(['Claude Code', 'Codex'])
    await pick(select('Agent'), 'Codex')
    expect(saves()).toEqual([{ driver: 'codex', model: '' }])
    expect(showing(select('Agent'))).toBe('Codex')
    expect(showing(select('Model'))).toBe("the CLI's own default")
  })
})

describe('Settings on and off rows', () => {
  const row = (label: string) => screen.getByRole('switch', { name: label })

  test('each is a switch that shows what is saved, and switching it saves that one setting at once', async () => {
    prefsRead.mockResolvedValueOnce({ postMergeCleanup: true, notifyNewActivity: false })
    refreshPreferences()
    open('agent')
    await waitFor(() => expect(checked(row('Post-merge cleanup'))).toBe(true))
    // No box to tick anywhere among Settings' own rows: on and off is a switch.
    const switches = () => screen.getAllByRole('switch').map(each => [each.getAttribute('aria-label'), checked(each)])
    expect(switches()).toEqual([
      // Naming a run costs money for something only a person looks at, so it is a switch — on
      // until it is turned off, since a list of first lines is what it was put there to fix.
      ['Name each run', true],
      ['Show what the agent thought', false],
      ['Post-merge cleanup', true],
    ])
    fireEvent.click(row('Name each run'))
    expect(checked(row('Name each run'))).toBe(false)
    fireEvent.click(row('Post-merge cleanup'))
    expect(checked(row('Post-merge cleanup'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(switches()).toEqual([
      ['Browser', true],
      ['Human Queue', true],
      ['New activity', false],
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Claude web' }))
    expect(switches()).toEqual([['Browser bridge', false]])
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(row('New activity'))
    expect(checked(row('New activity'))).toBe(true)
    fireEvent.click(row('Human Queue'))
    fireEvent.click(row('Browser'))
    expect(saves()).toEqual([{ nameRuns: false }, { postMergeCleanup: false }, { notifyNewActivity: true }, { notifyHumanIntervention: false }, { notifyBrowser: false }])
    expect([checked(row('Human Queue')), checked(row('Browser'))]).toEqual([false, false])
  })

  test('notifications the browser blocked: the Browser row says so, reads off, and cannot be switched', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    prefsRead.mockResolvedValueOnce({ notifyBrowser: true })
    refreshPreferences()
    open('notifications')
    const browser = row('Browser')
    await waitFor(() => expect(browser.getAttribute('aria-disabled')).toBe('true'))
    // Why is said in the row itself, in place of what the setting does.
    expect(within(browser.parentElement!.parentElement!).getByText('Blocked in your browser settings')).toBeTruthy()
    expect(checked(browser)).toBe(false)
    fireEvent.click(browser)
    expect(saves()).toEqual([])
    expect(checked(browser)).toBe(false)
    // The rows beside it still switch.
    expect(row('Human Queue').getAttribute('aria-disabled')).toBeNull()
  })
})

describe('Settings › Claude web (#1332)', () => {
  test('with the bridge on, which browser does the work is one choice, and each option carries its own setup', async () => {
    // "Browser bridge" and "Bridge browser" as two toggles read as anagrams of each other; the
    // real decision is which browser drives claude.ai, so it is presented as exactly that.
    prefsRead.mockResolvedValueOnce({ bridge: true, bridgeBrowser: true })
    refreshPreferences()
    open('claude-web')
    const daemon = await screen.findByRole('radio', { name: /A browser the daemon runs/ })
    const own = screen.getByRole('radio', { name: 'Your own Chrome' })
    // One choice: the two are the radios of one group, named by the question.
    const group = screen.getByRole('radiogroup', { name: 'Which browser does the work?' })
    expect(within(group).getAllByRole('radio')).toEqual([daemon, own])
    expect(checked(daemon)).toBe(true)
    expect(checked(own)).toBe(false)
    // The daemon's browser carries its status; the token to paste belongs to the other option only.
    await waitFor(() => expect(screen.getByText(/The bridge browser is off/)).toBeTruthy())
    expect(screen.queryByText(/paste this token/)).toBeNull()
  })

  test('picking the other browser saves it, by the radio or by its words', async () => {
    prefsRead.mockResolvedValueOnce({ bridge: true, bridgeBrowser: true })
    refreshPreferences()
    open('claude-web')
    fireEvent.click(await screen.findByRole('radio', { name: 'Your own Chrome' }))
    expect(saves()).toEqual([{ bridgeBrowser: false }])
    expect(checked(screen.getByRole('radio', { name: 'Your own Chrome' }))).toBe(true)
    expect(checked(screen.getByRole('radio', { name: /A browser the daemon runs/ }))).toBe(false)
    // The status of the daemon's browser goes with its option.
    expect(screen.queryByText(/The bridge browser is off/)).toBeNull()
    // The words are the radio's label: a click on them picks it too.
    fireEvent.click(screen.getByText('A browser the daemon runs — recommended'))
    expect(saves()).toEqual([{ bridgeBrowser: false }, { bridgeBrowser: true }])
    expect(checked(screen.getByRole('radio', { name: /A browser the daemon runs/ }))).toBe(true)
  })

  test('with the bridge off there is no browser to choose, and switching the bridge on asks which', async () => {
    prefsRead.mockResolvedValueOnce({ bridge: false })
    refreshPreferences()
    open('claude-web')
    const bridge = await screen.findByRole('switch', { name: 'Browser bridge' })
    await waitFor(() => expect(checked(bridge)).toBe(false))
    expect(screen.queryByText(/Which browser does the work/)).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    fireEvent.click(bridge)
    expect(saves()).toEqual([{ bridge: true }])
    expect(checked(bridge)).toBe(true)
    // Nothing saved says the daemon's browser, so the person's own Chrome is the pick.
    expect(checked(screen.getByRole('radio', { name: 'Your own Chrome' }))).toBe(true)
  })
})

describe('Settings › Appearance', () => {
  test("the Overview's onboarding checklist shows again from here, once its ✕ hid it", async () => {
    prefsRead.mockResolvedValueOnce({ onboardingDismissed: true })
    refreshPreferences()
    open('appearance')
    const onboarding = screen.getByRole('switch', { name: 'Onboarding on the Overview' })
    await waitFor(() => expect(checked(onboarding)).toBe(false))
    fireEvent.click(onboarding)
    expect(saves()).toEqual([{ onboardingDismissed: false }])
    expect(checked(onboarding)).toBe(true)
  })
})

describe('the Settings list', () => {
  const mounted = (settings: MountedModules['settings']): MountedModules => ({ pages: [], cards: [], linkActions: [], panels: [], runSlots: [], settings, everyPage: [], loaded: true })
  const PROJECTS = [
    { id: 'p1', name: 'gemstack', gitHost: true },
    { id: 'p2', name: 'other', gitHost: true },
    { id: 'p3', name: 'plain', gitHost: true },
  ]
  /** A package's settings that says which projects it was given. */
  const Given = ({ projects }: { projects: { name: string }[] }) => <p>{`for: ${projects.map(p => p.name).join(', ') || 'no project'}`}</p>
  const Broken = () => {
    throw new Error('boom')
  }
  const MODULES = mounted([
    { id: 'devices', title: 'Devices', icon: Smartphone, Section: Given, package: '@openagt/devices', projects: [], computer: true },
    { id: 'orchestration', title: 'Orchestration', icon: Network, Section: Given, package: '@openagt/skill-orchestration', projects: ['p1', 'p2', 'gone'], computer: false },
    { id: 'scheduler', title: 'Scheduler', icon: CalendarClock, Section: Broken, package: '@openagt/skill-scheduler', projects: ['p2'], computer: false },
  ])
  const show = (entry: string, scope: string | null = null) =>
    render(
      <ModulesContext.Provider value={MODULES}>
        <Shown start={entry} scope={scope} projects={PROJECTS as ProjectSummary[]} />
      </ModulesContext.Provider>,
    )
  const entries = (group: string) => within(screen.getByRole('region', { name: group })).getAllByRole('button').map(b => b.textContent)
  const title = () => screen.getByRole('dialog').querySelector('h2')!.textContent

  test("two groups: yours and this computer's, the computer's packages among them; then the picked project's packages", () => {
    show('', 'p1')
    expect(entries('You and this computer')).toEqual(['Appearance', 'Notifications', 'Agent', 'Agent accounts', 'Git hosts', 'Claude web', 'Devices'])
    // gemstack has orchestration and no scheduler.
    expect(entries('Project')).toEqual(['Orchestration'])
    expect(showing(select('Project'))).toBe('gemstack')
    // Opened on nothing in particular: the first entry.
    expect(title()).toBe('SettingsAppearance')
    expect(screen.getByRole('button', { name: 'Appearance' }).getAttribute('aria-current')).toBe('page')
  })

  test("a project's own accounts are an entry of that project's, first, when the computer has something to pick; never under All projects", async () => {
    projectAccounts.onProjectAccounts.mockResolvedValue({ gitHost: { host: 'github.com', name: 'GitHub', accounts: ['octo', 'octo-agent'], computer: 'octo' } } as never)
    show('', 'p1')
    await waitFor(() => expect(entries('Project')).toEqual(['Accounts', 'Orchestration']))
    await pick(select('Project'), 'All projects')
    expect(entries('Project')).toEqual(['Orchestration', 'Scheduler'])
    projectAccounts.onProjectAccounts.mockResolvedValue({} as never)
  })

  test("a project's Accounts entry read ahead is in the list from the dialog's first frame, not after the server's second", async () => {
    const { readProjectAccountsAhead } = await import('./ProjectAccounts.js')
    projectAccounts.onProjectAccounts.mockResolvedValueOnce({ gitHost: { host: 'github.com', name: 'GitHub', requestWord: 'pull request', accounts: ['octo', 'octo-agent'], computer: 'octo' } } as never)
    readProjectAccountsAhead('p1')
    await new Promise(resolve => setTimeout(resolve, 0))
    // Opened later, and the server slow to answer again.
    projectAccounts.onProjectAccounts.mockImplementation(() => new Promise(() => {}))
    show('', 'p1')
    expect(entries('Project')).toEqual(['Accounts', 'Orchestration'])
    projectAccounts.onProjectAccounts.mockReset()
    projectAccounts.onProjectAccounts.mockResolvedValue({} as never)
  })

  test("a package's entry of the picked project is given that project alone, and the computer's none", () => {
    show('orchestration', 'p1')
    expect(title()).toBe('SettingsgemstackOrchestration')
    expect(screen.getByText('for: gemstack')).toBeTruthy()
    expect(screen.queryByText(/^Saved to/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }))
    expect(title()).toBe('SettingsDevices')
    expect(screen.getByText('for: no project')).toBeTruthy()
  })

  test('the project select changes the project group, and All projects gives an entry every project that has its package, saying which', async () => {
    show('orchestration', 'p1')
    await pick(select('Project'), 'All projects')
    expect(entries('Project')).toEqual(['Orchestration', 'Scheduler'])
    expect(title()).toBe('SettingsAll projectsOrchestration')
    expect(screen.getByText('for: gemstack, other')).toBeTruthy()
    expect(screen.getByText('Saved to 2 projects: gemstack, other.')).toBeTruthy()
    // One that throws breaks only itself.
    fireEvent.click(screen.getByRole('button', { name: 'Scheduler' }))
    expect(screen.getByText('The Scheduler settings failed: boom')).toBeTruthy()
    expect(screen.getByText('Saved to one project: other.')).toBeTruthy()
    await pick(select('Project'), 'plain')
    expect(screen.getByText('Nothing to set for this project.')).toBeTruthy()
    // The entry it was on is not plain's: the first entry shows.
    expect(title()).toBe('SettingsAppearance')
  })

  test('with no project picked in the sidebar, the project group opens on every project', () => {
    show('')
    expect(showing(select('Project'))).toBe('All projects')
    expect(entries('Project')).toEqual(['Orchestration', 'Scheduler'])
  })

  test('the ✕ and Escape close it', () => {
    show('')
    fireEvent.click(screen.getAllByRole('button', { name: 'Close settings' }).at(-1)!)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('on a phone the list is the whole dialog until an entry is picked, and an entry has a way back to it', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    show('')
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.queryByRole('navigation', { name: 'Settings' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Onboarding on the Overview' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All settings' }))
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeTruthy()
  })

  test('entries are ordered by their order, 50 when unsaid, then by package name', () => {
    const a = { package: 'b-pkg', order: 10 }
    const b = { package: 'a-pkg' }
    const c = { package: 'c-pkg' }
    const d = { package: 'z-pkg', order: 60 }
    expect([d, c, b, a].sort(byMountOrder)).toEqual([a, b, c, d])
  })
})
