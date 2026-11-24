import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement, useContext, useRef, useState } from 'react'
import { openMenu, phoneScreen } from './test-utils.js'
import { WaitingList, defineUiModule, useModuleHost, useOpenAgentDown, useWaiting, type UiCardProps, type UiPageProps, type UiView } from './module/index.js'
import { forgetRemembered } from './lib/use-async.js'
import { holdEntry } from './lib/use-route.js'
import { HostServicesContext } from './lib/host-services.js'

// The whole transport, stubbed at its one seam: every RPC stub is `rpc(name)`, so a map by name
// answers every read the shell makes, and the live feed never emits.
const answers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const calls = vi.hoisted(() => [] as { name: string; args: unknown[] }[])
vi.mock('./lib/rpc.js', () => ({
  rpc: (name: string) => async (...args: unknown[]) => {
    calls.push({ name, args })
    const answer = answers.get(name)
    return answer ? answer(...args) : null
  },
  openEvents: () => new Promise(() => {}),
}))

// Settings and a project's launcher read a dozen things of their own; these tests are about the
// shell around them, so each is a line naming itself.
vi.mock('./components/SettingsDialog.js', async () => {
  const { DaemonDown } = await import('./lib/use-daemon-health.js')
  return {
    SettingsDialog: ({ entry, scope, onEntry, onClose }: { entry: string; scope: string | null; onEntry: (id: string) => void; onClose: () => void }) => {
      // A change held as an entry holds one, and the question it asks before a step leaves it.
      const [asked, setAsked] = useState<(() => void) | undefined>()
      const release = useRef<() => void>(() => {})
      const host = useContext(HostServicesContext)
      return createElement(
        'div',
        null,
        createElement('p', null, `the settings dialog on '${entry}'`),
        createElement('p', null, `its project: ${scope ?? 'every project'}`),
        createElement('p', null, `its saves: ${useContext(DaemonDown) ? 'off' : 'on'}`),
        createElement('button', { onClick: () => onEntry('agent') }, 'to Agent'),
        createElement('button', { onClick: onClose }, 'shut the dialog'),
        createElement('button', { onClick: () => host?.openSettings('agent') }, 'a link to Agent'),
        createElement('button', { onClick: () => (release.current = holdEntry(step => setAsked(() => step))) }, 'hold a change'),
        asked &&
          createElement(
            'div',
            { role: 'alertdialog', 'aria-label': 'Leave without saving?' },
            createElement('button', { onClick: () => setAsked(undefined) }, 'Cancel'),
            createElement('button', { onClick: () => (release.current(), setAsked(undefined), asked()) }, 'Leave'),
          ),
      )
    },
  }
})
vi.mock('./components/ProjectHome.js', async importOriginal => ({
  ProjectHomeShape: (await importOriginal<typeof import('./components/ProjectHome.js')>()).ProjectHomeShape,
  ProjectHome: ({ projectName, onProjectRemoved }: { projectName?: string; onProjectRemoved?: () => void }) =>
    createElement('p', null, `the launcher of ${projectName}`, createElement('button', { onClick: onProjectRemoved }, 'remove the project')),
}))
// The Overview's box, stood in for: it says the project it starts in, and has a press that picks the project `app`, one that picks none, and one that starts.
vi.mock('./components/StartAgentForm.js', () => ({
  StartAgentForm: ({ projectId, projectName, onPickProject, onAgentStarted }: { projectId: string; projectName?: string | null; onPickProject: (id: string) => void; onAgentStarted?: (intent: string, agentId: string) => void }) =>
    createElement(
      'p',
      null,
      `the box of ${projectName ?? projectId}`,
      createElement('button', { onClick: () => onPickProject('app') }, 'pick app in the box'),
      createElement('button', { onClick: () => onPickProject('session') }, 'pick no project in the box'),
      createElement('button', { onClick: () => onAgentStarted?.('from the box', '9-box') }, 'start from the box'),
    ),
}))
vi.mock('./components/ProjectActions.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./components/ProjectActions.js')>()),
  ProjectMenu: ({ onProjectRemoved }: { onProjectRemoved?: () => void }) => (onProjectRemoved ? createElement('button', { onClick: onProjectRemoved }, 'remove the project from its menu') : null),
}))

// A session's page, as itself unless a test stands in for it: the stand-in gets what the shell hands the page.
const agentView = vi.hoisted(() => ({ standIn: null as null | ((props: Record<string, unknown>) => unknown) }))
vi.mock('./components/AgentView.js', async importOriginal => {
  const real = await importOriginal<typeof import('./components/AgentView.js')>()
  return { ...real, AgentView: (props: Parameters<typeof real.AgentView>[0]) => (agentView.standIn ? agentView.standIn(props as Record<string, unknown>) : createElement(real.AgentView, props)) }
})

const { App } = await import('./App.js')
const { Dialog } = await import('./components/ui/dialog.js')

const PROJECT = { id: 'app-abc', path: '/work/app', name: 'app', activated: true }

/** A module's browser part the loader imports like a real one: a data URL whose default export is a definition that fills `views`. */
function moduleModule(key: string, ...views: UiView[]): string {
  ;(globalThis as Record<string, unknown>)[key] = defineUiModule({ name: key, hooks: { 'ui.view': views } })
  return `data:text/javascript,export default globalThis[${JSON.stringify(key)}]`
}

/** A module's card of what needs the person, as ui-card-waiting's: the shell's one read of it, in the shell's rows. */
function WaitingCard() {
  const { items } = useWaiting()
  return createElement(WaitingList, { items, onOpenAgent: useModuleHost().openAgent })
}

function answerShell(modules: unknown[]): void {
  answers.clear()
  answers.set('onProjects', () => [PROJECT])
  answers.set('onModules', () => modules)
  answers.set('onWaiting', () => ({ items: [], whole: [] }))
  answers.set('onRecentAgents', () => [])
  answers.set('onAgents', () => [])
  answers.set('onOverview', () => ({ active: [] }))
  answers.set('onProfilesList', () => ({ profiles: [], plugins: [] }))
  answers.set('onSkillChoices', () => ({ core: [], plugins: [] }))
  // The coding agents as each says itself, and whether a run is named as it starts.
  answers.set('onCodingAgents', () => [])
  answers.set('onNamesRuns', () => true)
  // A project's Overview reads its files, for its box's `#`.
  answers.set('onProjectFiles', () => [])
  // The Overview draws its cards once the person's layout is read.
  answers.set('onPreferences', () => ({}))
}

afterEach(() => {
  cleanup()
  agentView.standIn = null
  window.history.replaceState(null, '', '/')
  calls.length = 0
})

describe('the queue of what needs you', () => {
  test('a change of the runs reads it again at once, as it does the sidebar', async () => {
    const streams: { onmessage: ((message: { data: string }) => void) | null }[] = []
    vi.stubGlobal(
      'EventSource',
      class {
        onopen = null
        onerror = null
        onmessage: ((message: { data: string }) => void) | null = null
        constructor() {
          streams.push(this)
        }
        close(): void {}
      },
    )
    try {
      answerShell([])
      window.history.replaceState(null, '', '/app/overview')
      render(<App />)
      const reads = () => calls.filter(call => call.name === 'onWaiting').length
      await waitFor(() => expect(reads()).toBeGreaterThan(0))
      await waitFor(() => expect(streams.length).toBe(1))
      const before = reads()
      act(() => streams[0]!.onmessage?.({ data: JSON.stringify({ kind: 'runs', projectId: PROJECT.id }) }))
      // Well inside the five seconds the queue is polled at.
      await waitFor(() => expect(reads()).toBeGreaterThan(before), { timeout: 1000 })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('module pages in the shell (#1774)', () => {
  test("a module opens the dashboard's own pages in the project the address picks, every project where none is, and the page it is on adds no entry", async () => {
    function Opens() {
      const host = useModuleHost()
      return createElement('div', null, createElement('button', { onClick: () => host.openPage('permissions') }, 'open Permissions'), createElement('button', { onClick: () => host.openPage('profiles') }, 'open Profiles'))
    }
    answerShell([{ package: '@acme/overlay', url: moduleModule('__overlayOpensPages', { place: 'app.overlay', id: 'overlay', View: Opens }), projects: [], computer: true }])
    window.history.replaceState(null, '', '/app/overview')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'open Permissions' }))
    expect(window.location.pathname).toBe('/app/permissions')
    const entries = window.history.length
    fireEvent.click(screen.getByRole('button', { name: 'open Permissions' }))
    expect(window.history.length).toBe(entries)
    fireEvent.click(screen.getByRole('button', { name: 'open Profiles' }))
    expect(window.location.pathname).toBe('/app/profiles')
    cleanup()
    window.history.replaceState(null, '', '/')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'open Profiles' }))
    expect(window.location.pathname).toBe('/profiles')
  })

  test('a module opens a Settings entry over the page it is on, its own query kept, as a step Back undoes; from inside Settings, in place', async () => {
    function Opens() {
      const host = useModuleHost()
      return createElement('button', { onClick: () => host.openSettings('profile', 'name') }, 'open Profile')
    }
    answerShell([{ package: '@acme/profile', url: moduleModule('__opensSettings', { place: 'app.overlay', id: 'overlay', View: Opens }), projects: [], computer: true }])
    window.history.replaceState(null, '', '/?view=wide')
    render(<App />)
    const entries = window.history.length
    fireEvent.click(await screen.findByRole('button', { name: 'open Profile' }))
    expect([window.location.pathname + window.location.search, window.history.length]).toEqual(['/?view=wide&settings=profile&item=name', entries + 1])
    fireEvent.click(await screen.findByRole('button', { name: 'to Agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'open Profile' }))
    expect([window.location.pathname + window.location.search, window.history.length]).toEqual(['/?view=wide&settings=profile&item=name', entries + 1])
    fireEvent.click(screen.getByRole('button', { name: 'shut the dialog' }))
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/?view=wide'))
  })

  test("a pick a module's page keeps in its address takes the place of the address it had: the page reads it, and Back steps over it", async () => {
    function ListPage({ path }: UiPageProps) {
      const host = useModuleHost()
      return createElement('button', { onClick: () => host.adjustPage(['failed'], 'sort=new') }, `the list at ${path.join('/') || 'all'}`)
    }
    answerShell([{ package: '@acme/list', url: moduleModule('__listAdjusted', { place: 'app.page', id: 'list', label: 'List', View: ListPage }), projects: [PROJECT.id] }])
    window.history.replaceState(null, '', '/list')
    render(<App />)
    const entries = window.history.length
    fireEvent.click(await screen.findByRole('button', { name: 'the list at all' }))
    expect(screen.getByRole('button', { name: 'the list at failed' })).toBeTruthy()
    expect([window.location.pathname + window.location.search, window.history.length]).toEqual(['/list/failed?sort=new', entries])
  })

  test("a module's page goes back to the list it was opened from as that list was left, by Back; reached another way, it opens the list", async () => {
    function ListPage({ path }: UiPageProps) {
      const host = useModuleHost()
      return path.length === 0
        ? createElement('button', { onClick: () => host.openPage('list', ['a'], PROJECT.id) }, 'open item a')
        : createElement('button', { onClick: () => host.backToPage('list') }, 'back to the list')
    }
    answerShell([{ package: '@acme/list', url: moduleModule('__listModule', { place: 'app.page', id: 'list', label: 'List', View: ListPage }), projects: [PROJECT.id] }])
    window.history.replaceState(null, '', '/list?sort=new')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'open item a' }))
    expect(window.location.pathname).toBe('/app/list/a')
    const entries = window.history.length
    fireEvent.click(await screen.findByRole('button', { name: 'back to the list' }))
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/list?sort=new'))
    expect(window.history.length).toBe(entries)
    cleanup()
    window.history.replaceState(null, '', '/app/list/a')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'back to the list' }))
    expect(window.location.pathname + window.location.search).toBe('/app/list')
  })

  test("a module's page opened beside the item the list opened, and back again, goes back to that list as it was left, by Back as many entries", async () => {
    function ListPage({ path }: UiPageProps) {
      const host = useModuleHost()
      if (path.length === 0) return createElement('button', { onClick: () => host.openPage('list', ['a'], PROJECT.id) }, 'open item a')
      const other = path.length === 1 ? ['a', 'tab'] : ['a']
      return createElement(
        'div',
        null,
        createElement('button', { onClick: () => host.openPage('list', other, PROJECT.id, { beside: true }) }, 'its other tab'),
        createElement('button', { onClick: () => host.backToPage('list') }, 'back to the list'),
      )
    }
    answerShell([{ package: '@acme/list', url: moduleModule('__listBeside', { place: 'app.page', id: 'list', label: 'List', View: ListPage }), projects: [PROJECT.id] }])
    window.history.replaceState(null, '', '/list?sort=new')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'open item a' }))
    fireEvent.click(await screen.findByRole('button', { name: 'its other tab' }))
    expect(window.location.pathname).toBe('/app/list/a/tab')
    fireEvent.click(screen.getByRole('button', { name: 'its other tab' }))
    expect(window.location.pathname).toBe('/app/list/a')
    const entries = window.history.length
    fireEvent.click(screen.getByRole('button', { name: 'back to the list' }))
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/list?sort=new'))
    expect(window.history.length).toBe(entries)
  })

  test("a run a module opens while Settings holds a change asks first: Cancel keeps the change and Settings' address, Leave goes", async () => {
    function OpensRun() {
      const host = useModuleHost()
      return createElement('button', { onClick: () => host.openAgent(PROJECT.id, '3-a') }, 'open a run')
    }
    answerShell([{ package: '@acme/overlay', url: moduleModule('__overlayOpensRun', { place: 'app.overlay', id: 'overlay', View: OpensRun }), projects: [], computer: true }])
    window.history.replaceState(null, '', '/?settings=')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'hold a change' }))
    fireEvent.click(await screen.findByRole('button', { name: 'open a run' }))
    const asked = await screen.findByRole('alertdialog', { name: 'Leave without saving?' })
    expect(window.location.pathname + window.location.search).toBe('/?settings=')
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    expect(window.location.pathname + window.location.search).toBe('/?settings=')
    // Still held: the next move asks again.
    fireEvent.click(screen.getByRole('button', { name: 'open a run' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }))
    expect(window.location.pathname).toBe('/app/3-a')
  })

  test('a module\'s page gets a sidebar row and its own URL, where no project is selected', async () => {
    function LogsPage({ projects }: UiPageProps) {
      return createElement('p', null, `runs of ${projects.map(p => p.name).join(', ')}`)
    }
    answerShell([{ package: '@acme/logs', url: moduleModule('__logsModule', { place: 'app.page', id: 'logs', label: 'Logs', View: LogsPage }), projects: [PROJECT.id] }])
    // A page no module claims: its main pane reads nothing, so the stub needs no answers for it.
    window.history.replaceState(null, '', '/elsewhere')
    render(<App />)

    const row = await screen.findByRole('link', { name: 'Logs' })
    fireEvent.click(row)
    expect(window.location.pathname).toBe('/logs')
    expect(await screen.findByText('runs of app')).toBeTruthy()
    expect(row.getAttribute('aria-current')).toBe('page')
    // The page's segment names no project: nothing reads a project called "logs".
    expect(calls.filter(call => call.args[0] === 'logs' || call.args[0] === 'elsewhere').map(call => call.name)).toEqual([])
  })

  test('a module of this computer\'s draws over every page, with its host; a project\'s package draws nothing there', async () => {
    function Popup() {
      return createElement('p', null, `a popup of ${useModuleHost().package}`)
    }
    answerShell([
      { package: '@acme/overlay', url: moduleModule('__overlayPopup', { place: 'app.overlay', id: 'overlay', View: Popup }), projects: [], computer: true },
      { package: '@acme/logs', url: moduleModule('__logsPopup', { place: 'app.overlay', id: 'overlay', View: Popup }), projects: [PROJECT.id] },
    ])
    render(<App />)
    expect(await screen.findByText('a popup of @acme/overlay')).toBeTruthy()
    expect(screen.queryByText('a popup of @acme/logs')).toBeNull()
    cleanup()
    window.history.replaceState(null, '', '/nothing')
    render(<App />)
    expect(await screen.findByText('No such page')).toBeTruthy()
    expect(screen.getByText('a popup of @acme/overlay')).toBeTruthy()
  })

  test('a URL no installed module claims says so once the modules are loaded', async () => {
    answerShell([])
    window.history.replaceState(null, '', '/nothing')
    render(<App />)
    expect(await screen.findByText('No such page')).toBeTruthy()
  })

  test('a page that is not found is named by its heading, as every other page is', async () => {
    answerShell([])
    window.history.replaceState(null, '', '/nothing')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'No such page' })).toBeTruthy()
  })

  test("on a phone the bar names the dashboard's own pages, as it names a module's", async () => {
    answerShell([{ package: '@acme/logs', url: moduleModule('__phoneLogs', { place: 'app.page', id: 'logs', label: 'Logs', View: () => null }), projects: [PROJECT.id] }])
    const wide = phoneScreen()
    try {
      for (const [path, name] of [['/logs', 'Logs'], ['/profiles', 'Profiles'], ['/permissions', 'Permissions']]) {
        window.history.replaceState(null, '', path)
        render(<App />)
        // The name alone: the page's count stands beside it in the bar once the page has read it. Read in the wait: the first
        // button found may be the launcher's shape's, until the word is known to be no project's.
        await waitFor(() => expect(document.querySelector('[data-phone-bar]')!.querySelector('span')!.textContent).toBe(name))
        cleanup()
      }
    } finally {
      wide()
    }
  })

  test("on a phone a page under a module's page has a back arrow in its bar, up to that page; the page itself has none", async () => {
    function ListPage({ path }: UiPageProps) {
      const host = useModuleHost()
      return path.length === 0 ? createElement('button', { onClick: () => host.openPage('list', ['a'], PROJECT.id) }, 'open item a') : createElement('p', null, `item ${path.join('/')}`)
    }
    answerShell([{ package: '@acme/list', url: moduleModule('__listPhoneBack', { place: 'app.page', id: 'list', label: 'List', View: ListPage }), projects: [PROJECT.id] }])
    const wide = phoneScreen()
    try {
      // Opened cold: nothing behind it, so the arrow opens the list.
      window.history.replaceState(null, '', '/list/a')
      render(<App />)
      expect(await screen.findByText('item a')).toBeTruthy()
      fireEvent.click(within(document.querySelector<HTMLElement>('[data-phone-bar]')!).getByRole('button', { name: 'Back' }))
      expect(await screen.findByRole('button', { name: 'open item a' })).toBeTruthy()
      expect(window.location.pathname).toBe('/list')
      expect(within(document.querySelector<HTMLElement>('[data-phone-bar]')!).queryByRole('button', { name: 'Back' })).toBeNull()

      // Opened from the list: the arrow is the browser's Back, to the list's own entry.
      fireEvent.click(screen.getByRole('button', { name: 'open item a' }))
      expect(await screen.findByText('item a')).toBeTruthy()
      const entries = window.history.length
      fireEvent.click(within(document.querySelector<HTMLElement>('[data-phone-bar]')!).getByRole('button', { name: 'Back' }))
      expect(await screen.findByRole('button', { name: 'open item a' })).toBeTruthy()
      expect(window.history.length).toBe(entries)
    } finally {
      wide()
    }
  })

  test('on a phone the bar of a page that is not found says so', async () => {
    answerShell([])
    const wide = phoneScreen()
    try {
      window.history.replaceState(null, '', '/nothing')
      render(<App />)
      // Until the projects are read the word may be a project's, whose page waits as its shape: the bar comes once it is known.
      await waitFor(() => expect(document.querySelector('[data-phone-bar]')!.textContent).toBe('Not found'))
    } finally {
      wide()
    }
  })

  test('the page talks to its own package\'s commands through the host', async () => {
    const { useModuleHost } = await import('./module/index.js')
    function Runs({ projects }: UiPageProps) {
      const host = useModuleHost()
      return createElement('button', { onClick: () => void host.runCommand(projects[0]!.id, ['--limit', '5']) }, 'read')
    }
    answerShell([{ package: '@acme/logs', url: moduleModule('__runsModule', { place: 'app.page', id: 'runs', label: 'Runs', View: Runs }), projects: [PROJECT.id] }])
    window.history.replaceState(null, '', '/runs')
    render(<App />)
    fireEvent.click(await screen.findByText('read'))
    await waitFor(() => expect(calls).toContainEqual({ name: 'runModuleCommand', args: [PROJECT.id, '@acme/logs', ['--limit', '5'], undefined, false] }))
  })
})

describe('a first visit, the projects not read yet', () => {
  /** The projects' read, held until `answer` is called, in a fresh browser: one that kept no list of them. */
  function holdProjects(): () => void {
    localStorage.clear()
    forgetRemembered()
    answerShell([])
    // A session's page reads its files and its changes.
    answers.set('onProjectFiles', () => [])
    answers.set('onAgentChanges', () => [])
    answers.set('onDocs', () => [])
    let answer = () => {}
    answers.set('onProjects', () => new Promise(resolve => (answer = () => resolve([PROJECT]))))
    return () => act(answer)
  }

  test("a project's launcher waits as its box's shape, where the box will stand, and the launcher replaces it", async () => {
    const answer = holdProjects()
    window.history.replaceState(null, '', `/${PROJECT.name}`)
    render(<App />)
    const shape = await within(await screen.findByRole('main')).findByRole('status', {}, { timeout: 2000 })
    expect(shape.closest('.max-w-3xl')).not.toBeNull()
    // A project's page has its own top row: no phone bar names the word as a page while it waits, and
    // the page has no heading of its own.
    expect(document.querySelector('main')!.textContent).toBe('Loading…')
    answer()
    expect(await screen.findByText('the launcher of app')).toBeTruthy()
    expect(within(document.querySelector('main')!).queryByRole('status')).toBeNull()
  })

  test("a session waits as the chat's column with the box's shape at its foot, and the session's box replaces it", async () => {
    const answer = holdProjects()
    const id = '2026-11-14T23-05-03-506Z'
    answers.set('onAgents', () => [{ id, status: 'done', startedAt: '2026-11-14T23:05:03.506Z', updatedAt: '2026-11-14T23:06:00.000Z', intent: 'tidy up' }])
    answers.set('onRetainedWorktrees', () => [])
    window.history.replaceState(null, '', `/${PROJECT.name}/${id}`)
    render(<App />)
    const foot = await screen.findByTestId('chat-bottom')
    expect(await within(foot).findByRole('status', {}, { timeout: 2000 })).toBeTruthy()
    answer()
    await waitFor(() => expect(within(screen.getByTestId('chat-bottom')).getByRole('textbox')).toBeTruthy())
  })

  test("a page this browser listed waits as its frame while its code is out, its name where it will stand, and the page takes its place", async () => {
    const answer = holdProjects()
    // The modules not read either: the pages this browser listed on its last visit are what is known.
    let answerModules = (_modules: unknown[]) => {}
    answers.set('onModules', () => new Promise(resolve => (answerModules = resolve)))
    localStorage.setItem('openagent:listed-pages', JSON.stringify([{ id: 'logs', label: 'Logs', projects: [PROJECT.id] }]))
    try {
      window.history.replaceState(null, '', '/logs')
      render(<App />)
      const main = await screen.findByRole('main')
      expect(within(main).getByRole('heading', { name: 'Logs' })).toBeTruthy()
      expect(await within(main).findByRole('status', {}, { timeout: 2000 })).toBeTruthy()
      answer()
      const Runs = () => createElement('p', null, 'the runs')
      await act(async () => answerModules([{ package: '@acme/logs', url: moduleModule('__listedLogs', { place: 'app.page', id: 'logs', label: 'Logs', View: Runs }), projects: [PROJECT.id] }]))
      expect(await screen.findByText('the runs')).toBeTruthy()
      expect(within(screen.getByRole('main')).queryByRole('status')).toBeNull()
    } finally {
      localStorage.removeItem('openagent:listed-pages')
    }
  })

  test("on a phone the dashboard's own page has its bar from the first frame: its word is no project's", async () => {
    holdProjects()
    const wide = phoneScreen()
    try {
      window.history.replaceState(null, '', '/profiles')
      render(<App />)
      // The bar holds the page's name alone.
      expect(document.querySelector('[data-phone-bar]')!.textContent).toBe('Profiles')
    } finally {
      wide()
    }
  })

  test("a page's word no project has waits as a page's frame once the projects are read, not as a launcher", async () => {
    const answer = holdProjects()
    answers.set('onModules', () => new Promise(() => {}))
    window.history.replaceState(null, '', '/logs')
    render(<App />)
    const main = await screen.findByRole('main')
    expect((await within(main).findByRole('status', {}, { timeout: 2000 })).closest('.max-w-3xl')).not.toBeNull()
    answer()
    await waitFor(() => expect(within(main).getByRole('status').closest('.max-w-3xl')).toBeNull())
    expect(within(main).getByRole('status').closest('.max-w-240')).not.toBeNull()
  })
})

describe('module cards on the Overview (#1818)', () => {
  /** The Overview's own reads, answered empty: the shell's stub answers null otherwise, and a null list is not an empty one. */
  function answerOverview(modules: unknown[]): void {
    answerShell(modules)
    answers.set('onDashboard', () => null)
    // Landing on a started run renders its page, whose changes card reads a list.
    answers.set('onAgentChanges', () => [])
    answers.set('onDocs', () => [])
    answers.set('onProjectFiles', () => [])
  }

  test("a package's card is drawn on the Overview, given the projects that have the package, inside its host", async () => {
    const { useModuleHost } = await import('./module/index.js')
    function QueueCard({ projects }: UiCardProps) {
      const host = useModuleHost()
      return createElement('p', null, `${host.package} card for ${projects.map(p => p.name).join(', ')}`)
    }
    answerOverview([{ package: '@acme/queue', url: moduleModule('__queueCard', { place: 'overview.card', id: 'queue', label: 'queue', View: QueueCard }), projects: [PROJECT.id] }])
    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(await screen.findByText('@acme/queue card for app')).toBeTruthy()
  })

  test("a card shows as soon as its own package's code is in, whatever another package's is doing", async () => {
    function QueueCard() {
      return createElement('p', null, 'the queue card')
    }
    answerOverview([
      // Code that never finishes coming.
      { package: '@acme/slow', url: 'data:text/javascript,await new Promise(() => {}); export default {}', projects: [PROJECT.id] },
      { package: '@acme/queue', url: moduleModule('__quickCard', { place: 'overview.card', id: 'queue', label: 'queue', View: QueueCard }), projects: [PROJECT.id] },
    ])
    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(await screen.findByText('the queue card')).toBeTruthy()
  })

  test('a page with no chat scrolls as a page, on any screen, the sidebar fixed beside it; a project\'s own page is pinned, its columns scrolling by themselves', async () => {
    answerOverview([])
    // A project's own page: its "New agent session" page, whose message box stays at the bottom.
    window.history.replaceState(null, '', `/${PROJECT.name}`)
    // What shows of the page: a phone's keyboard took the rest.
    const shown = Object.assign(new EventTarget(), { height: 500, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: shown })
    // A box someone types in has the focus: the keyboard is up.
    const box = document.body.appendChild(document.createElement('textarea'))
    box.focus()
    try {
      render(<App />)
      await waitFor(() => expect(document.documentElement.dataset['pinned']).toBe('true'))
      expect(document.documentElement.style.getPropertyValue('--shown-height')).toBe('500px')
      // Nothing keeps the page taller than what shows: a page at least as tall as the screen ran under the keyboard.
      const shell = document.querySelector('.group\\/sidebar-wrapper')!
      expect(shell.className.split(' ')).toEqual(expect.arrayContaining(['fixed', 'top-(--shown-top,0px)', 'h-(--shown-height,100dvh)', 'min-h-0']))
      expect(shell.className.split(' ')).not.toContain('min-h-svh')
      shown.height = 800
      shown.dispatchEvent(new Event('resize'))
      expect(document.documentElement.style.getPropertyValue('--shown-height')).toBe('800px')
      // Safari scrolled what shows down the page: the page follows it there.
      shown.offsetTop = 120
      shown.dispatchEvent(new Event('scroll'))
      expect(document.documentElement.style.getPropertyValue('--shown-top')).toBe('120px')
      // Its keyboard went away and it said nothing more: what shows is read again as it settles.
      shown.height = 844
      await waitFor(() => expect(document.documentElement.style.getPropertyValue('--shown-height')).toBe('844px'))
      // The box let go of the keyboard, and Safari still says the page is moved down: it is the whole screen at its top all the same.
      box.blur()
      await waitFor(() => expect(document.documentElement.style.getPropertyValue('--shown-height')).toBe(''))
      expect(document.documentElement.style.getPropertyValue('--shown-top')).toBe('')
    } finally {
      box.remove()
      delete (window as { visualViewport?: unknown }).visualViewport
    }
    cleanup()
    // The Overview, on a wide screen: the page scrolls, and bounces, as the browser's own; the
    // sidebar is fixed to the window, so the bounce does not carry it, and starts under the
    // daemon's banner while that shows.
    window.history.replaceState(null, '', '/')
    render(<App />)
    await waitFor(() => expect(document.documentElement.dataset['pinned']).toBeUndefined())
    expect(document.querySelector('[data-slot=sidebar]')!.className.split(' ')).toEqual(expect.arrayContaining(['fixed', 'top-(--top-banner,0px)', 'h-[calc(100dvh-var(--top-banner,0px))]']))
    cleanup()
    // And on a phone.
    const wide = phoneScreen()
    try {
      render(<App />)
      await waitFor(() => expect(document.documentElement.dataset['pinned']).toBeUndefined())
    } finally {
      wide()
    }
  })

  test('an OpenAgent that refuses the page says it has stopped and how it starts again, from a terminal or installed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      answerShell([])
      render(<App />)
      expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
      answers.set('onProjects', () => { throw new TypeError('Failed to fetch') })
      await act(async () => void (await vi.advanceTimersByTimeAsync(5000 + 1000)))
      const banner = (await screen.findByRole('alert')).textContent
      expect(banner).toBe('OpenAgent has stopped. Start it again with openagent in a terminal; an installed one restarts with the computer or with its installer\u2019s command.')
    } finally {
      vi.useRealTimers()
    }
  })

  test("on a phone the banner draws its first sentence on its one line and says the rest to a screen reader; the page's top bar stands under it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const wide = phoneScreen()
    try {
      answerShell([])
      render(<App />)
      await waitFor(() => expect(document.querySelector('[data-phone-bar]')!.textContent).toBe('Overview'))
      answers.set('onProjects', () => { throw new TypeError('Failed to fetch') })
      await act(async () => void (await vi.advanceTimersByTimeAsync(5000 + 1000)))
      const banner = await screen.findByRole('alert')
      // The whole of it is said; what a phone's line has no room for is said only.
      expect(banner.textContent).toBe('OpenAgent has stopped. Start it again with openagent in a terminal; an installed one restarts with the computer or with its installer’s command.')
      const said = banner.querySelector('.max-md\\:sr-only')!
      expect(said.textContent).toBe(' Start it again with openagent in a terminal; an installed one restarts with the computer or with its installer’s command.')
      expect(said.parentElement!.className).toContain('max-md:truncate')
      // The banner keeps to the window's top as the page scrolls; the top bar keeps to the banner's foot.
      expect(document.querySelector('[data-phone-bar]')!.className.split(' ')).toContain('top-(--top-banner,0px)')
    } finally {
      wide()
      vi.useRealTimers()
    }
  })

  test("while OpenAgent is not answering, Settings and a module's popup say so as the pages do", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      function Popup() {
        return createElement('p', null, `the popup's saves: ${useOpenAgentDown() ? 'off' : 'on'}`)
      }
      answerShell([{ package: '@acme/overlay', url: moduleModule('__downPopup', { place: 'app.overlay', id: 'overlay', View: Popup }), projects: [], computer: true }])
      window.history.replaceState(null, '', '/?settings=scheduler')
      render(<App />)
      expect(await screen.findByText('its saves: on')).toBeTruthy()
      expect(await screen.findByText("the popup's saves: on")).toBeTruthy()
      answers.set('onProjects', () => { throw new TypeError('Failed to fetch') })
      await act(async () => void (await vi.advanceTimersByTimeAsync(5000 + 1000)))
      expect(await screen.findByRole('alert')).toBeTruthy()
      expect(screen.getByText('its saves: off')).toBeTruthy()
      expect(screen.getByText("the popup's saves: off")).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  test("a card of this computer's package is on the Overview though no project has the package", async () => {
    answerOverview([{ package: '@acme/accounts', url: moduleModule('__accountsCard', { place: 'overview.card', id: 'accounts', label: 'Accounts', View: () => createElement('p', null, 'accounts card') }), projects: [], computer: true }])
    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(await screen.findByText('accounts card')).toBeTruthy()
  })

  test('cards come out by order, then by package name; a card that throws shows only its own error', async () => {
    const card = (text: string) => ({ View: () => createElement('p', null, text) })
    function Boom(): never {
      throw new Error('kaboom')
    }
    answerOverview([
      { package: '@acme/tickets', url: moduleModule('__ticketsCard', { place: 'overview.card', id: 'hot', label: 'hot', order: 20, ...card('tickets card') }), projects: [PROJECT.id] },
      { package: '@acme/queue', url: moduleModule('__queueCard2', { place: 'overview.card', id: 'queue', label: 'queue', order: 10, ...card('queue card') }, { place: 'overview.card', id: 'boom', label: 'boom', order: 10, View: Boom }), projects: [PROJECT.id] },
      { package: '@acme/audit', url: moduleModule('__auditCard', { place: 'overview.card', id: 'audit', label: 'audit', ...card('audit card') }), projects: [PROJECT.id] },
    ])
    window.history.replaceState(null, '', '/')
    render(<App />)
    const queue = await screen.findByText('queue card')
    const tickets = await screen.findByText('tickets card')
    const audit = await screen.findByText('audit card')
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(before(queue, tickets)).toBe(true)
    expect(before(tickets, audit)).toBe(true)
    expect((await screen.findByRole('alert')).textContent).toBe('The boom card failed: kaboom')
  })

  test('a card may start a run without landing on it; by default the dashboard lands on the run', async () => {
    const { useModuleHost } = await import('./module/index.js')
    function Starter({ projects }: UiCardProps) {
      const host = useModuleHost()
      return createElement(
        'div',
        null,
        createElement('button', { onClick: () => void host.startRun(projects[0]!.id, 'work the queue', { land: false }) }, 'start and stay'),
        createElement('button', { onClick: () => void host.startRun(projects[0]!.id, 'work the queue') }, 'start and go'),
      )
    }
    answerOverview([{ package: '@acme/queue', url: moduleModule('__starterCard', { place: 'overview.card', id: 'starter', label: 'starter', View: Starter }), projects: [PROJECT.id] }])
    answers.set('sendStart', () => ({ ok: true, agentId: '9-r' }))
    window.history.replaceState(null, '', '/')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'start and stay' }))
    await waitFor(() => expect(calls.filter(call => call.name === 'sendStart')).toHaveLength(1))
    expect(calls.find(call => call.name === 'sendStart')?.args.slice(0, 2)).toEqual([PROJECT.id, 'work the queue'])
    expect(window.location.pathname).toBe('/')
    fireEvent.click(await screen.findByRole('button', { name: 'start and go' }))
    await waitFor(() => expect(window.location.pathname).toBe('/app/9-r'))
  })

  test('a run just started shows its name, in the header too, as soon as the daemon has it: before its row is in the list', async () => {
    const { useModuleHost } = await import('./module/index.js')
    function Starter({ projects }: UiCardProps) {
      const host = useModuleHost()
      return createElement('button', { onClick: () => void host.startRun(projects[0]!.id, 'fix the flaky login test') }, 'start')
    }
    answerOverview([{ package: '@acme/queue', url: moduleModule('__namedStarterCard', { place: 'overview.card', id: 'starter', label: 'starter', View: Starter }), projects: [PROJECT.id] }])
    answers.set('sendStart', () => ({ ok: true, agentId: '9-n' }))
    answers.set('onStartedName', () => 'Fix flaky login test')
    window.history.replaceState(null, '', '/')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'start' }))
    await waitFor(() => expect(window.location.pathname).toBe('/app/9-n'))
    expect(calls.find(call => call.name === 'onStartedName')?.args).toEqual(['9-n'])
    // The header's title, revealed letter by letter, while the list still has no row for the run.
    await waitFor(() => expect(document.querySelector('[title="Fix flaky login test"]')).toBeTruthy())
    expect(screen.queryByTestId('title-placeholder')).toBeNull()
  })
  test('a run just started is starting until a list has had it; then a list without it says no such session, as after a delete and Back', async () => {
    const { useModuleHost } = await import('./module/index.js')
    function Starter({ projects }: UiCardProps) {
      const host = useModuleHost()
      return createElement('button', { onClick: () => void host.startRun(projects[0]!.id, 'tidy up') }, 'start')
    }
    answerOverview([{ package: '@acme/queue', url: moduleModule('__goneStarterCard', { place: 'overview.card', id: 'starter', label: 'starter', View: Starter }), projects: [PROJECT.id] }])
    answers.set('sendStart', () => ({ ok: true, agentId: '9-d' }))
    const run = { id: '9-d', status: 'done', startedAt: '2026-07-19T16:05:44.756Z', updatedAt: '2026-07-19T16:06:21.000Z', intent: 'tidy up' }
    let listed: unknown[] = []
    answers.set('onAgents', () => listed)
    answers.set('onRetainedWorktrees', () => [])
    window.history.replaceState(null, '', '/')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'start' }))
    await waitFor(() => expect(window.location.pathname).toBe('/app/9-d'))
    await waitFor(() => expect(calls.filter(call => call.name === 'onAgents').length).toBeGreaterThan(1))
    expect(screen.queryByText('No such session')).toBeNull()
    listed = [run]
    await waitFor(() => expect(document.querySelector('button[aria-label="tidy up, session actions"]')).toBeTruthy())
    listed = []
    expect(await screen.findByText('No such session', {}, { timeout: 5000 })).toBeTruthy()
  })
})

describe('the project select (#1513)', () => {
  const OTHER = { id: 'site-def', path: '/work/site', name: 'site', activated: true }
  const url = () => window.location.pathname + window.location.search

  function answerTwo(): void {
    function LogsPage({ projects }: UiPageProps) {
      return createElement('p', null, `runs of ${projects.map(p => p.name).join(', ')}`)
    }
    function QueueCard({ projects }: UiCardProps) {
      return createElement('p', null, `card for ${projects.map(p => p.name).join(', ')}`)
    }
    answerShell([
      {
        package: '@acme/logs',
        url: moduleModule('__scopeModule', { place: 'app.page', id: 'logs', label: 'Logs', View: LogsPage }, { place: 'overview.card', id: 'queue', label: 'queue', View: QueueCard }, { place: 'overview.card', id: 'waiting', label: 'Waiting', needsYou: true, View: WaitingCard }),
        projects: [PROJECT.id, OTHER.id],
      },
    ])
    answers.set('onProjects', () => [PROJECT, OTHER])
    answers.set('onDocs', () => [])
    answers.set('onProjectFiles', () => [])
    answers.set('onAgentChanges', () => [])
    answers.set('onWaiting', () => ({
      items: [
        { kind: 'waiting', projectId: PROJECT.id, projectName: 'app', module: 'ask', scope: 'run', run: 'a1', words: 'Needs answer', title: 'app asks' },
        { kind: 'waiting', projectId: OTHER.id, projectName: 'site', module: 'ask', scope: 'run', run: 's1', words: 'Needs answer', title: 'site asks' },
      ],
      whole: [],
    }))
    answers.set('onRetainedWorktrees', () => [])
    answers.set('onDashboard', () => ({ totals: { projects: 2, openTodos: 0 }, projects: [], queue: [], active: [] }))
    // The agents at work, as the shell reads them for the mark and the Overview alike.
    answers.set('onOverview', () => ({
      active: [
        { projectId: PROJECT.id, projectName: 'app', agentId: 'a2', status: 'running', intent: 'app works' },
        { projectId: OTHER.id, projectName: 'site', agentId: 's2', status: 'running', intent: 'site works' },
      ],
      queueOpen: 0,
      recent: [],
    }))
    answers.set('onRecentAgents', () => [
      { projectId: PROJECT.id, projectName: 'app', agent: { id: '3-a', status: 'done', startedAt: '2026-07-19T16:05:44.756Z', updatedAt: '2026-07-19T16:06:21.000Z', intent: 'app ran' } },
      { projectId: OTHER.id, projectName: 'site', agent: { id: '3-s', status: 'done', startedAt: '2026-07-19T15:05:44.756Z', updatedAt: '2026-07-19T15:06:21.000Z', intent: 'site ran' } },
    ])
    answers.set('onAgents', (id: unknown) =>
      id === OTHER.id ? [{ id: '3-s', status: 'done', startedAt: '2026-07-19T15:05:44.756Z', updatedAt: '2026-07-19T15:06:21.000Z', intent: 'site ran' }] : [],
    )
  }

  async function pick(from: string, to: RegExp): Promise<void> {
    await openMenu(await screen.findByRole('combobox', { name: `Project: ${from}` }))
    fireEvent.click(screen.getByRole('option', { name: to }))
  }

  test('all projects show until one is picked; then the Overview, what needs you and the agent list show only that project', async () => {
    answerTwo()
    render(<App />)
    expect(await screen.findByText('card for app, site')).toBeTruthy()
    // Listed on the Overview and in the sidebar's "Waiting on you".
    await waitFor(() => expect(screen.getAllByText('app asks')).toHaveLength(2))
    expect(await screen.findByText('app works')).toBeTruthy()
    expect(await screen.findByText('app ran')).toBeTruthy()

    await pick('All projects', /site/)
    expect(url()).toBe('/site/overview')
    expect(await screen.findByText('card for site')).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('site asks')).toHaveLength(2))
    expect(screen.queryByText('app asks')).toBeNull()
    expect(screen.getByText('site works')).toBeTruthy()
    expect(screen.queryByText('app works')).toBeNull()
    expect(await screen.findByText('site ran')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('app ran')).toBeNull())
    expect(document.title).toBe('(1) Overview · site — OpenAgent')
  })

  test('the pick rides along to a module page and Settings over it, and its row opens that project\'s agent; the tab names each page first', async () => {
    answerTwo()
    window.history.replaceState(null, '', '/site/overview')
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Logs' }))
    expect(url()).toBe('/site/logs')
    expect(await screen.findByText('runs of site')).toBeTruthy()
    expect(document.title).toBe('(1) Logs · site — OpenAgent')
    // The sidebar marks the page that is open, also with Settings open over it. The person's row ends
    // in "settings", hence the patterns.
    const marked = () => ['Overview', 'Logs', 'Settings'].filter(name => screen.getByRole(name === 'Settings' ? 'button' : 'link', { name: name === 'Settings' ? /settings$/i : new RegExp(`^${name}`) }).getAttribute('aria-current') === 'page')
    expect(marked()).toEqual(['Logs'])
    fireEvent.click(screen.getByRole('button', { name: /settings$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(url()).toBe('/site/logs?settings=')
    expect(await screen.findByText("the settings dialog on ''")).toBeTruthy()
    expect(screen.getByText('runs of site')).toBeTruthy()
    expect(marked()).toEqual(['Logs'])
    expect(document.title).toBe('(1) Settings · site — OpenAgent')
    // Another entry replaces the address, so Back leaves Settings rather than stepping through it.
    const steps = window.history.length
    fireEvent.click(screen.getByRole('button', { name: 'to Agent' }))
    expect(url()).toBe('/site/logs?settings=agent')
    expect(window.history.length).toBe(steps)
    // Closed, the page under it is as it was.
    fireEvent.click(screen.getByRole('button', { name: 'shut the dialog' }))
    await waitFor(() => expect(url()).toBe('/site/logs'))
    expect(screen.queryByText(/the settings dialog/)).toBeNull()
    fireEvent.click(await screen.findByText('site ran'))
    expect(url()).toBe('/site/3-s')
    await waitFor(() => expect(document.title).toBe('(1) site ran · site — OpenAgent'))
  })

  test.each([
    ["the dialog's own list", async () => fireEvent.click(await screen.findByRole('button', { name: 'to Agent' }))],
    ['a link inside an entry', async () => fireEvent.click(await screen.findByRole('button', { name: 'a link to Agent' }))],
  ])('Settings opened over a page, moved to another entry by %s, and closed leaves that page as its history entry was: Back goes on to the page before, not into Settings again', async (_by, moveToAgent) => {
    answerTwo()
    window.history.replaceState(null, '', '/site/overview')
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Logs' }))
    window.history.replaceState({ written: 'by the page' }, '')
    fireEvent.click(screen.getByRole('button', { name: /settings$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    await screen.findByText("the settings dialog on ''")
    await moveToAgent()
    expect(url()).toBe('/site/logs?settings=agent')
    fireEvent.click(screen.getByRole('button', { name: 'shut the dialog' }))
    await waitFor(() => expect(url()).toBe('/site/logs'))
    expect(window.history.state).toMatchObject({ written: 'by the page' })
    window.history.back()
    await waitFor(() => expect(url()).toBe('/site/overview'))
    expect(screen.queryByText(/the settings dialog/)).toBeNull()
  })

  test("Settings opened by its address, on a first visit, waits for the projects: it opens on the address's project", async () => {
    forgetRemembered()
    localStorage.clear()
    answerTwo()
    const held: ((projects: unknown) => void)[] = []
    answers.set('onProjects', () => new Promise(resolve => held.push(resolve)))
    window.history.replaceState(null, '', '/site/overview?settings=notifications')
    render(<App />)
    await waitFor(() => expect(calls.some(call => call.name === 'onProjects')).toBe(true))
    expect(screen.queryByText(/the settings dialog/)).toBeNull()
    held.forEach(answer => answer([PROJECT, OTHER]))
    expect(await screen.findByText("the settings dialog on 'notifications'")).toBeTruthy()
    expect(screen.getByText(`its project: ${OTHER.id}`)).toBeTruthy()
  })

  test("a project the browser kept from its last load is drawn at once; any other project's address waits for the projects' read, so no such project never replaces a launcher", async () => {
    const visit = async (address: string): Promise<(projects: unknown) => void> => {
      cleanup()
      forgetRemembered()
      localStorage.clear()
      localStorage.setItem('openagent:read:projects', JSON.stringify([PROJECT]))
      answerTwo()
      const held: ((projects: unknown) => void)[] = []
      answers.set('onProjects', () => new Promise(resolve => held.push(resolve)))
      window.history.replaceState(null, '', address)
      render(<App />)
      await waitFor(() => expect(held.length).toBeGreaterThan(0))
      return projects => held.forEach(answer => answer(projects))
    }
    await visit(`/${PROJECT.id}`)
    expect(screen.getByText('the launcher of app')).toBeTruthy()

    const answerSite = await visit(`/${OTHER.id}`)
    expect([screen.queryByText(/the launcher of/), screen.queryByText('No such project')]).toEqual([null, null])
    answerSite([PROJECT, OTHER])
    expect(await screen.findByText('the launcher of site')).toBeTruthy()

    const answerNothing = await visit('/nothing-here')
    expect([screen.queryByText(/the launcher of/), screen.queryByText('No such project')]).toEqual([null, null])
    answerNothing([PROJECT, OTHER])
    expect(await screen.findByText('No such project')).toBeTruthy()
    expect(screen.queryByText(/the launcher of/)).toBeNull()
  })

  test("a jump to another project's agent names it at once, before that project's agents are read", async () => {
    answerTwo()
    // The other project's list never answers: the row clicked is all the page has.
    answers.set('onAgents', (id: unknown) => (id === OTHER.id ? new Promise(() => {}) : []))
    render(<App />)
    fireEvent.click(await screen.findByText('site ran'))
    // All projects stay shown there.
    expect(url()).toBe('/site/3-s?all')
    await waitFor(() => expect(document.querySelector('button[aria-label="site ran, session actions"]')).toBeTruthy())
  })

  test('the Overview has the box that starts a session: in no project, in the picked one; a project picked in the box is the Overview\'s, and a start opens the session there', async () => {
    answerTwo()
    render(<App />)
    expect(await screen.findByText('the box of session')).toBeTruthy()
    fireEvent.click(screen.getByText('pick app in the box'))
    expect(url()).toBe('/app/overview')
    expect(await screen.findByText('the box of app')).toBeTruthy()
    expect(await screen.findByRole('combobox', { name: 'Project: app' })).toBeTruthy()
    fireEvent.click(screen.getByText('pick no project in the box'))
    expect(url()).toBe('/')
    expect(await screen.findByText('the box of session')).toBeTruthy()
    fireEvent.click(screen.getByText('pick app in the box'))
    fireEvent.click(await screen.findByText('start from the box'))
    expect(url()).toBe('/app/9-box')
  })

  test('New agent session starts in the picked project; picking another on the launcher moves to its launcher, and all keeps the page', async () => {
    answerTwo()
    window.history.replaceState(null, '', '/site/overview')
    render(<App />)
    // The name is a project's once the projects are read.
    await screen.findByRole('combobox', { name: 'Project: site' })
    fireEvent.click(await screen.findByText('New agent session'))
    expect(url()).toBe('/site')
    expect(await screen.findByText('the launcher of site')).toBeTruthy()
    expect(document.title).toBe('(1) New agent session · site — OpenAgent')
    await pick('site', /app/)
    expect(url()).toBe('/app')
    await pick('app', /All projects/)
    expect(url()).toBe('/app?all')
    expect(await screen.findByRole('combobox', { name: 'Project: All projects' })).toBeTruthy()
    // Back returns to the launcher with its project picked.
    window.history.back()
    expect(await screen.findByRole('combobox', { name: 'Project: app' })).toBeTruthy()
    expect(url()).toBe('/app')
  })

  test('picking another project on an agent\'s page goes to the Overview; on a module page it drops the page\'s own path', async () => {
    answerTwo()
    window.history.replaceState(null, '', '/site/3-s?all')
    render(<App />)
    // All projects show, on a project's own page too: the agent list is every project's.
    expect(await screen.findByText('app ran')).toBeTruthy()
    await pick('All projects', /app/)
    expect(url()).toBe('/app/overview')
    cleanup()
    window.history.replaceState(null, '', '/site/logs/x')
    render(<App />)
    await pick('site', /app/)
    expect(url()).toBe('/app/logs')
    cleanup()
    window.history.replaceState(null, '', '/site/logs/x')
    render(<App />)
    await pick('site', /All projects/)
    expect(url()).toBe('/logs')
    // What the page mirrored into the query stays when only the pick changes.
    cleanup()
    window.history.replaceState(null, '', '/app/logs?q=races')
    render(<App />)
    await pick('app', /site/)
    expect(url()).toBe('/site/logs?q=races')
    await pick('site', /All projects/)
    expect(url()).toBe('/logs?q=races')
  })

  test('a project that is not registered picks nothing', async () => {
    answerTwo()
    window.history.replaceState(null, '', '/gone-123/overview')
    render(<App />)
    expect(await screen.findByRole('combobox', { name: 'Project: All projects' })).toBeTruthy()
    expect(await screen.findByText('card for app, site')).toBeTruthy()
  })

  /** The two projects, with a Tickets page that only `app` has, beside the Logs page both have. */
  function answerTwoWithTickets(): void {
    answerTwo()
    function TicketsPage({ projects }: UiPageProps) {
      return createElement('p', null, `tickets of ${projects.map(p => p.name).join(', ')}`)
    }
    const logs = (answers.get('onModules')!() as unknown[])[0]
    answers.set('onModules', () => [logs, { package: '@acme/tickets', url: moduleModule('__ticketsModule', { place: 'app.page', id: 'tickets', label: 'Tickets', View: TicketsPage }), projects: [PROJECT.id] }])
  }

  test('with a project picked the sidebar lists only the pages that project has; all projects lists every page', async () => {
    answerTwoWithTickets()
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Tickets' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Logs' })).toBeTruthy()

    await pick('All projects', /site/)
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Tickets' })).toBeNull())
    expect(screen.getByRole('link', { name: 'Logs' })).toBeTruthy()

    await pick('site', /app/)
    expect(await screen.findByRole('link', { name: 'Tickets' })).toBeTruthy()
    await pick('app', /All projects/)
    expect(screen.getByRole('link', { name: 'Tickets' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Logs' })).toBeTruthy()
  })

  test('picking a project on a page it does not have goes to the Overview, and a link to such a page says the project has none', async () => {
    answerTwoWithTickets()
    window.history.replaceState(null, '', '/tickets')
    render(<App />)
    expect(await screen.findByText('tickets of app')).toBeTruthy()
    await pick('All projects', /site/)
    expect(url()).toBe('/site/overview')
    cleanup()
    window.history.replaceState(null, '', '/site/tickets')
    render(<App />)
    expect(await screen.findByText('The project "site" has no package that adds a page at "tickets".')).toBeTruthy()
    expect(screen.queryByText(/tickets of/)).toBeNull()
    cleanup()
    window.history.replaceState(null, '', '/app/tickets')
    render(<App />)
    expect(await screen.findByText('tickets of app')).toBeTruthy()
  })

  test('with a project picked the Overview draws only the cards of the packages that project has', async () => {
    answerTwo()
    function HotCard({ projects }: UiCardProps) {
      return createElement('p', null, `hot tickets of ${projects.map(p => p.name).join(', ') || 'no project'}`)
    }
    const both = (answers.get('onModules')!() as unknown[])[0]
    answers.set('onModules', () => [both, { package: '@acme/tickets', url: moduleModule('__hotCard', { place: 'overview.card', id: 'hot', label: 'hot', View: HotCard }), projects: [PROJECT.id] }])
    render(<App />)
    expect(await screen.findByText('hot tickets of app')).toBeTruthy()
    expect(screen.getByText('card for app, site')).toBeTruthy()

    await pick('All projects', /site/)
    expect(await screen.findByText('card for site')).toBeTruthy()
    expect(screen.queryByText(/hot tickets of/)).toBeNull()

    await pick('site', /app/)
    expect(await screen.findByText('hot tickets of app')).toBeTruthy()
    expect(screen.getByText('card for app')).toBeTruthy()
  })

  test('adding a project reads the modules again at once', async () => {
    answerTwo()
    // A repo on this computer that is no project yet, picked at the top of the sidebar, is made one.
    answers.set('onRepos', () => ({ repos: [{ path: '/work/new', name: 'new' }], canAddFolder: false }))
    answers.set('sendAddProject', () => ({ ok: true, alreadyActivated: false }))
    render(<App />)
    await screen.findByRole('link', { name: 'Logs' })
    const reads = () => calls.filter(call => call.name === 'onModules').length
    const before = reads()
    await openMenu(screen.getByRole('combobox', { name: 'Project: All projects' }))
    fireEvent.click(await screen.findByRole('option', { name: /new/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
  })

  test('removing a project reads the modules again at once, and goes to the Overview', async () => {
    answerTwo()
    window.history.replaceState(null, '', '/site')
    render(<App />)
    await screen.findByRole('link', { name: 'Logs' })
    const reads = () => calls.filter(call => call.name === 'onModules').length
    const before = reads()
    fireEvent.click(await screen.findByRole('button', { name: 'remove the project' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
    expect(url()).toBe('/')
  })

  test('a project removed from a session\'s page leaves the page for the Overview, with the projects read again', async () => {
    answerTwo()
    window.history.replaceState(null, '', '/site/3-s')
    render(<App />)
    await screen.findByRole('link', { name: 'Logs' })
    const reads = () => calls.filter(call => call.name === 'onModules').length
    const before = reads()
    fireEvent.click(await screen.findByRole('button', { name: 'remove the project from its menu' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
    expect(url()).toBe('/')
  })

  test('a link to a project\'s page shows nothing, not "No such page", while the projects are still being read', async () => {
    answerTwo()
    // The projects never answer: which project a name is, and whether one is registered, is not known.
    answers.set('onProjects', () => new Promise(() => {}))
    for (const link of ['/gone-123/logs', '/app/logs', '/app']) {
      window.history.replaceState(null, '', link)
      render(<App />)
      await waitFor(() => expect(calls.some(call => call.name === 'onModules')).toBe(true))
      // Long enough for the modules to be imported and mounted.
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(screen.queryByText('No such page')).toBeNull()
      expect(url()).toBe(link)
      cleanup()
    }
  })

  test('a link to a project says neither "All projects" nor "No sessions yet." while the projects are read, and reads no agents under its address', async () => {
    for (const link of ['/app', '/app/overview']) {
      // Each link is a page opened afresh: nothing read by the last one.
      forgetRemembered()
      localStorage.clear()
      answerTwo()
      // Held back until answered, every read of them: the shell is not the only one making one.
      const held: ((projects: unknown) => void)[] = []
      answers.set('onProjects', () => new Promise(resolve => held.push(resolve)))
      window.history.replaceState(null, '', link)
      render(<App />)
      await waitFor(() => expect(calls.some(call => call.name === 'onModules')).toBe(true))
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(screen.getByRole('combobox', { name: 'Project: loading' })).toBeTruthy()
      expect(screen.queryByText('All projects')).toBeNull()
      expect(screen.queryByText('No sessions yet.')).toBeNull()
      // The address's word is no project's id, and every project's agents are not what the page shows.
      expect(calls.filter(call => call.name === 'onAgents' || call.name === 'onRecentAgents')).toEqual([])
      for (const answer of held) answer([PROJECT, OTHER])
      expect(await screen.findByRole('combobox', { name: 'Project: app' })).toBeTruthy()
      await waitFor(() => expect(calls.some(call => call.name === 'onAgents' && call.args[0] === PROJECT.id)).toBe(true))
      expect(calls.filter(call => call.name === 'onAgents').map(call => call.args[0])).not.toContain('app')
      cleanup()
      calls.length = 0
    }
  })

  test('a project named by its id opens, and the address names it by its name in the same entry', async () => {
    answerTwo()
    window.history.replaceState(null, '', `/${OTHER.id}/3-s?all`)
    render(<App />)
    const steps = window.history.length
    await waitFor(() => expect(url()).toBe('/site/3-s?all'))
    expect(window.history.length).toBe(steps)
    cleanup()
    window.history.replaceState(null, '', `/${OTHER.id}/logs`)
    render(<App />)
    await waitFor(() => expect(url()).toBe('/site/logs'))
    expect(await screen.findByText('runs of site')).toBeTruthy()
  })

  test("a page's word is the page's: a project with that name is addressed by its id, and a name nobody has says so", async () => {
    answerTwo()
    const LOGS = { id: 'logs-9zz', path: '/work/logs', name: 'logs', activated: true }
    answers.set('onProjects', () => [PROJECT, OTHER, LOGS])
    window.history.replaceState(null, '', '/logs')
    render(<App />)
    expect(await screen.findByText('runs of app, site')).toBeTruthy()
    cleanup()
    window.history.replaceState(null, '', '/logs-9zz')
    render(<App />)
    expect(await screen.findByRole('combobox', { name: 'Project: logs' })).toBeTruthy()
    expect(url()).toBe('/logs-9zz')
    cleanup()
    window.history.replaceState(null, '', '/gone')
    render(<App />)
    expect(await screen.findByText('No project has the address "/gone", and no installed package adds a page there.')).toBeTruthy()
  })
})

describe('the Context of a session continued from its box', () => {
  // The session's page as the shell drives it: it picks into the shell's Context as `#` does, and says a message
  // landed as its box does, for the session shown (a continuation) or for another run (a launch).
  function SessionPage({ agentId, contextSet, onAgentStarted }: { agentId: string; contextSet: { context: Set<string>; add: (path: string) => void }; onAgentStarted: (intent: string, id: string) => void }) {
    return createElement(
      'div',
      null,
      createElement('p', null, `Context: ${[...contextSet.context].join(', ')}`),
      createElement('button', { onClick: () => contextSet.add('README.md') }, 'pick README.md'),
      createElement('button', { onClick: () => onAgentStarted('go on', agentId) }, 'the continuation lands'),
      createElement('button', { onClick: () => onAgentStarted('another', '8-n') }, 'a new run starts'),
    )
  }

  test('a file picked while an ended run\'s continuation went keeps its Context once it lands; a new run starts with none', async () => {
    agentView.standIn = props => createElement(SessionPage, props as unknown as Parameters<typeof SessionPage>[0])
    answerShell([])
    answers.set('onDocs', () => [])
    answers.set('onProjectFiles', () => [])
    answers.set('onAgentChanges', () => [])
    answers.set('onRetainedWorktrees', () => [])
    answers.set('onAgents', () => [{ id: '7-e', status: 'done', startedAt: '2026-07-19T16:05:44.756Z', updatedAt: '2026-07-19T16:06:21.000Z', intent: 'app ran' }])
    window.history.replaceState(null, '', '/app/7-e')
    render(<App />)
    // The session is known: the shell's own fresh start for it is behind.
    await waitFor(() => expect(calls.some(call => call.name === 'onAgents' && call.args[0] === PROJECT.id)).toBe(true))
    fireEvent.click(await screen.findByRole('button', { name: 'pick README.md' }))
    expect(await screen.findByText('Context: README.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'the continuation lands' }))
    expect(window.location.pathname).toBe('/app/7-e')
    expect(screen.getByText('Context: README.md')).toBeTruthy()
    // A launch: the picked Context went with that run (#948).
    fireEvent.click(screen.getByRole('button', { name: 'a new run starts' }))
    await waitFor(() => expect(window.location.pathname).toBe('/app/8-n'))
    await waitFor(() => expect(screen.getByText(/^Context:/).textContent).toBe('Context: '))
  })
})

// A phone has no width for the sidebar beside the page (#1824).
describe('the shell on a phone', () => {
  test('the sidebar is closed and opens from the bar of pages at the foot of every page; a bar names a page with no top row of its own', async () => {
    const wide = phoneScreen()
    try {
      answerShell([])
      // What the launcher's own page reads.
      answers.set('onDocs', () => [])
      answers.set('onProjectFiles', () => [])
      render(<App />)
      const open = await screen.findByRole('button', { name: 'More' })
      // The top bar's word and the bar of pages' press, not the sidebar's row: the sidebar is closed.
      // The page's own heading says it too, to a screen reader only: the bar already names the page.
      expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
      expect(screen.getAllByText('Overview').map(el => (el.closest('h1') ? 'heading' : el.closest('nav') ? 'pages' : el.tagName))).toEqual(['SPAN', 'heading', 'pages'])
      const pages = screen.getByRole('navigation', { name: 'Pages' })
      expect(within(pages).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')

      expect(open.getAttribute('aria-expanded')).toBe('false')
      fireEvent.click(open)
      expect(open.getAttribute('aria-expanded')).toBe('true')
      // Settings is in the person's menu at the sidebar's foot.
      fireEvent.click(await screen.findByRole('button', { name: /settings$/i }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
      expect(await screen.findByText("the settings dialog on ''")).toBeTruthy()
      await waitFor(() => expect(screen.queryByRole('link', { name: 'New agent session' })).toBeNull())

      // The launcher has a top row of its own: no bar names it, and the bar of pages stays at its foot.
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      // New is one click, to the page of a session with no project.
      fireEvent.click(await screen.findByRole('link', { name: 'New agent session' }))
      expect(await screen.findByText(/^the launcher of/)).toBeTruthy()
      await waitFor(() => expect(screen.queryByRole('link', { name: 'New agent session' })).toBeNull())
      expect(document.querySelector('[data-phone-bar]')).toBeNull()
      expect(within(screen.getByRole('navigation', { name: 'Pages' })).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull()
      expect(screen.queryByText('Settings')).toBeNull()
    } finally {
      wide()
    }
  })

  test('on a phone the Overview in the bar of pages counts what waits on the person, with the modules\' pages beside it', async () => {
    const wide = phoneScreen()
    try {
      answerShell([{ package: '@acme/logs', url: moduleModule('__phoneBarLogs', { place: 'app.page', id: 'logs', label: 'Logs', View: () => null }), projects: [PROJECT.id] }])
      answers.set('onWaiting', () => ({ items: [{ kind: 'waiting', projectId: PROJECT.id, projectName: 'app', module: 'ask', scope: 'run', run: 'r1', words: 'Needs answer', title: 'Pick a name' }], whole: [PROJECT.id] }))
      render(<App />)
      const pages = await screen.findByRole('navigation', { name: 'Pages' })
      await waitFor(() => expect(within(pages).getByRole('link', { name: 'Overview, 1 waiting on you' })).toBeTruthy())
      fireEvent.click(await within(pages).findByRole('link', { name: 'Logs' }))
      await waitFor(() => expect(window.location.pathname).toBe('/logs'))
      expect(within(pages).getByRole('link', { name: 'Logs' }).getAttribute('aria-current')).toBe('page')
      // New opens the "New agent session" page, as the sidebar's New does; More opens the sidebar.
      fireEvent.click(within(pages).getByRole('link', { name: 'New' }))
      expect(await screen.findByText(/^the launcher of/)).toBeTruthy()
      expect(within(pages).getByRole('link', { name: 'New' }).getAttribute('aria-current')).toBe('page')
      expect(within(pages).getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false')
    } finally {
      wide()
    }
  })

  test('on a phone the bar of pages is drawn complete once its pages are known: none of its presses moves as they come', async () => {
    const wide = phoneScreen()
    let answerModules = (_modules: unknown[]) => {}
    answerShell([])
    answers.set('onModules', () => new Promise(resolve => (answerModules = resolve)))
    try {
      render(<App />)
      const pages = await screen.findByRole('navigation', { name: 'Pages' })
      expect(within(pages).queryAllByRole('link')).toEqual([])
      await act(async () => answerModules([{ package: '@acme/logs', url: moduleModule('__firstBarLogs', { place: 'app.page', id: 'logs', label: 'Logs', View: () => null }), projects: [PROJECT.id] }]))
      await waitFor(() => expect(within(pages).getAllByRole('link').map(link => link.textContent)).toEqual(['Overview', 'Logs', 'New']))
    } finally {
      wide()
    }
  })

  test("on a phone a session's page has no bar of pages; its top bar's back arrow goes to the page shown before, or to the Overview from a link opened cold", async () => {
    const wide = phoneScreen()
    const id = '2026-11-14T23-05-03-506Z'
    try {
      answerShell([{ package: '@acme/waiting', url: moduleModule('__phoneWaiting', { place: 'overview.card', id: 'waiting', label: 'Waiting', needsYou: true, View: WaitingCard }), projects: [PROJECT.id] }])
      answers.set('onDashboard', () => null)
      answers.set('onAgentChanges', () => [])
      answers.set('onDocs', () => [])
      answers.set('onProjectFiles', () => [])
      answers.set('onRetainedWorktrees', () => [])
      answers.set('onAgents', () => [{ id, status: 'done', startedAt: '2026-11-14T23:05:03.506Z', updatedAt: '2026-11-14T23:06:00.000Z', intent: 'pick a name' }])
      answers.set('onWaiting', () => ({ items: [{ kind: 'waiting', projectId: PROJECT.id, projectName: 'app', module: 'ask', scope: 'run', run: id, words: 'Needs answer', title: 'Pick a name' }], whole: [PROJECT.id] }))

      // Opened cold, from a link: nothing of this app's is behind it, so Back goes to the Overview.
      window.history.replaceState(null, '', `/${PROJECT.name}/${id}`)
      render(<App />)
      const backButton = await screen.findByRole('button', { name: 'Back' })
      expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
      fireEvent.click(backButton)
      await waitFor(() => expect(window.location.pathname).toBe(`/${PROJECT.name}/overview`))
      expect(await screen.findByRole('navigation', { name: 'Pages' })).toBeTruthy()

      // Opened from the Overview: Back is the browser's, to the Overview's own entry.
      fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /Pick a name/ }))
      await waitFor(() => expect(window.location.pathname).toBe(`/${PROJECT.name}/${id}`))
      const entries = window.history.length
      fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
      await waitFor(() => expect(window.location.pathname).toBe(`/${PROJECT.name}/overview`))
      expect(window.history.length).toBe(entries)
    } finally {
      wide()
    }
  })

  test('on a wide screen the sidebar hides by its button or Cmd+B, the page then offers it back, and it stays hidden on the next load', async () => {
    answerShell([])
    try {
      const { unmount } = render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: 'Hide the sidebar' }))
      expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull()
      // The page's own header holds the button that shows it again.
      fireEvent.click(await screen.findByRole('button', { name: 'Show the sidebar' }))
      expect(await screen.findByRole('link', { name: 'Overview' })).toBeTruthy()
      fireEvent.keyDown(window, { key: 'b', metaKey: true })
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Overview' })).toBeNull())
      unmount()
      // Kept in this browser: hidden still on the next load (the module reads it once, as a page load does).
      expect(localStorage.getItem('oa.sidebar-hidden')).toBe('true')
    } finally {
      localStorage.removeItem('oa.sidebar-hidden')
      const { setSidebarHidden } = await import('./lib/sidebar-width.js')
      setSidebarHidden(false)
    }
  })

  test('hiding or showing the sidebar by its button gives the focus to the button that takes its place', async () => {
    answerShell([])
    try {
      render(<App />)
      fireEvent.click(await screen.findByRole('button', { name: 'Hide the sidebar' }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show the sidebar' }))
      fireEvent.click(screen.getByRole('button', { name: 'Show the sidebar' }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide the sidebar' }))
    } finally {
      localStorage.removeItem('oa.sidebar-hidden')
      const { setSidebarHidden } = await import('./lib/sidebar-width.js')
      setSidebarHidden(false)
    }
  })

  test('on a wide screen there is no bar and no button: the sidebar is beside the page', async () => {
    answerShell([])
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Overview' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Pages' })).toBeNull()
    // The sidebar's row, and the page's own heading: no bar names it a third time.
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(screen.getAllByText('Overview')).toHaveLength(2)
  })
})

describe('the keyboard shortcuts', () => {
  test('? outside a text field opens their list in Settings; typed into a field, or over a dialog, it is only a character', async () => {
    answerShell([])
    render(<App />)
    await screen.findByRole('heading', { name: 'Overview' })
    const field = document.body.appendChild(document.createElement('input'))
    fireEvent.keyDown(field, { key: '?', shiftKey: true })
    const dialog = render(<Dialog open onOpenChange={() => {}} title="A dialog">Over the page</Dialog>)
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
    expect(screen.queryByText(/the settings dialog/)).toBeNull()
    dialog.unmount()
    field.remove()
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
    expect(await screen.findByText("the settings dialog on 'shortcuts'")).toBeTruthy()
  })
})
