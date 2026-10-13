import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { refreshPreferences } from '../lib/preferences.js'
import { ModulesContext, byMountOrder, type MountedModules } from '../lib/use-modules.js'
import { checked, choices, closeList, offered, openList, pick, showing } from '../test-controls.js'

// The reads this page makes, answered as an empty machine: no saved machines, no editors detected, no
// stored preferences. The rest of the module is kept, since the onboarding checklist inside the
// page reads far more than the settings rows do.
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
const onProjects = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []))
vi.mock('../rpc/projects.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../rpc/projects.js')>()),
  onProjects,
}))
vi.mock('../rpc/reads.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../rpc/reads.js')>()),
  onBridgeToken: vi.fn(async () => null),
  onBridgeBrowser: vi.fn(async () => ({ state: 'off' as const })),
  onPreferences: vi.fn(async () => ({})),
  onDetectedEditors: vi.fn(async () => []),
  onDashboard: vi.fn(async () => null),
  onOnboardingSuggestion: vi.fn(async () => null),
}))

import { SettingsPage } from './SettingsPage.js'

afterEach(() => {
  cleanup()
  localStorage.clear()
  prefsSaved.mockClear()
  vi.unstubAllGlobals()
})

/** A row picked from a list, by its label: the button that shows its pick and opens its list. */
const select = (label: string) => screen.getByRole('combobox', { name: label })
/** What the page saved, in order: the keys of each pick. */
const saves = () => prefsSaved.mock.calls.map(([patch]) => patch)

describe('SettingsPage dropdowns (#1172)', () => {
  test('no dropdown renders with nothing in it', async () => {
    // The reported paper cut was an empty dropdown at the bottom of this page: a control you can
    // open and not use, which reads as broken rather than as "no choices here". The control itself
    // did not survive the deletions on this branch, so this asserts the property rather than
    // hunting the instance — the next dynamic option list is the one that would bring it back.
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    const selects = screen.getAllByRole('combobox')
    // The page really did render its controls: each row picked from a list, by its name.
    expect(selects.map(select => select.getAttribute('aria-label'))).toEqual(['Theme', 'Editor', 'Agent', 'Model'])
    for (const select of selects) {
      expect((await choices(select)).length).toBeGreaterThan(0)
      // And none shows an empty button: the pick is said in words before the list is opened.
      expect(showing(select)).not.toBe('')
    }
  })

  test('an editor list the daemon could not fill still leaves a usable Editor row', async () => {
    // Its options are the one list on the page assembled at run time. Auto-detect is a real
    // choice rather than a placeholder, so the row stays operable with nothing detected.
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    expect(await choices(select('Editor'))).toEqual(['Auto-detect'])
    // It is the pick, though its value is no text.
    expect(showing(select('Editor'))).toBe('Auto-detect')
  })

  test('picking a theme saves it, and the row shows it', async () => {
    prefsRead.mockResolvedValueOnce({})
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    await waitFor(() => expect(showing(select('Theme'))).toBe('System'))
    expect(await choices(select('Theme'))).toEqual(['System', 'Light', 'Dark'])
    await pick(select('Theme'), 'Dark')
    expect(saves()).toEqual([{ theme: 'dark' }])
    expect(showing(select('Theme'))).toBe('Dark')
  })
})

describe('SettingsPage Agent and Model', () => {
  test("the Model row offers the agent's own list, the start menu's, after the agent's own default", async () => {
    prefsRead.mockResolvedValueOnce({})
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
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
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
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
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
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
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    await waitFor(() => expect(showing(select('Model'))).toBe('Opus 5.5'))
    expect(await choices(select('Agent'))).toEqual(['Claude Code', 'Codex'])
    await pick(select('Agent'), 'Codex')
    expect(saves()).toEqual([{ driver: 'codex', model: '' }])
    expect(showing(select('Agent'))).toBe('Codex')
    expect(showing(select('Model'))).toBe("the CLI's own default")
  })
})

describe('SettingsPage on and off rows', () => {
  const row = (label: string) => screen.getByRole('switch', { name: label })

  test('each is a switch that shows what is saved, and switching it saves that one setting at once', async () => {
    prefsRead.mockResolvedValueOnce({ postMergeCleanup: true, notifyNewActivity: false })
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    await waitFor(() => expect(checked(row('Post-merge cleanup'))).toBe(true))
    // No box to tick anywhere among the page's own rows: on and off is a switch.
    expect(screen.getAllByRole('switch').map(each => [each.getAttribute('aria-label'), checked(each)])).toEqual([
      ['Post-merge cleanup', true],
      ['Browser', true],
      ['Human Queue', true],
      ['New activity', false],
      ['Browser bridge', false],
    ])
    fireEvent.click(row('Post-merge cleanup'))
    expect(checked(row('Post-merge cleanup'))).toBe(false)
    fireEvent.click(row('New activity'))
    expect(checked(row('New activity'))).toBe(true)
    fireEvent.click(row('Human Queue'))
    fireEvent.click(row('Browser'))
    expect(saves()).toEqual([{ postMergeCleanup: false }, { notifyNewActivity: true }, { notifyHumanIntervention: false }, { notifyBrowser: false }])
    expect([checked(row('Human Queue')), checked(row('Browser'))]).toEqual([false, false])
  })

  test('notifications the browser blocked: the Browser row says so, reads off, and cannot be switched', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    prefsRead.mockResolvedValueOnce({ notifyBrowser: true })
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
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

describe('SettingsPage Claude web (#1332)', () => {
  test('with the bridge on, which browser does the work is one choice, and each option carries its own setup', async () => {
    // "Browser bridge" and "Bridge browser" as two toggles read as anagrams of each other; the
    // real decision is which browser drives claude.ai, so it is presented as exactly that.
    prefsRead.mockResolvedValueOnce({ bridge: true, bridgeBrowser: true })
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
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
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
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
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
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

describe('Settings sections a module brings (#1902)', () => {
  const mounted = (settings: MountedModules['settings']): MountedModules => ({ pages: [], cards: [], linkActions: [], panels: [], runSlots: [], settings, loaded: true })

  test('each is drawn after the page\'s own sections, in the order mounted, given only the projects that have its package; one that throws breaks only itself', async () => {
    onProjects.mockResolvedValue([
      { id: 'p1', name: 'gemstack', path: '/p1' },
      { id: 'p2', name: 'other', path: '/p2' },
    ])
    const seen: string[][] = []
    const Subagents = ({ projects }: { projects: { id: string; name: string }[] }) => {
      seen.push(projects.map(p => p.name))
      return <section aria-label="Subagents section">Subagents</section>
    }
    const Broken = () => {
      throw new Error('boom')
    }
    render(
      <ModulesContext.Provider
        value={mounted([
          { id: 'subagents', Section: Subagents, package: '@openagt/skill-orchestration', projects: ['p1', 'gone'] },
          { id: 'broken', Section: Broken, package: '@openagt/skill-broken', projects: ['p2'] },
        ])}
      >
        <SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />
      </ModulesContext.Provider>,
    )
    const section = await screen.findByLabelText('Subagents section')
    await waitFor(() => expect(seen.at(-1)).toEqual(['gemstack']))
    expect(screen.getByText('The broken settings failed: boom')).toBeTruthy()
    // After the page's last own section.
    const own = screen.getByText('Claude web')
    expect(own.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('sections are ordered by their order, 50 when unsaid, then by package name', () => {
    const a = { package: 'b-pkg', order: 10 }
    const b = { package: 'a-pkg' }
    const c = { package: 'c-pkg' }
    const d = { package: 'z-pkg', order: 60 }
    expect([d, c, b, a].sort(byMountOrder)).toEqual([a, b, c, d])
  })
})
