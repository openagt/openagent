import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { phoneScreen } from './test-utils.js'
import type { ModuleCardProps, ModuleDefinition, ModulePageProps } from './module/index.js'

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
vi.mock('./components/SettingsDialog.js', () => ({
  SettingsDialog: ({ entry, onEntry, onClose }: { entry: string; onEntry: (id: string) => void; onClose: () => void }) =>
    createElement('div', null, createElement('p', null, `the settings dialog on '${entry}'`), createElement('button', { onClick: () => onEntry('agent') }, 'to Agent'), createElement('button', { onClick: onClose }, 'shut the dialog')),
}))
vi.mock('./components/ProjectHome.js', () => ({
  ProjectHome: ({ projectName, onProjectRemoved }: { projectName?: string; onProjectRemoved?: () => void }) =>
    createElement('p', null, `the launcher of ${projectName}`, createElement('button', { onClick: onProjectRemoved }, 'remove the project')),
}))

const { App } = await import('./App.js')

const PROJECT = { id: 'app-abc', path: '/work/app', name: 'app', activated: true }

/** A module's browser part the loader imports like a real one: a data URL whose default export is `definition`. */
function moduleModule(key: string, definition: ModuleDefinition): string {
  ;(globalThis as Record<string, unknown>)[key] = definition
  return `data:text/javascript,export default globalThis[${JSON.stringify(key)}]`
}

function answerShell(modules: unknown[]): void {
  answers.clear()
  answers.set('onProjects', () => [PROJECT])
  answers.set('onModules', () => modules)
  answers.set('onInterventions', () => ({ items: [], whole: [] }))
  answers.set('onRecentAgents', () => [])
  answers.set('onAgents', () => [])
  answers.set('onOverview', () => ({ active: [] }))
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  calls.length = 0
})

describe('module pages in the shell (#1774)', () => {
  test('a module\'s page gets a sidebar row and its own URL, where no project is selected', async () => {
    function LogsPage({ projects }: ModulePageProps) {
      return createElement('p', null, `runs of ${projects.map(p => p.name).join(', ')}`)
    }
    answerShell([{ package: '@acme/logs', url: moduleModule('__logsModule', { pages: [{ segment: 'logs', label: 'Logs', Page: LogsPage }] }), projects: [PROJECT.id] }])
    // A page no module claims: its main pane reads nothing, so the stub needs no answers for it.
    window.history.replaceState(null, '', '/elsewhere')
    render(<App />)

    const row = await screen.findByRole('button', { name: 'Logs' })
    fireEvent.click(row)
    expect(window.location.pathname).toBe('/logs')
    expect(await screen.findByText('runs of app')).toBeTruthy()
    expect(row.getAttribute('aria-current')).toBe('page')
    // The page's segment names no project: nothing reads a project called "logs".
    expect(calls.filter(call => call.args[0] === 'logs' || call.args[0] === 'elsewhere').map(call => call.name)).toEqual([])
  })

  test('a URL no installed module claims says so once the modules are loaded', async () => {
    answerShell([])
    window.history.replaceState(null, '', '/nothing')
    render(<App />)
    expect(await screen.findByText('No such page')).toBeTruthy()
  })

  test('the page talks to its own package\'s commands through the host', async () => {
    const { useModuleHost } = await import('./module/index.js')
    function Runs({ projects }: ModulePageProps) {
      const host = useModuleHost()
      return createElement('button', { onClick: () => void host.runCommand(projects[0]!.id, ['--limit', '5']) }, 'read')
    }
    answerShell([{ package: '@acme/logs', url: moduleModule('__runsModule', { pages: [{ segment: 'runs', label: 'Runs', Page: Runs }] }), projects: [PROJECT.id] }])
    window.history.replaceState(null, '', '/runs')
    render(<App />)
    fireEvent.click(await screen.findByText('read'))
    await waitFor(() => expect(calls).toContainEqual({ name: 'runModuleCommand', args: [PROJECT.id, '@acme/logs', ['--limit', '5'], undefined, false] }))
  })
})

describe('module cards on the Overview (#1818)', () => {
  /** The Overview's own reads, answered empty: the shell's stub answers null otherwise, and a null list is not an empty one. */
  function answerOverview(modules: unknown[]): void {
    answerShell(modules)
    answers.set('onQuota', () => null)
    answers.set('onDashboard', () => null)
    // Landing on a started run renders its page, whose changes card reads a list.
    answers.set('onAgentChanges', () => [])
    answers.set('onDocs', () => [])
    answers.set('onProjectFiles', () => [])
  }

  test("a package's card is drawn on the Overview, given the projects that have the package, inside its host", async () => {
    const { useModuleHost } = await import('./module/index.js')
    function QueueCard({ projects }: ModuleCardProps) {
      const host = useModuleHost()
      return createElement('p', null, `${host.package} card for ${projects.map(p => p.name).join(', ')}`)
    }
    answerOverview([{ package: '@acme/queue', url: moduleModule('__queueCard', { cards: [{ id: 'queue', Card: QueueCard }] }), projects: [PROJECT.id] }])
    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(await screen.findByText('@acme/queue card for app')).toBeTruthy()
  })

  test('cards come out by order, then by package name; a card that throws shows only its own error', async () => {
    const card = (text: string) => ({ Card: () => createElement('p', null, text) })
    function Boom(): never {
      throw new Error('kaboom')
    }
    answerOverview([
      { package: '@acme/tickets', url: moduleModule('__ticketsCard', { cards: [{ id: 'hot', order: 20, ...card('tickets card') }] }), projects: [PROJECT.id] },
      { package: '@acme/queue', url: moduleModule('__queueCard2', { cards: [{ id: 'queue', order: 10, ...card('queue card') }, { id: 'boom', order: 10, Card: Boom }] }), projects: [PROJECT.id] },
      { package: '@acme/audit', url: moduleModule('__auditCard', { cards: [{ id: 'audit', ...card('audit card') }] }), projects: [PROJECT.id] },
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
    function Starter({ projects }: ModuleCardProps) {
      const host = useModuleHost()
      return createElement(
        'div',
        null,
        createElement('button', { onClick: () => void host.startRun(projects[0]!.id, 'work the queue', { land: false }) }, 'start and stay'),
        createElement('button', { onClick: () => void host.startRun(projects[0]!.id, 'work the queue') }, 'start and go'),
      )
    }
    answerOverview([{ package: '@acme/queue', url: moduleModule('__starterCard', { cards: [{ id: 'starter', Card: Starter }] }), projects: [PROJECT.id] }])
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
})

describe('the project select (#1513)', () => {
  const OTHER = { id: 'site-def', path: '/work/site', name: 'site', activated: true }
  const url = () => window.location.pathname + window.location.search

  function answerTwo(): void {
    function LogsPage({ projects }: ModulePageProps) {
      return createElement('p', null, `runs of ${projects.map(p => p.name).join(', ')}`)
    }
    function QueueCard({ projects }: ModuleCardProps) {
      return createElement('p', null, `card for ${projects.map(p => p.name).join(', ')}`)
    }
    answerShell([{ package: '@acme/logs', url: moduleModule('__scopeModule', { pages: [{ segment: 'logs', label: 'Logs', Page: LogsPage }], cards: [{ id: 'queue', Card: QueueCard }] }), projects: [PROJECT.id, OTHER.id] }])
    answers.set('onProjects', () => [PROJECT, OTHER])
    answers.set('onQuota', () => null)
    answers.set('onDocs', () => [])
    answers.set('onProjectFiles', () => [])
    answers.set('onAgentChanges', () => [])
    answers.set('onInterventions', () => ({
      items: [
        { kind: 'awaiting', projectId: PROJECT.id, projectName: 'app', agentId: 'a1', title: 'app asks' },
        { kind: 'awaiting', projectId: OTHER.id, projectName: 'site', agentId: 's1', title: 'site asks' },
      ],
      whole: [],
    }))
    answers.set('onRetainedWorktrees', () => [])
    answers.set('onDashboard', () => ({
      totals: { projects: 2, openTodos: 0 },
      projects: [],
      queue: [],
      active: [
        { projectId: PROJECT.id, projectName: 'app', agentId: 'a2', status: 'running', intent: 'app works' },
        { projectId: OTHER.id, projectName: 'site', agentId: 's2', status: 'running', intent: 'site works' },
      ],
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
    const { openMenu } = await import('./test-utils.js')
    await openMenu(await screen.findByRole('button', { name: `Project: ${from}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: to }))
  }

  test('all projects show until one is picked; then the Overview, its badge and the agent list show only that project', async () => {
    answerTwo()
    render(<App />)
    expect(await screen.findByText('card for app, site')).toBeTruthy()
    expect(await screen.findByText('app asks')).toBeTruthy()
    expect(await screen.findByText('app works')).toBeTruthy()
    expect(await screen.findByText('app ran')).toBeTruthy()

    await pick('All projects', /site/)
    expect(url()).toBe('/site/overview')
    expect(await screen.findByText('card for site')).toBeTruthy()
    expect(screen.getByText('site asks')).toBeTruthy()
    expect(screen.queryByText('app asks')).toBeNull()
    expect(screen.getByText('site works')).toBeTruthy()
    expect(screen.queryByText('app works')).toBeNull()
    expect(await screen.findByText('site ran')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('app ran')).toBeNull())
    expect(document.title).toBe('(1) site — OpenAgent')
  })

  test('the pick rides along to a module page and Settings over it, and its row opens that project\'s agent', async () => {
    answerTwo()
    window.history.replaceState(null, '', '/site/overview')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Logs' }))
    expect(url()).toBe('/site/logs')
    expect(await screen.findByText('runs of site')).toBeTruthy()
    // The sidebar marks the page that is open, also with Settings open over it. The Overview row's
    // name carries its Human Queue count here, and the person's row ends in "settings", hence the patterns.
    const marked = () => ['Overview', 'Logs', 'Settings'].filter(name => screen.getByRole('button', { name: name === 'Settings' ? /settings$/i : new RegExp(`^${name}`) }).getAttribute('aria-current') === 'page')
    expect(marked()).toEqual(['Logs'])
    fireEvent.click(screen.getByRole('button', { name: /settings$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(url()).toBe('/site/logs?settings=')
    expect(await screen.findByText("the settings dialog on ''")).toBeTruthy()
    expect(screen.getByText('runs of site')).toBeTruthy()
    expect(marked()).toEqual(['Logs'])
    // Another entry replaces the address, so Back leaves Settings rather than stepping through it.
    const steps = window.history.length
    fireEvent.click(screen.getByRole('button', { name: 'to Agent' }))
    expect(url()).toBe('/site/logs?settings=agent')
    expect(window.history.length).toBe(steps)
    // Closed, the page under it is as it was.
    fireEvent.click(screen.getByRole('button', { name: 'shut the dialog' }))
    expect(url()).toBe('/site/logs')
    expect(screen.queryByText(/the settings dialog/)).toBeNull()
    fireEvent.click(await screen.findByText('site ran'))
    expect(url()).toBe('/site/3-s')
  })

  test("a jump to another project's agent names it at once, before that project's agents are read", async () => {
    answerTwo()
    // The other project's list never answers: the row clicked is all the page has.
    answers.set('onAgents', (id: unknown) => (id === OTHER.id ? new Promise(() => {}) : []))
    render(<App />)
    fireEvent.click(await screen.findByText('site ran'))
    // All projects stay shown there.
    expect(url()).toBe('/site/3-s?all')
    await waitFor(() => expect(document.querySelector('button[aria-label="Session actions"][title="site ran"]')).toBeTruthy())
  })

  test('New agent starts in the picked project; picking another on the launcher moves to its launcher, and all keeps the page', async () => {
    answerTwo()
    window.history.replaceState(null, '', '/site/overview')
    render(<App />)
    // The name is a project's once the projects are read.
    await screen.findByRole('button', { name: 'Project: site' })
    fireEvent.click(await screen.findByText('New agent'))
    expect(url()).toBe('/site')
    expect(await screen.findByText('the launcher of site')).toBeTruthy()
    await pick('site', /app/)
    expect(url()).toBe('/app')
    await pick('app', /All projects/)
    expect(url()).toBe('/app?all')
    expect(await screen.findByRole('button', { name: 'Project: All projects' })).toBeTruthy()
    // Back returns to the launcher with its project picked.
    window.history.back()
    expect(await screen.findByRole('button', { name: 'Project: app' })).toBeTruthy()
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
    expect(await screen.findByRole('button', { name: 'Project: All projects' })).toBeTruthy()
    expect(await screen.findByText('card for app, site')).toBeTruthy()
  })

  /** The two projects, with a Tickets page that only `app` has, beside the Logs page both have. */
  function answerTwoWithTickets(): void {
    answerTwo()
    function TicketsPage({ projects }: ModulePageProps) {
      return createElement('p', null, `tickets of ${projects.map(p => p.name).join(', ')}`)
    }
    const logs = (answers.get('onModules')!() as unknown[])[0]
    answers.set('onModules', () => [logs, { package: '@acme/tickets', url: moduleModule('__ticketsModule', { pages: [{ segment: 'tickets', label: 'Tickets', Page: TicketsPage }] }), projects: [PROJECT.id] }])
  }

  test('with a project picked the sidebar lists only the pages that project has; all projects lists every page', async () => {
    answerTwoWithTickets()
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Tickets' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Logs' })).toBeTruthy()

    await pick('All projects', /site/)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Tickets' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Logs' })).toBeTruthy()

    await pick('site', /app/)
    expect(await screen.findByRole('button', { name: 'Tickets' })).toBeTruthy()
    await pick('app', /All projects/)
    expect(screen.getByRole('button', { name: 'Tickets' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Logs' })).toBeTruthy()
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
    function HotCard({ projects }: ModuleCardProps) {
      return createElement('p', null, `hot tickets of ${projects.map(p => p.name).join(', ') || 'no project'}`)
    }
    const both = (answers.get('onModules')!() as unknown[])[0]
    answers.set('onModules', () => [both, { package: '@acme/tickets', url: moduleModule('__hotCard', { cards: [{ id: 'hot', Card: HotCard }] }), projects: [PROJECT.id] }])
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
    answers.set('sendPickProjectDirectory', () => ({ ok: true, path: '/work/new' }))
    answers.set('sendAddProject', () => ({ ok: true, alreadyActivated: false }))
    render(<App />)
    await screen.findByRole('button', { name: 'Logs' })
    const reads = () => calls.filter(call => call.name === 'onModules').length
    const before = reads()
    const { openMenu } = await import('./test-utils.js')
    await openMenu(screen.getByRole('button', { name: 'Project: All projects' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Add project/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'I trust it, add it' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
  })

  test('removing a project reads the modules again at once, and goes to the Overview', async () => {
    answerTwo()
    window.history.replaceState(null, '', '/site')
    render(<App />)
    await screen.findByRole('button', { name: 'Logs' })
    const reads = () => calls.filter(call => call.name === 'onModules').length
    const before = reads()
    fireEvent.click(await screen.findByRole('button', { name: 'remove the project' }))
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

  test('a link to a project says neither "All projects" nor "No agents yet." while the projects are read, and reads no agents under its address', async () => {
    for (const link of ['/app', '/app/overview']) {
      answerTwo()
      // Held back until answered, every read of them: the shell is not the only one making one.
      const held: ((projects: unknown) => void)[] = []
      answers.set('onProjects', () => new Promise(resolve => held.push(resolve)))
      window.history.replaceState(null, '', link)
      render(<App />)
      await waitFor(() => expect(calls.some(call => call.name === 'onModules')).toBe(true))
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(screen.getByRole('button', { name: 'Project: loading' })).toBeTruthy()
      expect(screen.queryByText('All projects')).toBeNull()
      expect(screen.queryByText('No agents yet.')).toBeNull()
      // The address's word is no project's id, and every project's agents are not what the page shows.
      expect(calls.filter(call => call.name === 'onAgents' || call.name === 'onRecentAgents')).toEqual([])
      for (const answer of held) answer([PROJECT, OTHER])
      expect(await screen.findByRole('button', { name: 'Project: app' })).toBeTruthy()
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
    expect(await screen.findByRole('button', { name: 'Project: logs' })).toBeTruthy()
    expect(url()).toBe('/logs-9zz')
    cleanup()
    window.history.replaceState(null, '', '/gone')
    render(<App />)
    expect(await screen.findByText('No project has the address "/gone", and no installed package adds a page there.')).toBeTruthy()
  })
})

// A phone has no width for the sidebar beside the page (#1824).
describe('the shell on a phone', () => {
  test('the sidebar is closed, and a bar names the page beside the button that opens it; a project\'s own pages get the button alone', async () => {
    const wide = phoneScreen()
    try {
      answerShell([])
      // What the launcher's own page reads.
      answers.set('onDocs', () => [])
      answers.set('onProjectFiles', () => [])
      render(<App />)
      const open = await screen.findByRole('button', { name: 'Open the menu' })
      // The bar's word, not the sidebar's row: the sidebar is closed.
      expect(screen.getByText('Overview').tagName).toBe('SPAN')
      expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull()

      expect(open.getAttribute('aria-expanded')).toBe('false')
      fireEvent.click(open)
      expect(open.getAttribute('aria-expanded')).toBe('true')
      // Settings is in the person's menu at the sidebar's foot.
      fireEvent.click(await screen.findByRole('button', { name: /settings$/i }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))
      expect(await screen.findByText("the settings dialog on ''")).toBeTruthy()
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull())

      // The launcher has a top row of its own, which keeps its corner free for the button.
      fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }))
      fireEvent.click(await screen.findByRole('button', { name: 'New agent' }))
      expect(await screen.findByText('the launcher of app')).toBeTruthy()
      await waitFor(() => expect(screen.queryByRole('button', { name: 'New agent' })).toBeNull())
      expect(screen.getByRole('button', { name: 'Open the menu' })).toBeTruthy()
      expect(screen.queryByText('Overview')).toBeNull()
      expect(screen.queryByText('Settings')).toBeNull()
    } finally {
      wide()
    }
  })

  test('on a wide screen there is no bar and no button: the sidebar is beside the page', async () => {
    answerShell([])
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Overview' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open the menu' })).toBeNull()
    expect(screen.getAllByText('Overview')).toHaveLength(1)
  })
})
