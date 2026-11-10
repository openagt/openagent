import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import type { DashboardData, ProjectSummary } from '../../src/index.js'
import { configureFirst } from '../test-utils.js'

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
  notificationsEnabled: () => false,
}))
vi.mock('../lib/notification-permission.js', () => ({ useNotificationPermission: () => 'default' }))
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), onAgentState: vi.fn(), sendAgentFix: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
// One stable object, so a test can steer the start and its error without a re-mock.
const startAgent = vi.hoisted(() => ({ start: vi.fn(), busy: false, error: null as string | null }))
vi.mock('../lib/use-start-agent.js', async () => ({
  ...(await vi.importActual<typeof import('../lib/use-start-agent.js')>('../lib/use-start-agent.js')),
  useStartAgent: () => startAgent,
}))

const { OnboardingChecklist, greeting } = await import('./OnboardingChecklist.js')
const { takePendingDraft } = await import('../lib/draft-handoff.js')

const github = (accounts: { login: string; runs: boolean; ok: boolean }[]) => ({
  hosts: [{ host: 'github.com', projects: [], provider: { name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts } }],
})
const CONNECTED = github([{ login: 'octo', runs: true, ok: true }])

beforeEach(() => {
  logins.onAgentState.mockResolvedValue({ driver: 'claude-code', ready: true })
  logins.onGitHosts.mockResolvedValue(CONNECTED)
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

const steps = ({ projects = [] as ProjectSummary[], onAgentStarted = vi.fn(), onSelectProject = vi.fn() } = {}) =>
  render(<OnboardingChecklist projects={projects} onAgentStarted={onAgentStarted} onSelectProject={onSelectProject} onProjectAdded={vi.fn()} />)

/** A step's row, by its title. */
const row = (label: string) => screen.getByRole('listitem', { name: label })

/** Open a step that is not the next one: its title is the press. */
const openStep = async (label: string) => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label.replace(/[/]/g, '\\/')}`) }))

/** Open the tickets step, press its import, and wait for the start to have been attempted. */
const clickImport = async () => {
  await openStep('Populate tickets/')
  fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
  await waitFor(() => expect(startAgent.start).toHaveBeenCalled())
}

describe('the greeting', () => {
  test('by the time of day: morning until noon, afternoon until six, then evening', () => {
    expect(greeting(8)).toBe('Good morning')
    expect(greeting(13)).toBe('Good afternoon')
    expect(greeting(20)).toBe('Good evening')
    expect(greeting(2)).toBe('Good evening')
  })
})

describe('the first steps on the Overview', () => {
  test('greets the person, and a dash a step says where they stand', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    logins.onGitHosts.mockResolvedValue(github([]))
    steps()
    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Ada$/ })).toBeTruthy()
    expect(await screen.findByRole('list', { name: '0 of 3 done' })).toBeTruthy()
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
    expect(within(row('Add your first project')).getByText('2')).toBeTruthy()
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
    expect(within(row('Connect GitHub')).getByText('· @octo')).toBeTruthy()
    expect(within(row('Add your first project')).getByText('· shop')).toBeTruthy()
  })

  test('the coding agent, while it is missing, is a step of its own with its press', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    logins.onAgentState.mockResolvedValue({ driver: 'claude-code', ready: false, problem: '`claude` not found', fix: { kind: 'install', command: 'curl -fsSL https://claude.ai/install.sh | bash' } })
    steps({ projects: [SHOP] })
    await waitFor(() => expect(row('Set up Claude Code').getAttribute('aria-current')).toBe('step'))
    expect(within(row('Set up Claude Code')).getByText('Claude Code is not installed.')).toBeTruthy()
    expect(within(row('Set up Claude Code')).getByRole('button', { name: 'Install Claude Code' })).toBeTruthy()
  })

  test('the steps nothing breaks without are marked optional, and the essentials are not', async () => {
    onDashboard.mockResolvedValue({ ...WITH_PROJECT, queue: [{ projectId: 'p1', projectName: 'shop', entries: [] }] } as unknown as DashboardData)
    steps({ projects: [SHOP] })
    await waitFor(() => expect(row('Populate tickets/')).toBeTruthy())
    expect(within(row('Populate tickets/')).getByText('Optional')).toBeTruthy()
    expect(within(row('Turn on notifications')).getByText('Optional')).toBeTruthy()
    expect(within(row('Populate the queue of AI tasks')).queryByText('Optional')).toBeNull()
  })

  test('the queue step is there only while some project has a queue at all, the tickets step only while some project provides tickets (#1774)', async () => {
    onDashboard.mockResolvedValue({ ...WITH_PROJECT, projects: [{ projectId: 'p1', hasTickets: false, providesTickets: false }] } as DashboardData)
    steps({ projects: [SHOP] })
    await waitFor(() => expect(row('Turn on notifications')).toBeTruthy())
    expect(screen.queryByRole('listitem', { name: 'Populate the queue of AI tasks' })).toBeNull()
    expect(screen.queryByRole('listitem', { name: 'Populate tickets/' })).toBeNull()
  })

  test('every step a session needs done: it says so, and its press starts the first session, the steps put away', async () => {
    onDashboard.mockResolvedValue({ ...WITH_PROJECT, projects: [{ projectId: 'p1', hasTickets: false, providesTickets: false }] } as DashboardData)
    const onSelectProject = vi.fn()
    steps({ projects: [SHOP], onSelectProject })
    expect(await screen.findByRole('heading', { name: "You're all set, Ada" })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start your first session' }))
    expect(onSelectProject).toHaveBeenCalledWith('p1')
    expect(updatePreferences).toHaveBeenCalledWith({ onboardingDismissed: true })
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
    await openStep('Populate tickets/')
    await configureFirst('Other ways to update the tickets')
    // The launcher, not an agent — the model and where it runs are nowhere on these steps.
    await waitFor(() => expect(onSelectProject).toHaveBeenCalledWith('p1'))
    expect(startAgent.start).not.toHaveBeenCalled()
    expect(takePendingDraft()).toBe('/update-tickets')
  })
})
