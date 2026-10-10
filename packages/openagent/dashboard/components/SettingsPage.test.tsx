import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { refreshPreferences } from '../lib/preferences.js'
import { ModulesContext, byMountOrder, type MountedModules } from '../lib/use-modules.js'

// The reads this page makes, answered as an empty machine: no saved machines, no editors detected, no
// stored preferences. The rest of the module is kept, since the onboarding checklist inside the
// page reads far more than the settings rows do.
const prefsRead = vi.hoisted(() => vi.fn(async (): Promise<Record<string, unknown>> => ({})))
vi.mock('../rpc/preferences.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../rpc/preferences.js')>()),
  onPreferences: prefsRead,
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
})

describe('SettingsPage dropdowns (#1172)', () => {
  test('no dropdown renders with nothing in it', () => {
    // The reported paper cut was an empty dropdown at the bottom of this page: a control you can
    // open and not use, which reads as broken rather than as "no choices here". The control itself
    // did not survive the deletions on this branch, so this asserts the property rather than
    // hunting the instance — the next dynamic option list is the one that would bring it back.
    const { container } = render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    const selects = [...container.querySelectorAll('select')]
    expect(selects.length).toBeGreaterThan(0) // the page really did render its controls
    for (const select of selects) {
      expect(select.querySelectorAll('option').length).toBeGreaterThan(0)
    }
  })

  test('an editor list the daemon could not fill still leaves a usable Editor row', () => {
    // Its options are the one list on the page assembled at run time. Auto-detect is a real
    // choice rather than a placeholder, so the row stays operable with nothing detected.
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    const editor = screen.getByLabelText('Editor') as HTMLSelectElement
    expect([...editor.querySelectorAll('option')].map(o => o.textContent)).toEqual(['Auto-detect'])
  })
})

describe('SettingsPage Agent and Model', () => {
  const options = (label: string) =>
    [...(screen.getByLabelText(label) as HTMLSelectElement).querySelectorAll('option')].map(o => [o.value, o.textContent, o.disabled])

  test("the Model row offers the agent's own list, the start menu's, after the agent's own default", async () => {
    prefsRead.mockResolvedValueOnce({})
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    await screen.findByText('Opus 5.5')
    expect(options('Model')).toEqual([
      ['', "the CLI's own default", false],
      ['opus', 'Opus 5.5', false],
      ['claude-fable-5-1', 'Fable 5.1', false],
    ])
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('')
  })

  test('a saved model the agent does not list is kept, by its id, since a start is still given it', async () => {
    prefsRead.mockResolvedValueOnce({ model: 'fable' })
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    await screen.findByText('Opus 5.5')
    await waitFor(() => expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('fable'))
    expect(options('Model').at(-1)).toEqual(['fable', 'fable', false])
  })

  test('an agent that could not list its models says why, in a line that cannot be picked', async () => {
    prefsRead.mockResolvedValueOnce({ driver: 'codex' })
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    await waitFor(() => expect(options('Model')).toEqual([
      ['', "the CLI's own default", false],
      ['not logged in', 'not logged in', true],
    ]))
  })

  test("picking another agent leaves the model unpinned: a model is one agent's own", async () => {
    prefsRead.mockResolvedValueOnce({ model: 'opus' })
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    await waitFor(() => expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('opus'))
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'codex' } })
    expect((screen.getByLabelText('Agent') as HTMLSelectElement).value).toBe('codex')
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('')
  })
})

describe('SettingsPage Claude web (#1332)', () => {
  test('with the bridge on, which browser does the work is one choice, and each option carries its own setup', async () => {
    // "Browser bridge" and "Bridge browser" as two toggles read as anagrams of each other; the
    // real decision is which browser drives claude.ai, so it is presented as exactly that.
    prefsRead.mockResolvedValueOnce({ bridge: true, bridgeBrowser: true })
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    const daemon = (await screen.findByLabelText(/A browser the daemon runs/)) as HTMLInputElement
    const own = screen.getByLabelText('Your own Chrome') as HTMLInputElement
    expect(daemon.type).toBe('radio')
    expect(daemon.checked).toBe(true)
    expect(own.checked).toBe(false)
    // The daemon's browser carries its status; the token to paste belongs to the other option only.
    await waitFor(() => expect(screen.getByText(/The bridge browser is off/)).toBeTruthy())
    expect(screen.queryByText(/paste this token/)).toBeNull()
  })

  test('with the bridge off there is no browser to choose', async () => {
    prefsRead.mockResolvedValueOnce({ bridge: false })
    refreshPreferences()
    render(<SettingsPage onAgentStarted={() => {}} onSelectProject={() => {}} />)
    await screen.findByLabelText('Browser bridge')
    expect(screen.queryByText(/Which browser does the work/)).toBeNull()
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
