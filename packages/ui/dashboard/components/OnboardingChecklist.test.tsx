import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import type { DashboardData, ProjectSummary } from '../../src/index.js'
import type { Attention } from '@openagt/hooks'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'

// The first steps read their state over several RPC stubs and hooks; stub them all so nothing
// reaches for a daemon and each step's "done" comes from a fixture instead.
const onDashboard = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDashboard }))
const onAttention = vi.hoisted(() => vi.fn())
vi.mock('../rpc/attention.js', () => ({ onAttention }))
vi.mock('../rpc/projects.js', () => ({ onRepos: vi.fn(async () => ({ repos: [], hosted: [], reposLoading: false, hostedLoading: false, canAddFolder: false })), sendAddRepoFolder: vi.fn(), sendAddProject: vi.fn(), sendPickProjectDirectory: vi.fn(), onCloneTarget: vi.fn(), sendAddProjectFromAddress: vi.fn() }))
vi.mock('../rpc/person.js', () => ({ onPerson: vi.fn(async () => ({ name: 'Ada Lovelace' })) }))
const updatePreferences = vi.hoisted(() => vi.fn())
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => ({}),
  updatePreferences,
}))
const logins = vi.hoisted(() => ({ onGitHosts: vi.fn(), sendGitHostInstall: vi.fn(), sendGitHostLogin: vi.fn(), sendStopGitHostLogin: vi.fn(), sendUseGitHostAccount: vi.fn() }))
vi.mock('../rpc/logins.js', () => logins)
/** A module's item about this computer, with the press its package fixes it with. */
const CONNECT_AGENT = { module: '@openagt/agent-driver', kind: 'setup', scope: 'computer', id: 'connect', words: 'Connect a coding agent', detail: 'Sessions run on a coding agent, with your own account.', fix: { label: 'Connect a coding agent…', href: '/permissions' } }

const { OnboardingChecklist } = await import('./OnboardingChecklist.js')

const github = (accounts: { login: string; runs: boolean; ok: boolean }[]) => ({
  hosts: [{ host: 'github.com', projects: [], provider: { name: 'GitHub', requestWord: 'pull request', logo: '<svg/>', tool: 'gh', installed: true, install: 'brew install gh', accounts } }],
})
const CONNECTED = github([{ login: 'octo', runs: true, ok: true }])

beforeEach(() => {
  logins.onGitHosts.mockResolvedValue(CONNECTED)
  onAttention.mockResolvedValue({ items: [], whole: true })
})

afterEach(() => {
  cleanup()
  forgetRemembered()
  updatePreferences.mockReset()
})

/** Nothing set up: no project. */
const EMPTY: DashboardData = { totals: { projects: 0 }, active: [] }

/** One project registered. */
const WITH_PROJECT: DashboardData = { ...EMPTY, totals: { projects: 1 } }

/** What a module says needs setting up on this computer, as the queue says its empty queue. */
const QUEUE_EMPTY: Attention = {
  module: 'queue',
  kind: 'setup',
  scope: 'computer',
  id: 'populate',
  words: 'Populate the queue of AI tasks',
  detail: 'The queue holds what agents work on next.',
  fix: { label: 'Open the Queue', href: '/queue' },
}

const SHOP: ProjectSummary = { id: 'p1', path: '/home/ada/shop', name: 'shop', activated: true, gitHost: true }

const steps = ({ projects = [] as ProjectSummary[] } = {}) => render(<OnboardingChecklist projects={projects} onProjectAdded={vi.fn()} />)

/** A step's row, by its title. */
const row = (label: string) => screen.getByRole('listitem', { name: label })

/** Open a step that is not the next one: its title is the press. */
const openStep = async (label: string) => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label.replace(/[/]/g, '\\/')}`) }))

describe('the first steps on the Overview', () => {
  test('is named "Discover OpenAgent", and a count says where the steps stand', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    logins.onGitHosts.mockResolvedValue(github([]))
    steps()
    // A part's heading like every other, the count beside it as every part's count stands.
    const heading = await screen.findByRole('heading', { level: 2, name: 'Discover OpenAgent 0 of 2' })
    expect(heading.className).toContain('text-sm')
    expect(within(heading).getByText('0 of 2').className).toContain('font-normal')
    expect(await screen.findByRole('list', { name: '0 of 2 done' })).toBeTruthy()
  })

  test.each(['dashboard', 'attention', 'hosts'])('says "Loading…" and no step until the projects, what the modules say and the git hosts are read: %s answers last', async last => {
    // Each read is asked once or more: an answer goes to every asker.
    const askers: Record<string, ((value: unknown) => void)[]> = {}
    const answers: Record<string, (value: unknown) => void> = { dashboard: value => askers['dashboard']!.forEach(to => to(value)), attention: value => askers['attention']!.forEach(to => to(value)), hosts: value => askers['hosts']!.forEach(to => to(value)) }
    const held = (name: string) => () => new Promise(resolve => (askers[name] ??= []).push(resolve))
    onDashboard.mockImplementation(held('dashboard'))
    onAttention.mockImplementation(held('attention'))
    logins.onGitHosts.mockImplementation(held('hosts'))
    // A module's step stays open, so the card stays once read.
    const values: Record<string, unknown> = { dashboard: WITH_PROJECT, attention: { items: [QUEUE_EMPTY], whole: true }, hosts: CONNECTED }
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

  test('while it reads, the card draws a row per step it knows of once what the modules say and the git hosts are read, so no row is pushed by a step they add', async () => {
    onDashboard.mockImplementation(() => new Promise(() => {}))
    const asked: ((value: unknown) => void)[] = []
    const answer = (value: unknown): void => asked.forEach(to => to(value))
    onAttention.mockImplementation(() => new Promise(resolve => asked.push(resolve)))
    steps()
    await screen.findByText('Loading…')
    expect(document.querySelector('ol')).toBeNull()
    await act(async () => answer({ items: [CONNECT_AGENT], whole: true }))
    await screen.findByText('Loading…')
    const frame = document.querySelector('ol[aria-hidden="true"]')
    const rows = [...(frame?.children ?? [])].map(item => item.querySelector('span.text-sm')?.textContent)
    expect(rows[0]).toBe('Connect a coding agent')
    expect(rows).toContain('Add your first project')
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
    onAttention.mockResolvedValue({ items: [QUEUE_EMPTY] })
    steps({ projects: [SHOP] })
    await waitFor(() => expect(within(row('Connect GitHub')).getByLabelText('Done')).toBeTruthy())
    expect(within(row('Connect GitHub')).getByText('@octo')).toBeTruthy()
    expect(within(row('Add your first project')).getByText('shop')).toBeTruthy()
  })

  test("a module's item about this computer is a step before the git hosts': its words, what it adds, and its fix's press", async () => {
    onDashboard.mockResolvedValue(EMPTY)
    logins.onGitHosts.mockResolvedValue(github([]))
    onAttention.mockResolvedValue({ items: [CONNECT_AGENT], whole: true })
    const openPage = vi.fn()
    render(
      <HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openPage }}>
        <OnboardingChecklist projects={[]} onProjectAdded={vi.fn()} />
      </HostServicesContext.Provider>,
    )
    await waitFor(() => expect(row('Connect a coding agent').getAttribute('aria-current')).toBe('step'))
    expect(screen.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['Connect a coding agent', 'Connect GitHub', 'Add your first project'])
    const step = within(row('Connect a coding agent'))
    expect(step.getByText('Sessions run on a coding agent, with your own account.')).toBeTruthy()
    fireEvent.click(step.getByRole('button', { name: 'Connect a coding agent…' }))
    expect(openPage).toHaveBeenCalledWith('permissions', [])
  })

  test('what a module says needs setting up on this computer is a step, with its words and its fix', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onAttention.mockResolvedValue({ items: [QUEUE_EMPTY] })
    const openPage = vi.fn()
    render(
      <HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openPage }}>
        <OnboardingChecklist projects={[SHOP]} onProjectAdded={vi.fn()} />
      </HostServicesContext.Provider>,
    )
    await waitFor(() => expect(row('Populate the queue of AI tasks').getAttribute('aria-current')).toBe('step'))
    expect(within(row('Populate the queue of AI tasks')).getByText('The queue holds what agents work on next.')).toBeTruthy()
    fireEvent.click(within(row('Populate the queue of AI tasks')).getByRole('button', { name: 'Open the Queue' }))
    expect(openPage).toHaveBeenCalledWith('queue', [])
    // Asked with no project: what this computer needs.
    expect(onAttention).toHaveBeenCalledWith(null, undefined)
  })

  test("only what this computer needs set up is a step: not what a project or a run needs, nor what waits on the person", async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onAttention.mockResolvedValue({ items: [{ ...QUEUE_EMPTY, scope: 'project', words: 'A project' }, { ...QUEUE_EMPTY, scope: 'run', words: 'A run' }, { ...QUEUE_EMPTY, kind: 'waiting', words: 'Waiting' }] })
    logins.onGitHosts.mockResolvedValue(github([]))
    steps({ projects: [SHOP] })
    await waitFor(() => expect(row('Add your first project')).toBeTruthy())
    expect(screen.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['Connect GitHub', 'Add your first project'])
  })

  test('with every step done it is gone: the box under it is how a session starts', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    const { container } = steps({ projects: [SHOP] })
    await waitFor(() => expect(onDashboard).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByRole('button', { name: 'Start your first session' })).toBeNull()
  })

  test("a module's step still open keeps it: only every step done takes it away", async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onAttention.mockResolvedValue({ items: [QUEUE_EMPTY] })
    steps({ projects: [SHOP] })
    expect(await screen.findByRole('heading', { level: 2, name: 'Discover OpenAgent 2 of 3' })).toBeTruthy()
  })
})
