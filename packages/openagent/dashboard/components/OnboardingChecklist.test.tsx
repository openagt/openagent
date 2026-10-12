import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DashboardData } from '../../src/index.js'
import { configureFirst } from '../test-utils.js'

// The checklist reads its state over several RPC stubs and hooks; stub them all so nothing reaches
// for a daemon and each row's "done" comes from a fixture instead.
const onDashboard = vi.hoisted(() => vi.fn())
const onOnboarding = vi.hoisted(() => vi.fn())
const sendAddProject = vi.hoisted(() => vi.fn())
const sendPickProjectDirectory = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDashboard }))
vi.mock('../rpc/projects.js', () => ({ onOnboarding, sendAddProject, sendPickProjectDirectory, onCloneTarget: vi.fn(), sendAddProjectFromAddress: vi.fn() }))
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => ({}),
  updatePreferences: vi.fn(),
  notificationsEnabled: () => false,
}))
vi.mock('../lib/notification-permission.js', () => ({ useNotificationPermission: () => 'default' }))
// One stable object, so a test can steer the start and its error without a re-mock.
const startAgent = vi.hoisted(() => ({ start: vi.fn(), busy: false, error: null as string | null }))
vi.mock('../lib/use-start-agent.js', async () => ({
  ...(await vi.importActual<typeof import('../lib/use-start-agent.js')>('../lib/use-start-agent.js')),
  useStartAgent: () => startAgent,
}))

const { OnboardingChecklist } = await import('./OnboardingChecklist.js')
const { takePendingDraft } = await import('../lib/draft-handoff.js')

afterEach(() => {
  cleanup()
  startAgent.start.mockReset()
  startAgent.busy = false
  startAgent.error = null
  sendAddProject.mockReset()
  sendPickProjectDirectory.mockReset()
  takePendingDraft() // a draft left by one test would look like the next one's
})

/** A board with nothing set up: every row is open, which is when the marks have to be readable.
 *  One project has a queue (empty), so the queue step is on the board. */
const EMPTY: DashboardData = {
  totals: { projects: 0, activeAgents: 0, openTodos: 0, totalAgents: 0 },
  projects: [],
  active: [],
  queue: [{ projectId: 'p1', projectName: 'alpha', entries: [] }],
  activity: [],
  agentsByStatus: {},
} as unknown as DashboardData

/** One project registered, no tickets in it: the state the import step is offered in. */
const WITH_PROJECT: DashboardData = {
  ...EMPTY,
  totals: { projects: 1, activeAgents: 0, openTodos: 0, totalAgents: 0 },
  projects: [{ projectId: 'p1', hasTickets: false, providesTickets: true }],
} as unknown as DashboardData

/** Click the import step and wait for the start to have been attempted. */
const clickImport = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Update tickets' }))
  await waitFor(() => expect(startAgent.start).toHaveBeenCalled())
}

describe('OnboardingChecklist (#1139)', () => {
  test('the steps nothing breaks without are marked optional, and the two essentials are not', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onOnboarding.mockResolvedValue(null)
    render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={() => {}} />)
    await waitFor(() => expect(screen.getByText('Add a project')).toBeTruthy())

    // Tickets and browser notifications are optional; adding a project and filling the queue are not.
    expect(screen.getAllByText('Optional')).toHaveLength(2)
    const marked = (label: string) => screen.getByText(label).querySelector('span')?.textContent === 'Optional'
    expect(marked('Add a project')).toBe(false)
    expect(marked('Populate the queue of AI tasks')).toBe(false)
    expect(marked('Populate tickets/')).toBe(true)
  })

  test('the queue step is on the board only while some project has a queue at all (#1774)', async () => {
    onDashboard.mockResolvedValue({ ...EMPTY, queue: [] } as DashboardData)
    onOnboarding.mockResolvedValue(null)
    render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={() => {}} />)
    await waitFor(() => expect(screen.getByText('Add a project')).toBeTruthy())
    expect(screen.queryByText('Populate the queue of AI tasks')).toBeNull()
  })

  test('the tickets step is on the board only while some project provides tickets at all (#1774)', async () => {
    onDashboard.mockResolvedValue({ ...WITH_PROJECT, projects: [{ projectId: 'p1', hasTickets: false, providesTickets: false }] } as DashboardData)
    onOnboarding.mockResolvedValue(null)
    render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={() => {}} />)
    await waitFor(() => expect(screen.getByText('Add a project')).toBeTruthy())
    expect(screen.queryByText('Populate tickets/')).toBeNull()
  })

  test('an unticked step is a checkbox, not a radio button', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    onOnboarding.mockResolvedValue(null)
    const { container } = render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={() => {}} />)
    await waitFor(() => expect(screen.getByText('Add a project')).toBeTruthy())
    // An outlined circle read as "pick one of these" when the rows are independent things to tick.
    expect(container.querySelector('circle')).toBeNull()
    expect(screen.getAllByLabelText('Not done').length).toBeGreaterThan(0)
  })
})

describe('the tickets import lands on the session it starts (#1169)', () => {
  test('the started run id is handed up, with the project it runs in', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onOnboarding.mockResolvedValue(null)
    startAgent.start.mockResolvedValue({ agentId: 'run-7' })
    const onAgentStarted = vi.fn()
    render(<OnboardingChecklist onAgentStarted={onAgentStarted} onSelectProject={() => {}} />)
    await clickImport()

    // The project travels with it: this surface has none selected, so an id alone cannot be routed.
    // The prompt is the project's own command: OpenAgent ships no prompt text.
    expect(startAgent.start).toHaveBeenCalledWith('p1', '/update-tickets', {})
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('p1', '/update-tickets', 'run-7'))
  })

  test('a project with no worktree hands up no id, so the shell can adopt the running one', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onOnboarding.mockResolvedValue(null)
    startAgent.start.mockResolvedValue({})
    const onAgentStarted = vi.fn()
    render(<OnboardingChecklist onAgentStarted={onAgentStarted} onSelectProject={() => {}} />)
    await clickImport()

    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledWith('p1', '/update-tickets', undefined))
  })

  test('a refused start says why and moves you nowhere', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onOnboarding.mockResolvedValue(null)
    startAgent.start.mockResolvedValue(undefined)
    startAgent.error = 'A session is already active for this project.'
    const onAgentStarted = vi.fn()
    render(<OnboardingChecklist onAgentStarted={onAgentStarted} onSelectProject={() => {}} />)
    await clickImport()

    expect(await screen.findByText(/already active/i)).toBeTruthy()
    expect(onAgentStarted).not.toHaveBeenCalled()
  })

  test('Configure first opens the launcher of the project the step acts on (#1507)', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onOnboarding.mockResolvedValue(null)
    const onSelectProject = vi.fn()
    render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={onSelectProject} />)
    await configureFirst('Other ways to update the tickets')
    // The launcher, not an agent — the model and where it runs are nowhere on this checklist.
    await waitFor(() => expect(onSelectProject).toHaveBeenCalledWith('p1'))
    expect(startAgent.start).not.toHaveBeenCalled()
    expect(takePendingDraft()).toBe('/update-tickets')
  })

  test('"Add <folder> as project\u2026" adds nothing itself: it opens the Add dialog on that folder, which asks first', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    onOnboarding.mockResolvedValue({ cwd: '/Users/dev/here', cwdProjectId: null })
    sendAddProject.mockResolvedValue({ ok: true, alreadyActivated: false })
    render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add /Users/dev/here as project\u2026' }))
    // The dialog, on the folder the dashboard runs in: no system dialog, and nothing added yet.
    expect(screen.getByRole('dialog', { name: 'Add project' })).toBeTruthy()
    expect(screen.getByText('/Users/dev/here')).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Keep them on this machine/ }) as HTMLInputElement).checked).toBe(true)
    expect(sendPickProjectDirectory).not.toHaveBeenCalled()
    expect(sendAddProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'I trust it, add it' }))
    await waitFor(() => expect(sendAddProject).toHaveBeenCalledWith('/Users/dev/here', false))
  })

  test('before anything is pressed, the first step says what adding a project does to the folder; once a project is added it says only what a project is', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    onOnboarding.mockResolvedValue({ cwd: '/Users/dev/here', cwdProjectId: null })
    const { container } = render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={vi.fn()} />)
    await screen.findByRole('button', { name: 'Add /Users/dev/here as project\u2026' })
    await waitFor(() => expect(container.textContent).toContain('makes no commit on your branch and pushes nothing'))
    expect(container.textContent).toContain('A folder with no git, or a repository with no commit yet, gets one empty first commit.')
    expect(sendAddProject).not.toHaveBeenCalled()
    cleanup()

    onDashboard.mockResolvedValue(WITH_PROJECT)
    onOnboarding.mockResolvedValue({ cwd: '/Users/dev/here', cwdProjectId: 'p1' })
    const added = render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={vi.fn()} />)
    await waitFor(() => expect(added.container.textContent).toContain('A project is a git repo OpenAgent may work in.'))
    expect(added.container.textContent).not.toContain('makes no commit on your branch')
  })

  test('a folder that is already a project is not offered again', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onOnboarding.mockResolvedValue({ cwd: '/Users/dev/here', cwdProjectId: 'p1' })
    render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add a project')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /as project/ })).toBeNull()
  })

  test('with no project yet, there is no import to offer: no project provides tickets', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    onOnboarding.mockResolvedValue(null)
    render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add a project')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Update tickets' })).toBeNull()
  })

  test('the project step offers the folder dialog only on a computer that has a screen, and a repository\u2019s address on every one', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    onOnboarding.mockResolvedValue({ cwd: null, cwdProjectId: null, canPickFolder: false })
    const { unmount } = render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={() => {}} />)
    const byAddress = await screen.findByRole('button', { name: 'Add from a GitHub address' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Select & add project directory' })).toBeNull())
    expect(screen.queryByRole('button', { name: /as project…$/ })).toBeNull()
    fireEvent.click(byAddress)
    expect(screen.getByRole('dialog', { name: 'Add project' }).textContent).toContain('Add project from a GitHub address')
    expect(sendPickProjectDirectory).not.toHaveBeenCalled()
    unmount()

    onOnboarding.mockResolvedValue({ cwd: '/Users/dev/app', cwdProjectId: null, canPickFolder: true })
    render(<OnboardingChecklist onAgentStarted={vi.fn()} onSelectProject={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Add /Users/dev/app as project…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Select & add project directory' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add from a GitHub address' })).toBeTruthy()
  })
})
