import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { refreshPreferences } from '../lib/preferences.js'
import { forgetRemembered } from '../lib/use-async.js'

import { ModulesContext, byMountOrder, mountedOf, type MountedModules, type MountedView } from '../lib/use-modules.js'
import { CalendarClock, Database, FolderGit2, Globe, Puzzle, Ticket, UserRound } from 'lucide-react'
import { checked, choices, pick, showing } from '../test-controls.js'

// The reads Settings makes, answered as an empty computer: no editors detected, no stored
// preferences.
const prefsRead = vi.hoisted(() => vi.fn(async (): Promise<Record<string, unknown>> => ({})))
// What the page saves, one call per pick with the keys it changed. Answered as a daemon that could
// not store it: the page then keeps showing the pick it was given, which is what the tests read.
const prefsSaved = vi.hoisted(() => vi.fn(async (_patch: Record<string, unknown>) => ({ ok: false as const, error: 'failed to save preferences' })))
vi.mock('../rpc/preferences.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../rpc/preferences.js')>()),
  onPreferences: prefsRead,
  patchPreferences: prefsSaved,
}))

// Its own suite reads the accounts; here the entry is its name.
vi.mock('./RepoSourcesSettings.js', () => ({ REPO_SOURCES_ENTRY: 'repos', RepoSourcesSettings: () => <p>Where repos are found</p> }))
vi.mock('../rpc/reads.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../rpc/reads.js')>()),
  onPreferences: vi.fn(async () => ({})),
  onDetectedEditors: vi.fn(async () => []),
  onDashboard: vi.fn(async () => null),
}))

import { SettingsDialog } from './SettingsDialog.js'

import type { ProjectSummary } from '../../src/index.js'

const onClose = vi.fn()

/** Settings as the shell holds it: the entry shown is the address's, and picking one changes it. */
function Shown({ start, item, scope, projects }: { start: string; item?: string; scope: string | null; projects: ProjectSummary[] }) {
  const [entry, setEntry] = useState(start)
  return <SettingsDialog entry={entry} openItem={item} onEntry={setEntry} onClose={onClose} scope={scope} projects={projects} />
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
    await usable(['Project', 'Font', 'Code font', 'File preview font', 'Editor'])
  })

  test('an editor list the daemon could not fill still leaves a usable Editor row', async () => {
    // Its options are the one list on the page assembled at run time. Auto-detect is a real
    // choice rather than a placeholder, so the row stays operable with nothing detected.
    open('appearance')
    expect(await choices(select('Editor'))).toEqual(['Auto-detect'])
    // It is the pick, though its value is no text.
    expect(showing(select('Editor'))).toBe('Auto-detect')
  })

})

describe('Settings › Appearance, its pictures and swatches', () => {
  const picked = (group: string) => within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio').filter(checked).map(radio => radio.textContent || radio.getAttribute('aria-label'))

  test('picking a theme saves it, and its picture shows picked', async () => {
    prefsRead.mockResolvedValueOnce({})
    refreshPreferences()
    open('appearance')
    await waitFor(() => expect(picked('Theme')).toEqual(['System']))
    expect(within(screen.getByRole('radiogroup', { name: 'Theme' })).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['System', 'Light', 'Dark'])
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(saves()).toEqual([{ theme: 'dark' }])
    await waitFor(() => expect(picked('Theme')).toEqual(['Dark']))
  })

  test("the colours' swatches are the palette's own, the default first, and a switch of colours starts on the new one's default", async () => {
    prefsRead.mockResolvedValueOnce({ accent: 'green' })
    refreshPreferences()
    open('appearance')
    await waitFor(() => expect(picked('Primary colour')).toEqual(['Green']))
    expect(within(screen.getByRole('radiogroup', { name: 'Primary colour' })).getAllByRole('radio').map(radio => radio.getAttribute('aria-label'))).toEqual(['Blue', 'Green', 'Aqua', 'Yellow', 'Orange', 'Red', 'Purple'])
    fireEvent.click(screen.getByRole('radio', { name: 'Aqua' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Neutral' }))
    expect(saves()).toEqual([{ accent: 'aqua' }, { palette: 'neutral', accent: '' }])
    await waitFor(() => expect(picked('Primary colour')).toEqual(['The colours’ own']))
  })
})

describe('Settings on and off rows', () => {
  const row = (label: string) => screen.getByRole('switch', { name: label })

  test('each is a switch that shows what is saved, and switching it saves that one setting at once', async () => {
    prefsRead.mockResolvedValueOnce({ showThinking: true })
    refreshPreferences()
    open('appearance')
    await waitFor(() => expect(checked(row('Show what the coding agent thought'))).toBe(true))
    // No box to tick anywhere among Settings' own rows: on and off is a switch.
    const switches = () => screen.getAllByRole('switch').map(each => [each.getAttribute('aria-label'), checked(each)])
    expect(switches()).toEqual([
      ['Show what the coding agent thought', true],
      ['Discover OpenAgent on the Overview', true],
    ])
    fireEvent.click(row('Show what the coding agent thought'))
    expect(checked(row('Show what the coding agent thought'))).toBe(false)
    expect(saves()).toEqual([{ showThinking: false }])
  })

  test("a click on a switch's name switches it, as a click on the switch does", async () => {
    prefsRead.mockResolvedValueOnce({ showThinking: false })
    refreshPreferences()
    open('appearance')
    await waitFor(() => expect(checked(row('Show what the coding agent thought'))).toBe(false))
    fireEvent.click(screen.getByText('Show what the coding agent thought'))
    expect(checked(row('Show what the coding agent thought'))).toBe(true)
    expect(saves()).toEqual([{ showThinking: true }])
  })
})

describe('Settings › Appearance', () => {
  test("the Overview's Discover OpenAgent steps show again from here, once its ✕ hid it", async () => {
    prefsRead.mockResolvedValueOnce({ onboardingDismissed: true })
    refreshPreferences()
    open('appearance')
    const onboarding = screen.getByRole('switch', { name: 'Discover OpenAgent on the Overview' })
    await waitFor(() => expect(checked(onboarding)).toBe(false))
    fireEvent.click(onboarding)
    expect(saves()).toEqual([{ onboardingDismissed: false }])
    expect(checked(onboarding)).toBe(true)
  })
})

describe('the Settings list', () => {
  const mounted = (sections: MountedView<'settings.section'>[]): MountedModules => mountedOf({ views: { 'settings.section': sections } })
  const PROJECTS = [
    { id: 'p1', name: 'gemstack' },
    { id: 'p2', name: 'other' },
    { id: 'p3', name: 'plain' },
  ]
  /** A package's settings that says which projects it was given. */
  const Given = ({ projects }: { projects: { name: string }[] }) => <p>{`for: ${projects.map(p => p.name).join(', ') || 'no project'}`}</p>
  const Broken = () => {
    throw new Error('boom')
  }
  /** A package's entry with a tick per project it was given. */
  const Ticks = ({ projects }: { projects: { name: string }[] }) => {
    const [ticked, setTicked] = useState<string[]>([])
    return (
      <>
        {projects.map(p => (
          <button key={p.name} type="button" role="checkbox" aria-label={`tick of ${p.name}`} aria-checked={ticked.includes(p.name)} onClick={() => setTicked(was => (was.includes(p.name) ? was.filter(one => one !== p.name) : [...was, p.name]))} />
        ))}
      </>
    )
  }
  const PROFILE: MountedView<'settings.section'> = { place: 'settings.section', id: 'profile', title: 'Profile', icon: UserRound, order: 10, View: () => <p>Your name and picture</p>, package: '@openagt/user-info', projects: [], computer: true }
  const MODULES = mounted([
    PROFILE,
    { place: 'settings.section', id: 'claude-web', title: 'Claude web', icon: Globe, order: 90, View: Given, package: '@openagt/host-claude-web', projects: [], computer: true },
    { place: 'settings.section', id: 'agent-data', title: 'Your agent data', icon: FolderGit2, order: 50, View: () => <p>Where the agent data is</p>, package: '@openagt/store-git-repository', projects: [], computer: true },
    {
      place: 'settings.section',
      id: 'project-agent-data',
      title: 'Project agent data',
      icon: Database,
      order: 50,
      pickProject: 'Each project keeps its agent data in one place, your folder or its own repository. Pick a project.',
      View: ({ projects }) => <p>{`Where ${projects.map(p => p.name).join(', ')}’s agent data is`}</p>,
      package: '@openagt/store-git-branch',
      projects: ['p1', 'p2', 'p3'],
    },
    { place: 'settings.section', id: 'tickets', title: 'Tickets', icon: Ticket, View: Given, package: '@openagt/tickets', projects: ['p1', 'p2', 'gone'] },
    { place: 'settings.section', id: 'scheduler', title: 'Scheduler', icon: CalendarClock, View: Broken, package: '@openagt/scheduled-agents', projects: ['p2'] },
    { place: 'settings.section', id: 'skills', title: 'Skills', icon: Puzzle, order: 10, View: Ticks, package: '@openagt/skills', projects: ['p1', 'p2', 'p3'] },
    { place: 'settings.section', id: 'list', title: 'List', icon: Puzzle, order: 60, readOnly: true, View: Given, package: '@openagt/list', projects: ['p1', 'p2'] },
  ])
  const show = (entry: string, scope: string | null = null, item?: string) =>
    render(
      <ModulesContext.Provider value={MODULES}>
        <Shown start={entry} {...(item !== undefined ? { item } : {})} scope={scope} projects={PROJECTS as ProjectSummary[]} />
      </ModulesContext.Provider>,
    )
  const entries = (group: string) => within(screen.getByRole('region', { name: group })).getAllByRole('button').map(b => b.textContent)
  const title = () => screen.getByRole('dialog').querySelector('h2')!.textContent

  test("two groups: yours and this computer's, the computer's packages among them; then the picked project's packages", () => {
    show('', 'p1')
    expect(entries('You and this computer')).toEqual(['Profile', 'Appearance', 'Plugins', 'Your agent data', 'Keyboard shortcuts', 'Claude web'])
    // gemstack has tickets and no scheduler; every project has its skills, whose entry says it goes first, and its plugins.
    expect(entries('Project')).toEqual(['Skills', 'Plugins', 'Project agent data', 'Tickets', 'List'])
    expect(showing(select('Project'))).toBe('gemstack')
    // Opened on nothing in particular: the first entry.
    expect(title()).toBe('SettingsProfile')
    expect(screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-current')).toBe('page')
  })

  test("a package's entry of the picked project is given that project alone, and the computer's none", () => {
    show('tickets', 'p1')
    expect(title()).toBe('SettingsgemstackTickets')
    expect(screen.getByText('for: gemstack')).toBeTruthy()
    expect(screen.queryByText(/^Saved to/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Claude web' }))
    expect(title()).toBe('SettingsClaude web')
    expect(screen.getByText('for: no project')).toBeTruthy()
  })

  test('the project select changes the project group, and All projects gives an entry every project that has its package, saying which', async () => {
    show('tickets', 'p1')
    await pick(select('Project'), 'All projects')
    expect(entries('Project')).toEqual(['Skills', 'Plugins', 'Project agent data', 'Tickets', 'Scheduler', 'List'])
    expect(title()).toBe('SettingsAll projectsTickets')
    expect(screen.getByText('for: gemstack, other')).toBeTruthy()
    expect(screen.getByText('Saved to 2 projects: gemstack, other.')).toBeTruthy()
    // An entry that only shows what is saves nothing anywhere: no line says it does.
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByText('for: gemstack, other')).toBeTruthy()
    expect(screen.queryByText(/^Saved to/)).toBeNull()
    // One that throws breaks only itself.
    fireEvent.click(screen.getByRole('button', { name: 'Scheduler' }))
    expect(screen.getByText('The Scheduler settings failed: boom')).toBeTruthy()
    expect(screen.getByText('Saved to one project: other.')).toBeTruthy()
    await pick(select('Project'), 'plain')
    expect(entries('Project')).toEqual(['Skills', 'Plugins', 'Project agent data'])
    // The entry it was on is not plain's: the first entry shows.
    expect(title()).toBe('SettingsProfile')
  })

  test('with no project picked in the sidebar, the project group opens on every project', () => {
    show('')
    expect(showing(select('Project'))).toBe('All projects')
    expect(entries('Project')).toEqual(['Skills', 'Plugins', 'Project agent data', 'Tickets', 'Scheduler', 'List'])
  })

  test("a project's entry opened for a project (Skills, from the box's menu) is that project's, whatever the sidebar has picked; the select changes it", async () => {
    show('skills', null, 'p2')
    expect(showing(select('Project'))).toBe('other')
    expect(title()).toBe('SettingsotherSkills')
    expect(screen.getByRole('button', { name: 'Skills' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('checkbox', { name: 'tick of other' })).toBeTruthy()
    await pick(select('Project'), 'gemstack')
    expect(await screen.findByRole('checkbox', { name: 'tick of gemstack' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'tick of other' })).toBeNull()
    expect(title()).toBe('SettingsgemstackSkills')
  })

  test("a project's entry with no project given follows the sidebar's pick", async () => {
    show('skills', 'p3')
    expect(showing(select('Project'))).toBe('plain')
    expect(await screen.findByRole('checkbox', { name: 'tick of plain' })).toBeTruthy()
  })

  test("the project's agent data with every project picked reads none: it asks for one, and a press opens that one", async () => {
    show('project-agent-data')
    expect(title()).toBe('SettingsAll projectsProject agent data')
    expect(screen.getByText(/your folder or its own repository\. Pick a project\./)).toBeTruthy()
    expect(screen.queryByText(/’s agent data is/)).toBeNull()
    // No line says it saves to several.
    expect(screen.queryByText(/^Saved to/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'other' }))
    expect(await screen.findByText('Where other’s agent data is')).toBeTruthy()
    expect(showing(select('Project'))).toBe('other')
    expect(title()).toBe('SettingsotherProject agent data')
  })

  test('with no project at all the Project group has nothing', () => {
    open()
    expect(screen.queryByRole('button', { name: 'Project agent data' })).toBeNull()
    expect(screen.getByText('Nothing to set for your projects.')).toBeTruthy()
  })

  test("a package's entry of the computer's goes among the dashboard's own by its number: 50 when unsaid, after the dashboard's own at 50", () => {
    const { order: _unsaid, ...unordered } = PROFILE
    render(
      <ModulesContext.Provider value={mounted([PROFILE, { ...PROFILE, id: 'lights', title: 'Lights', order: 55, package: 'lights' }, { ...unordered, id: 'plain', title: 'Plain', package: 'plain' }])}>
        <SettingsDialog entry="profile" onEntry={() => {}} onClose={onClose} scope={null} projects={[]} />
      </ModulesContext.Provider>,
    )
    expect(entries('You and this computer')).toEqual(['Profile', 'Appearance', 'Plugins', 'Plain', 'Lights', 'Keyboard shortcuts'])
  })

  test('opened with no entry, a computer shows the first and its address says so; a phone shows the list, whose address is none', () => {
    const onEntry = vi.fn()
    const { unmount } = render(<SettingsDialog entry="" onEntry={onEntry} onClose={onClose} scope={null} projects={[]} />)
    expect(onEntry).toHaveBeenCalledWith('appearance')
    unmount()
    onEntry.mockClear()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    render(<SettingsDialog entry="" onEntry={onEntry} onClose={onClose} scope={null} projects={[]} />)
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeTruthy()
    expect(onEntry).not.toHaveBeenCalled()
  })

  test('the ✕ and Escape close it', () => {
    show('')
    fireEvent.click(screen.getAllByRole('button', { name: 'Close settings' }).at(-1)!)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('opened by its address and closed, the focus goes to the page\u2019s title, not to the page\u2019s body', async () => {
    const Page = () => {
      const [shown, setShown] = useState(true)
      return (
        <>
          <h1>Agents</h1>
          {shown && <SettingsDialog entry="" onEntry={() => {}} onClose={() => setShown(false)} scope={null} projects={[]} />}
        </>
      )
    }
    render(<Page />)
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Agents' })))
  })

  test('on a phone the list is the whole dialog until an entry is picked, and an entry has a way back to it', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    show('')
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.queryByRole('navigation', { name: 'Settings' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Discover OpenAgent on the Overview' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'All settings' }))
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeTruthy()
  })

  test('on a phone a press on the list\'s first entry opens it', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    show('')
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(screen.queryByRole('navigation', { name: 'Settings' })).toBeNull()
    expect(screen.getByText('Your name and picture')).toBeTruthy()
  })

  test('entries are ordered by their order, 50 when unsaid, then by package name', () => {
    const a = { package: 'b-pkg', order: 10 }
    const b = { package: 'a-pkg' }
    const c = { package: 'c-pkg' }
    const d = { package: 'z-pkg', order: 60 }
    expect([d, c, b, a].sort(byMountOrder)).toEqual([a, b, c, d])
  })
})
