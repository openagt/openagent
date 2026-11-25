import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '../lib/use-async.js'
import type { DashboardData } from '../../src/index.js'
import type { Attention } from '@openagt/hooks'
import { HostServicesContext, INERT_HOST_SERVICES } from '../lib/host-services.js'

// The first steps read their state over several RPC stubs and hooks; stub them all so nothing
// reaches for a daemon and each step comes from a fixture instead.
const onDashboard = vi.hoisted(() => vi.fn())
vi.mock('../rpc/reads.js', () => ({ onDashboard }))
const onAttention = vi.hoisted(() => vi.fn())
vi.mock('../rpc/attention.js', () => ({ onAttention }))
vi.mock('../rpc/person.js', () => ({ onPerson: vi.fn(async () => ({ name: 'Ada Lovelace' })) }))
const updatePreferences = vi.hoisted(() => vi.fn())
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => ({}),
  updatePreferences,
}))
/** A module's item about this computer, with the press its package fixes it with. */
const CONNECT_AGENT = { module: '@openagt/agent-driver', kind: 'setup', scope: 'computer', id: 'connect', words: 'Connect a coding agent', detail: 'Sessions run on a coding agent, with your own account.', fix: { label: 'Connect a coding agent…', href: '/permissions' } }
/** The projects module's item while this computer has no project yet. */
const NO_PROJECT_YET = { module: 'projects', kind: 'setup', scope: 'computer', id: 'no-project', words: 'Add your first project', detail: 'A git repo your agents work in, each in its own copy and on its own branch. Your files and your branch stay as they are.', fix: { label: 'Add a project', action: 'add-project' } }

const { OnboardingChecklist } = await import('./OnboardingChecklist.js')

/** What github says while OpenAgent has no GitHub account: a step, its fix a link here. */
const CONNECT_GITHUB = { module: 'github', kind: 'setup', scope: 'computer', id: 'no-account', words: 'Connect GitHub', detail: 'OpenAgent pushes and opens pull requests with an account of its own, never your own login.', fix: { label: 'Add a GitHub account', href: '/permissions' } }

beforeEach(() => {
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

const steps = () => render(<OnboardingChecklist />)

/** A step's row, by its title. */
const row = (label: string) => screen.getByRole('listitem', { name: label })

/** Open a step that is not the next one: its title is the press. */
const openStep = async (label: string) => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label.replace(/[/]/g, '\\/')}`) }))

describe('the first steps on the Overview', () => {
  test('is named "Discover OpenAgent", and a count says how many steps are left', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    onAttention.mockResolvedValue({ items: [NO_PROJECT_YET, CONNECT_GITHUB], whole: true })
    steps()
    // A part's heading like every other, the count beside it as every part's count stands.
    const heading = await screen.findByRole('heading', { level: 2, name: 'Discover OpenAgent 2' })
    expect(heading.className).toContain('text-sm')
    expect(within(heading).getByText('2').className).toContain('font-normal')
    expect(await screen.findByRole('list', { name: '2 steps left' })).toBeTruthy()
  })

  test.each(['dashboard', 'attention'])('says "Loading…" and no step until the projects and what the modules say are read: %s answers last', async last => {
    // Each read is asked once or more: an answer goes to every asker.
    const askers: Record<string, ((value: unknown) => void)[]> = {}
    const answers: Record<string, (value: unknown) => void> = { dashboard: value => askers['dashboard']!.forEach(to => to(value)), attention: value => askers['attention']!.forEach(to => to(value)) }
    const held = (name: string) => () => new Promise(resolve => (askers[name] ??= []).push(resolve))
    onDashboard.mockImplementation(held('dashboard'))
    onAttention.mockImplementation(held('attention'))
    // A module's step stays open, so the card stays once read.
    const values: Record<string, unknown> = { dashboard: WITH_PROJECT, attention: { items: [QUEUE_EMPTY], whole: true } }
    steps()
    expect(await screen.findByText('Loading…')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toEqual([])
    await act(async () => {
      for (const name of Object.keys(values)) if (name !== last) answers[name]!(values[name])
    })
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toEqual([])
    await act(async () => answers[last]!(values[last]))
    expect(row('Populate the queue of AI tasks')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  test('while it reads, the card draws a row per step it knows of once what the modules say is read, so no row is pushed by a step they add', async () => {
    onDashboard.mockImplementation(() => new Promise(() => {}))
    const asked: ((value: unknown) => void)[] = []
    const answer = (value: unknown): void => asked.forEach(to => to(value))
    onAttention.mockImplementation(() => new Promise(resolve => asked.push(resolve)))
    steps()
    await screen.findByText('Loading…')
    expect(document.querySelector('ol')).toBeNull()
    await act(async () => answer({ items: [CONNECT_AGENT, NO_PROJECT_YET], whole: true }))
    await screen.findByText('Loading…')
    const frame = document.querySelector('ol[aria-hidden="true"]')
    const rows = [...(frame?.children ?? [])].map(item => item.querySelector('span.text-sm')?.textContent)
    expect(rows).toEqual(['Connect a coding agent', 'Add your first project'])
  })

  test('one step open at a time, numbered: the next to do with its words and its press; the others only their titles, each a press from open', async () => {
    onDashboard.mockResolvedValue(EMPTY)
    onAttention.mockResolvedValue({ items: [NO_PROJECT_YET, CONNECT_GITHUB], whole: true })
    steps()
    await waitFor(() => expect(row('Add your first project').getAttribute('aria-current')).toBe('step'))
    expect(within(row('Add your first project')).getByText(/A git repo your agents work in/)).toBeTruthy()
    // Numbers, not boxes: a box invites a click that can tick nothing.
    expect(within(row('Connect GitHub')).getByText('2')).toBeTruthy()
    expect(within(row('Connect GitHub')).queryByRole('button', { name: 'Add a GitHub account' })).toBeNull()

    await openStep('Connect GitHub')
    expect(row('Connect GitHub').getAttribute('aria-current')).toBe('step')
    expect(within(row('Connect GitHub')).getByText(/an account of its own, never your own login/)).toBeTruthy()
    expect(within(row('Connect GitHub')).getByRole('button', { name: 'Add a GitHub account' })).toBeTruthy()
    expect(within(row('Add your first project')).queryByText(/A git repo your agents work in/)).toBeNull()
  })

  test("a module's item about this computer is a step, in the modules' order: its words, what it adds, and its fix's press", async () => {
    onDashboard.mockResolvedValue(EMPTY)
    onAttention.mockResolvedValue({ items: [CONNECT_AGENT, CONNECT_GITHUB], whole: true })
    const openPage = vi.fn()
    render(
      <HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openPage }}>
        <OnboardingChecklist />
      </HostServicesContext.Provider>,
    )
    await waitFor(() => expect(row('Connect a coding agent').getAttribute('aria-current')).toBe('step'))
    expect(screen.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['Connect a coding agent', 'Connect GitHub'])
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
        <OnboardingChecklist />
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
    onAttention.mockResolvedValue({ items: [CONNECT_GITHUB, { ...QUEUE_EMPTY, scope: 'project', words: 'A project' }, { ...QUEUE_EMPTY, scope: 'run', words: 'A run' }, { ...QUEUE_EMPTY, kind: 'waiting', words: 'Waiting' }] })
    steps()
    await waitFor(() => expect(row('Connect GitHub')).toBeTruthy())
    expect(screen.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['Connect GitHub'])
  })

  test('with no step left it is gone: the box under it is how a session starts', async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    const { container } = steps()
    await waitFor(() => expect(onDashboard).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByRole('button', { name: 'Start your first session' })).toBeNull()
  })

  test("a module's step left keeps it", async () => {
    onDashboard.mockResolvedValue(WITH_PROJECT)
    onAttention.mockResolvedValue({ items: [QUEUE_EMPTY] })
    steps()
    expect(await screen.findByRole('heading', { level: 2, name: 'Discover OpenAgent 1' })).toBeTruthy()
  })
})
