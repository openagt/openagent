import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import type { DashboardData, ProjectSummary } from '../../src/index.js'
import type { ListedPage } from '../lib/use-modules.js'
import { configureFirst } from '../test-utils.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'

// The first steps read their state over several RPC stubs and hooks; stub them all so nothing
// reaches for a daemon and each step's "done" comes from a fixture instead.
const onDashboard = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDashboard }))
vi.mock('../rpc/projects.js', () => ({ onRepos: vi.fn(async () => ({ repos: [], hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false })), sendAddRepoFolder: vi.fn(), sendAddProject: vi.fn(), sendPickProjectDirectory: vi.fn(), onCloneTarget: vi.fn(), sendAddProjectFromAddress: vi.fn() }))
vi.mock('../rpc/person.js', () => ({ onPerson: vi.fn(async () => ({ name: 'Ada Lovelace' })) }))
const updatePreferences = vi.hoisted(() => vi.fn())
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => ({}),
  updatePreferences,
}))
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
const onAgentAccounts = vi.hoisted(() => vi.fn())
vi.mock('../rpc/accounts.js', () => ({ onAgentAccounts, sendUseAgentAccountFirst: vi.fn() }))
// The press that connects an agent is its package's: here a stand-in that says which agent it is for, and whether it is the primary.
vi.mock('../lib/use-modules.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/use-modules.js')>('../lib/use-modules.js')
  const { createElement } = await import('react')
  const View = ({ agent, primary, onConnected }: { agent: string; primary: boolean; onConnected: () => void }) => createElement('button', { type: 'button', 'data-primary': primary, onClick: onConnected }, `Connect ${agent}`)
  return {
    ...actual,
    useMountedModules: () => {
      const mounted = actual.useMountedModules()
      return { ...mounted, views: { ...mounted.views, 'agent.connect': [{ place: 'agent.connect', id: 'connect', package: '@openagt/agent-driver', projects: [], View }] } }
    },
  }
})
// One stable object, so a test can steer the start and its error without a re-mock.
const startAgent = vi.hoisted(() => ({ start: vi.fn(), busy: false, error: null as string | null }))
vi.mock('../lib/use-start-agent.js', async () => ({
  ...(await vi.importActual<typeof import('../lib/use-start-agent.js')>('../lib/use-start-agent.js')),
  useStartAgent: () => startAgent,
}))

const { OnboardingChecklist } = await import('./OnboardingChecklist.js')
const { takePendingDraft } = await import('../lib/draft-handoff.js')

const github = (accounts: { login: string; runs: boolean; ok: boolean }[]) => ({
  hosts: [{ host: 'github.com', projects: [], provider: { name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts } }],
})
const CONNECTED = github([{ login: 'octo', runs: true, ok: true }])

beforeEach(() => {
  logins.onAgentState.mockResolvedValue({ driver: 'claude-code', ready: true })
  logins.onGitHosts.mockResolvedValue(CONNECTED)
  onAgentAccounts.mockResolvedValue({ accounts: [] })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  startAgent.start.mockReset()
  startAgent.busy = false
  startAgent.error = null
  updatePreferences.mockReset()
  takePendingDraft() // a draft left by one test would look like the next one's
})

/** Nothing set up: no project. One project's queue exists (empty), so the queue step is there. */
const EMPTY: DashboardData = {
  totals: { projects: 0, activeAgents: 0, openTodos: 0, totalAgents: 0 },
  projects: [],
  active: [],
  queue: [],
  activity: [],
  agentsByStatus: {},
} as unknown as DashboardData

/** One project registered, no tickets in it: the state the import step is offered in. */
const WITH_PROJECT: DashboardData = {
  ...EMPTY,
  totals: { projects: 1, activeAgents: 0, openTodos: 0, totalAgents: 0 },
  projects: [{ projectId: 'p1', hasTickets: false, providesTickets: true }],
} as unknown as DashboardData

const SHOP: ProjectSummary = { id: 'p1', path: '/home/ada/shop', name: 'shop', activated: true, gitHost: true }

const steps = ({ projects = [] as ProjectSummary[], onAgentStarted = vi.fn(), onSelectProject = vi.fn(), listedPages = [] as readonly ListedPage[] | null } = {}) =>
  render(<OnboardingChecklist projects={projects} onAgentStarted={onAgentStarted} onSelectProject={onSelectProject} onProjectAdded={vi.fn()} listedPages={listedPages} />)

/** A step's row, by its title. */
const row = (label: string) => screen.getByRole('listitem', { name: label })

/** Open a step that is not the next one: its title is the press. */
const openStep = async (label: string) => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label.replace(/[/]/g, '\\/')}`) }))

/** Open the tickets step, press its import, and wait for the start to have been attempted. */
const clickImport = async () => {
  await openStep('Populate the tickets')
  fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
  await waitFor(() => expect(startAgent.start).toHaveBeenCalled())
}

describe('the first steps on the Overview', () => {
  test('is named "Discover OpenAgent", and a count says where the steps stand', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    logins.onGitHosts.mockResolvedValue(github([]))
    steps()
    // A part's heading like every other, the count beside it as every part's count stands.
    const heading = await screen.findByRole('heading', { level: 2, name: 'Discover OpenAgent 1 of 3' })
    expect(heading.className).toContain('text-sm')
    expect(within(heading).getByText('1 of 3').className).toContain('font-normal')
    expect(await screen.findByRole('list', { name: '1 of 3 done' })).toBeTruthy()
  })

  test.each(['dashboard', 'agent', 'hosts'])('says "Loading…" and no step until the projects, the coding agents and the git hosts are read: %s answers last', async last => {
    // Each read is asked once or more (each coding agent is): an answer goes to every asker.
    const askers: Record<string, ((value: unknown) => void)[]> = {}
    const answers: Record<string, (value: unknown) => void> = { dashboard: value => askers['dashboard']!.forEach(to => to(value)), agent: value => askers['agent']!.forEach(to => to(value)), hosts: value => askers['hosts']!.forEach(to => to(value)) }
    const held = (name: string) => () => new Promise(resolve => (askers[name] ??= []).push(resolve))
    onDashboard.mockImplementation(held('dashboard'))
    logins.onAgentState.mockImplementation(held('agent'))
    logins.onGitHosts.mockImplementation(held('hosts'))
    const values: Record<string, unknown> = { dashboard: WITH_PROJECT, agent: { driver: 'claude-code', ready: true }, hosts: CONNECTED }
    steps()
    expect(await screen.findByText('Loading…')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toEqual([])
    await act(async () => {
      for (const name of Object.keys(values)) if (name !== last) answers[name]!(values[name])
    })
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toEqual([])
    await act(async () => answers[last]!(values[last]))
    expect(within(row('Add your first project')).getByLabelText('Done')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  test('while it reads, the card draws a row per step it knows of once the coding agents and the git hosts are read, so no row is pushed by a step they add', async () => {
    onDashboard.mockImplementation(() => new Promise(() => {}))
    const asked: ((value: unknown) => void)[] = []
    const agent = (value: unknown): void => asked.forEach(to => to(value))
    logins.onAgentState.mockImplementation(() => new Promise(resolve => asked.push(resolve)))
    steps()
    await screen.findByText('Loading…')
    expect(document.querySelector('ol')).toBeNull()
    await act(async () => agent({ driver: 'claude-code', ready: false, installed: false }))
    await screen.findByText('Loading…')
    const frame = document.querySelector('ol[aria-hidden="true"]')
    const rows = [...(frame?.children ?? [])].map(item => item.querySelector('span.text-sm')?.textContent)
    expect(rows[0]).toBe('Connect a coding agent')
    expect(rows).toContain('Add your first project')
  })

  test("while it reads, the queue's and the tickets' steps hold a place each exactly where the sidebar's pages say a project has the Queue or the Tickets, and no frame is drawn before the pages are known", async () => {
    onDashboard.mockImplementation(() => new Promise(() => {}))
    logins.onAgentState.mockResolvedValue({ driver: 'claude-code', ready: false, installed: false })
    const frame = async (listedPages: readonly ListedPage[] | null) => {
      steps({ projects: [SHOP], listedPages })
      await waitFor(() => expect(document.querySelector('ol[aria-hidden="true"]')).toBeTruthy())
      const rows = [...document.querySelector('ol[aria-hidden="true"]')!.children].map(item => item.querySelector('span.text-sm')?.textContent ?? 'a place')
      cleanup()
      return rows
    }
    // No page known yet: the frame waits for them, as nothing under it is drawn before it.
    steps({ projects: [SHOP], listedPages: null })
    await screen.findByText('Loading…')
    await act(async () => {})
    expect(document.querySelector('ol')).toBeNull()
    cleanup()
    const none = await frame([{ id: 'logs', label: 'Logs', projects: ['p1'] }])
    expect(none).not.toContain('a place')
    expect(none.at(-1)).toBe('Add your first project')
    const queue = await frame([{ id: 'queue', label: 'Queue', projects: ['p1'] }, { id: 'logs', label: 'Logs', projects: ['p1'] }])
    expect(queue).toEqual([...none, 'a place'])
    const both = await frame([{ id: 'queue', label: 'Queue', projects: ['p1'] }, { id: 'tickets', label: 'Tickets', projects: ['p1'] }])
    expect(both).toEqual([...none, 'a place', 'a place'])
  })

  test('what adding a project does is behind an ⓘ beside the open step, not in its way', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    steps()
    await waitFor(() => expect(row('Add your first project').getAttribute('aria-current')).toBe('step'))
    expect(row('Add your first project').textContent).not.toContain('makes no commit on your branch')
    const info = within(row('Add your first project')).getByRole('button', { name: 'More on Add your first project' })
    fireEvent.focus(info)
    fireEvent.mouseEnter(info)
    await waitFor(() => expect(document.body.textContent).toContain('makes no commit on your branch and pushes nothing'))
  })

  test('the account is added in a dialog: its code is shown there, and Cancel gives the login up', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    logins.sendStopGitHostLogin.mockResolvedValue({ ok: true })
    logins.sendGitHostLogin.mockResolvedValue({ ok: true, code: 'ABCD-1234', url: 'https://github.com/login/device' })
    logins.onGitHosts.mockResolvedValue(github([]))
    steps()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a GitHub account' }))
    logins.onGitHosts.mockResolvedValue({ hosts: [{ ...github([]).hosts[0]!, provider: { ...github([]).hosts[0]!.provider, loggingIn: { code: 'ABCD-1234', url: 'https://github.com/login/device' } } }] })
    const dialog = await screen.findByRole('dialog', { name: 'Add a GitHub account' })
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy()
    logins.onGitHosts.mockResolvedValue(github([]))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(logins.sendStopGitHostLogin).toHaveBeenCalledWith('github.com'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Add a GitHub account' })).toBeTruthy()
  })

  test('one step open at a time, numbered: the next to do with its words and its press; the others only their titles, each a press from open', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    logins.onGitHosts.mockResolvedValue(github([]))
    steps()
    await waitFor(() => expect(row('Connect GitHub').getAttribute('aria-current')).toBe('step'))
    expect(within(row('Connect GitHub')).getByText(/an account of its own, never your own login/)).toBeTruthy()
    expect(within(row('Connect GitHub')).getByRole('button', { name: 'Add a GitHub account' })).toBeTruthy()
    // Numbers, not boxes: a box invites a click that can tick nothing.
    expect(within(row('Add your first project')).getByText('3')).toBeTruthy()
    expect(within(row('Add your first project')).queryByRole('combobox', { name: 'Add a project' })).toBeNull()

    await openStep('Add your first project')
    expect(row('Add your first project').getAttribute('aria-current')).toBe('step')
    expect(within(row('Add your first project')).getByRole('combobox', { name: 'Add a project' })).toBeTruthy()
    expect(within(row('Connect GitHub')).queryByRole('button', { name: 'Add a GitHub account' })).toBeNull()
  })

  test('a step done stays, one line with a ✓ and what was done: the account, the project', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    steps({ projects: [SHOP] })
    await waitFor(() => expect(within(row('Connect GitHub')).getByLabelText('Done')).toBeTruthy())
    expect(within(row('Connect GitHub')).getByText('@octo')).toBeTruthy()
    expect(within(row('Add your first project')).getByText('shop')).toBeTruthy()
  })

  test('the first step connects a coding agent, a press an agent, Claude the primary; one whose program is missing is installed first', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    logins.onAgentState.mockImplementation(async (driver: string) =>
      driver === 'codex'
        ? { driver: 'codex', ready: false, problem: '`codex` not found', fix: { kind: 'install', command: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' } }
        : { driver: 'claude-code', ready: false, problem: '`claude` is not logged in.', fix: { kind: 'log-in', command: 'claude auth login' } },
    )
    steps({ projects: [SHOP] })
    await waitFor(() => expect(row('Connect a coding agent').getAttribute('aria-current')).toBe('step'))
    const step = within(row('Connect a coding agent'))
    expect(step.getByText(/Sessions run on Claude Code or Codex/)).toBeTruthy()
    expect(step.getByRole('button', { name: 'Connect claude' }).getAttribute('data-primary')).toBe('true')
    // No "Log this computer in": the press is the window an account is added in.
    expect(step.queryByRole('button', { name: /Log this computer in/ })).toBeNull()
    expect(step.getByRole('button', { name: 'Install Codex' })).toBeTruthy()
    expect(step.queryByRole('button', { name: 'Connect codex' })).toBeNull()
  })

  test('it is done once either agent has an account, and says which and whose; the agents are read again after a sign-in', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    logins.onGitHosts.mockResolvedValue(github([]))
    let connected = false
    logins.onAgentState.mockImplementation(async (driver: string) => ({ driver, ready: connected && driver === 'claude-code' }))
    onAgentAccounts.mockImplementation(async (agent: string) => ({ accounts: agent === 'claude' ? [{ id: 'ada', name: 'Ada', own: false, windows: [] }] : [] }))
    steps()
    const press = await screen.findByRole('button', { name: 'Connect claude' })
    connected = true
    fireEvent.click(press)
    await waitFor(() => expect(within(row('Connect a coding agent')).getByLabelText('Done')).toBeTruthy())
    expect(within(row('Connect a coding agent')).getByText('Claude · Ada')).toBeTruthy()
    expect(row('Connect GitHub').getAttribute('aria-current')).toBe('step')
  })

  test('the steps nothing breaks without are marked optional, and the essentials are not', async () => {
    onDashboard.mockResolvedValue({ ...WITH_PROJECT, queue: [{ projectId: 'p1', projectName: 'shop', entries: [] }] } as unknown as DashboardData)
    steps({ projects: [SHOP] })
    await waitFor(() => expect(row('Populate the tickets')).toBeTruthy())
    expect(within(row('Populate the tickets')).getByText('Optional')).toBeTruthy()
    expect(within(row('Populate the queue of AI tasks')).queryByText('Optional')).toBeNull()
  })

  test('the queue step opens the Queue page, where its entries are added', async () => {
    onDashboard.mockResolvedValue({ ...WITH_PROJECT, queue: [{ projectId: 'p1', projectName: 'shop', entries: [] }] } as unknown as DashboardData)
    const openPage = vi.fn()
    render(
      <HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openPage }}>
        <OnboardingChecklist projects={[SHOP]} onAgentStarted={vi.fn()} onSelectProject={vi.fn()} onProjectAdded={vi.fn()} listedPages={null} />
      </HostServicesContext.Provider>,
    )
    await openStep('Populate the queue of AI tasks')
    const press = within(row('Populate the queue of AI tasks')).getByRole('link', { name: 'Open the Queue' })
    expect(press.getAttribute('href')).toBe('/queue')
    // A click with a key held is the browser's: a new tab, a new window.
    fireEvent.click(press, { ctrlKey: true })
    expect(openPage).not.toHaveBeenCalled()
    fireEvent.click(press)
    expect(openPage).toHaveBeenCalledWith('queue')
  })

  test('the queue step is there only while some project has a queue at all, the tickets step only while some project provides tickets (#1774)', async () => {
    onDashboard.mockResolvedValue({ ...WITH_PROJECT, projects: [{ projectId: 'p1', hasTickets: false, providesTickets: false }] } as DashboardData)
    // A step still open, so the card is there.
    logins.onGitHosts.mockResolvedValue(github([]))
    steps({ projects: [SHOP] })
    await waitFor(() => expect(row('Add your first project')).toBeTruthy())
    expect(screen.queryByRole('listitem', { name: 'Populate the queue of AI tasks' })).toBeNull()
    expect(screen.queryByRole('listitem', { name: 'Populate the tickets' })).toBeNull()
  })

  test('with every step done it is gone: the box under it is how a session starts', async () => {
    onDashboard.mockResolvedValue({ ...WITH_PROJECT, projects: [{ projectId: 'p1', hasTickets: false, providesTickets: false }] } as DashboardData)
    const { container } = steps({ projects: [SHOP] })
    await waitFor(() => expect(onDashboard).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByRole('button', { name: 'Start your first session' })).toBeNull()
  })

  test('an optional step still open keeps it: only every step done takes it away', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    steps({ projects: [SHOP] })
    expect(await screen.findByRole('heading', { level: 2, name: 'Discover OpenAgent 3 of 4' })).toBeTruthy()
  })

  test('with no project yet, there is no import to offer: no project provides tickets', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    steps()
    await waitFor(() => expect(row('Add your first project')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Update tickets' })).toBeNull()
  })
})

describe('the tickets import lands on the session it starts (#1169)', () => {
  test('the started run id is handed up, with the project it runs in', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    startAgent.start.mockResolvedValue({ agentId: 'run-7' })
    const onAgentStarted = vi.fn()
    steps({ projects: [SHOP], onAgentStarted })
    await clickImport()

    // The project travels with it: this surface has none selected, so an id alone cannot be routed.
    // The prompt is the project's own command: OpenAgent ships no prompt text.
    expect(startAgent.start).toHaveBeenCalledWith('p1', '/update-tickets', {})
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('p1', '/update-tickets', 'run-7'))
  })

  test('a project with no worktree hands up no id, so the shell can adopt the running one', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    startAgent.start.mockResolvedValue({})
    const onAgentStarted = vi.fn()
    steps({ projects: [SHOP], onAgentStarted })
    await clickImport()

    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('p1', '/update-tickets', undefined))
  })

  test('a refused start says why and moves you nowhere', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    startAgent.start.mockResolvedValue(undefined)
    startAgent.error = 'A session is already active for this project.'
    const onAgentStarted = vi.fn()
    steps({ projects: [SHOP], onAgentStarted })
    await clickImport()

    expect(await screen.findByText(/already active/i)).toBeTruthy()
    expect(onAgentStarted).not.toHaveBeenCalled()
  })

  test('Configure first opens the launcher of the project the step acts on (#1507)', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    const onSelectProject = vi.fn()
    steps({ projects: [SHOP], onSelectProject })
    await openStep('Populate the tickets')
    await configureFirst('Other ways to update the tickets')
    // The launcher, not an agent — the model and where it runs are nowhere on these steps.
    await waitFor(() => expect(onSelectProject).toHaveBeenCalledWith('p1'))
    expect(startAgent.start).not.toHaveBeenCalled()
    expect(takePendingDraft()).toBe('/update-tickets')
  })
})
