import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueueCard } from './QueueCard.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../../ui/dashboard/lib/host-services.js'
import { mountedOf, type MountedModules } from '@openagt/ui/module/testing'
import { fakeHost, placed, renderWithHost, type FakeHost } from './test-host.js'
import { workOnEntryPrompt } from '../src/module.js'
import { configureFirst } from '../../ui/dashboard/test-utils.js'

// The card on the Overview, rendered from nothing but this package: a host answering the queue
// command, and no other module mounted. A queued ticket is a link into a repository the card has
// no page for, so it reads as text: the card names no tickets package.

const alpha = { id: 'p1', name: 'alpha', remote: 'github.com/me/project' }
const beta = { id: 'p2', name: 'beta', remote: 'github.com/me/project' }
const LOGIN = '[Login page](tickets/2026-08-01_login-page.md)'
const UPSTREAM = '[Upstream bug](https://github.com/x/y/issues/1)'

let host: FakeHost
const render = (answers: Record<string, string[]> = {}) => {
  host = fakeHost(Object.fromEntries(Object.entries(answers).map(([id, entries]) => [id, placed(...entries)])))
  return renderWithHost(<QueueCard projects={[alpha, beta]} />, host)
}
/** The starts the host was asked for: `[projectId, prompt, opts]` each. */
const started = () => host.startRun.mock.calls.map(([projectId, prompt, opts]) => [projectId, prompt, opts])

afterEach(cleanup)

describe('QueueCard', () => {
  test('lists every project with open entries from `queue --local`, counted as the Queue page counts them, and leaves out a project with none', async () => {
    render({ p1: [LOGIN, 'Tidy the loader'], p2: [] })
    expect(await screen.findByText('Login page')).toBeTruthy()
    expect(screen.getByText('Tidy the loader')).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('All 2 waiting')).toBeTruthy()
    expect(screen.queryByText('beta')).toBeNull()
    expect(host.call).toHaveBeenCalledWith('p1', 'entries', {})
    expect(host.call).toHaveBeenCalledWith('p2', 'entries', {})
  })

  test('with no other module installed, a queued ticket reads as its title and points nowhere; an absolute URL opens', async () => {
    render({ p1: [LOGIN, UPSTREAM] })
    const login = await screen.findByText('Login page')
    expect(login.tagName).toBe('SPAN')
    expect(login.getAttribute('title')).toBe(LOGIN)
    const upstream = screen.getByText('Upstream bug')
    expect(upstream.tagName).toBe('A')
    expect(upstream.getAttribute('href')).toBe('https://github.com/x/y/issues/1')
  })

  test('says "Nothing queued." when no project has an entry, and names a project whose queue could not be read', async () => {
    render({ p1: [], p2: [] })
    expect(await screen.findByText('Nothing queued.')).toBeTruthy()
    cleanup()
    render({ p1: [LOGIN] })
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read the queue of beta: no answer for p2: entries')
    expect(screen.getByText('Login page')).toBeTruthy()
  })

  test('the play button starts one agent on that entry alone, landing on it', async () => {
    render({ p1: [LOGIN, 'Tidy the loader'] })
    await screen.findByText('Login page')
    fireEvent.click(screen.getAllByRole('button', { name: 'Start an agent working on this entry' })[1]!)
    await waitFor(() => expect(started()).toEqual([['p1', workOnEntryPrompt('Tidy the loader'), undefined]]))
  })

  test('the fan-out starts one agent per top entry, as many as the count says, each pinned to its own entry, without landing', async () => {
    render({ p1: [LOGIN, 'Tidy the loader', 'Third', 'Fourth'] })
    await screen.findByText('Login page')
    // Three at first; one fewer is two.
    fireEvent.click(screen.getByRole('button', { name: 'One agent fewer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start 2 agents' }))
    await waitFor(() =>
      expect(started()).toEqual([
        ['p1', workOnEntryPrompt(LOGIN), { land: false }],
        ['p1', workOnEntryPrompt('Tidy the loader'), { land: false }],
      ]),
    )
  })

  test('the fan-out starts the entries nobody is on: an entry a working agent was asked gets no second agent', async () => {
    host = fakeHost({ p1: placed(LOGIN, 'Tidy the loader', 'Third'), p2: [] })
    host.agents.mockImplementation(async (projectId: string) => (projectId === 'p1' ? [{ id: 'run-7', status: 'running', startedAt: '2026-10-01T10:00:00.000Z', ask: workOnEntryPrompt(LOGIN) }] : []))
    renderWithHost(<QueueCard projects={[alpha, beta]} />, host)
    fireEvent.click(await screen.findByRole('button', { name: 'Start 2 agents' }))
    await waitFor(() =>
      expect(started()).toEqual([
        ['p1', workOnEntryPrompt('Tidy the loader'), { land: false }],
        ['p1', workOnEntryPrompt('Third'), { land: false }],
      ]),
    )
  })

  test('an agent waiting on the person\'s answer is on its entry too: the fan-out gives that entry no second agent', async () => {
    host = fakeHost({ p1: placed(LOGIN, 'Tidy the loader'), p2: [] })
    host.agents.mockImplementation(async (projectId: string) => (projectId === 'p1' ? [{ id: 'run-7', status: 'waiting', startedAt: '2026-10-01T10:00:00.000Z', ask: workOnEntryPrompt(LOGIN) }] : []))
    renderWithHost(<QueueCard projects={[alpha, beta]} />, host)
    // The entry it waits on is at work: one is left up next.
    fireEvent.click(await screen.findByRole('button', { name: 'Start 1 agent' }))
    expect(screen.queryByText('Login page')).toBeNull()
    await waitFor(() => expect(started()).toEqual([['p1', workOnEntryPrompt('Tidy the loader'), { land: false }]]))
  })

  test('an entry a working agent was asked is at work, not up next: the card starts from the next free entry', async () => {
    host = fakeHost({ p1: placed(LOGIN, 'Tidy the loader'), p2: [] })
    host.agents.mockImplementation(async (projectId: string) => (projectId === 'p1' ? [{ id: 'run-7', status: 'running', startedAt: '2026-10-01T10:00:00.000Z', ask: workOnEntryPrompt(LOGIN) }] : []))
    renderWithHost(<QueueCard projects={[alpha, beta]} />, host)
    const next = await screen.findByText('Tidy the loader')
    expect(screen.queryByText('Login page')).toBeNull()
    // Its place in the whole queue: the second, after the one at work.
    expect(next.closest('li')!.textContent).toMatch(/^2\./)
    expect(screen.getAllByRole('button', { name: 'Start an agent working on this entry' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'All 1 waiting' })).toBeTruthy()
  })

  test('the first three free entries show; the link at its heading says how many wait in all', async () => {
    render({ p1: [LOGIN, 'Tidy the loader', 'Third', 'Fourth'] })
    await screen.findByText('Login page')
    expect(screen.getByText('Third')).toBeTruthy()
    expect(screen.queryByText('Fourth')).toBeNull()
    expect(screen.getByRole('link', { name: 'All 4 waiting' }).getAttribute('href')).toBe('/queue')
  })

  test('the count is the Queue page\'s control: typed in its box as well as stepped', async () => {
    render({ p1: [LOGIN, 'Tidy the loader', 'Third', 'Fourth'] })
    await screen.findByText('Login page')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'How many agents to start' }), { target: { value: '4' } })
    expect(screen.getByRole('button', { name: 'Start 4 agents' })).toBeTruthy()
  })

  test('the fan-out is capped at the entries there are, and stops at the first refusal with its reason', async () => {
    render({ p1: [LOGIN, 'Tidy the loader'], p2: [] })
    await screen.findByText('Login page')
    host.startRun.mockResolvedValueOnce({ ok: true, agentId: 'run-1' }).mockResolvedValueOnce({ ok: false, error: 'the daemon refused' })
    // Three asked for, two entries there: the button says two.
    fireEvent.click(screen.getByRole('button', { name: 'Start 2 agents' }))
    expect((await screen.findByRole('alert')).textContent).toBe('the daemon refused')
    expect(started()).toHaveLength(2)
  })

  test('"Configure first, then run" hands the entry\'s prompt to the project\'s launcher', async () => {
    render({ p1: [LOGIN] })
    await screen.findByText('Login page')
    await configureFirst('Other ways to run Login page')
    expect(host.configureRun).toHaveBeenCalledWith('p1', workOnEntryPrompt(LOGIN))
    expect(started()).toEqual([])
  })

  test('the entries are numbered in the order agents take them, and the link at its heading opens the Queue page', async () => {
    render({ p1: [LOGIN, 'Tidy the loader'] })
    await screen.findByText('Login page')
    expect([...document.querySelectorAll('ul ul > li')].map(row => row.querySelector('span')?.textContent)).toEqual(['1.', '2.'])
    const title = screen.getByRole('link', { name: 'All 2 waiting' })
    expect(title.getAttribute('href')).toBe('/queue')
    fireEvent.click(title)
    expect(host.openPage).toHaveBeenCalledWith('queue')
  })

  test('with a page installed that names the file an entry points at, the entry reads as that name and opens that page', async () => {
    const openPage = vi.fn()
    host = fakeHost({ p1: placed('Create tickets/2026-08-01_login-page.plan.md'), p2: [] })
    const modules: MountedModules = mountedOf({ views: { 'app.page': [{ place: 'app.page', id: 'tickets', label: 'Tickets', View: () => null, package: 'a-tickets', projects: ['p1'], names: async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md' } }) }] } })
    renderWithHost(
      <HostServicesContext.Provider value={{ ...INERT_HOST_SERVICES, openPage }}>
        <QueueCard projects={[alpha, beta]} />
      </HostServicesContext.Provider>,
      host,
      modules,
    )
    const entry = await screen.findByRole('button', { name: 'Plan: Login page' })
    expect(entry.getAttribute('title')).toBe('Create tickets/2026-08-01_login-page.plan.md')
    fireEvent.click(entry)
    expect(openPage).toHaveBeenCalledWith('tickets', ['2026-08-01_login-page.md'], 'p1')
  })

  test('an entry whose file is there already (a plan already written) offers no start, and the fan-out leaves it out', async () => {
    host = fakeHost({ p1: placed('Create tickets/2026-08-01_login-page.plan.md', 'Tidy the loader'), p2: [] })
    const modules: MountedModules = mountedOf({ views: { 'app.page': [{ place: 'app.page', id: 'tickets', label: 'Tickets', View: () => null, package: 'a-tickets', projects: ['p1'], names: async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md', done: { ask: 'Create tickets/2026-08-01_login-page.plan.md', title: 'Plan: Login page · already written' } } }) }] } })
    renderWithHost(<QueueCard projects={[alpha, beta]} />, host, modules)
    await screen.findByRole('button', { name: 'Plan: Login page · already written' })
    expect(screen.getAllByRole('button', { name: 'Start an agent working on this entry' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Start 1 agent' }))
    await waitFor(() => expect(started()).toEqual([['p1', workOnEntryPrompt('Tidy the loader'), { land: false }]]))
  })

  test('an entry that names a plan already written but asks something else of it is work: it offers a start, and the fan-out takes it', async () => {
    const review = 'Review tickets/2026-08-01_login-page.plan.md for accessibility issues'
    host = fakeHost({ p1: placed(review), p2: [] })
    const modules: MountedModules = mountedOf({ views: { 'app.page': [{ place: 'app.page', id: 'tickets', label: 'Tickets', View: () => null, package: 'a-tickets', projects: ['p1'], names: async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md', done: { ask: 'Create tickets/2026-08-01_login-page.plan.md', title: 'Plan: Login page · already written' } } }) }] } })
    renderWithHost(<QueueCard projects={[alpha, beta]} />, host, modules)
    // Named as the plan it asks about: "already written" would say it is done.
    await screen.findByRole('button', { name: 'Plan: Login page' })
    expect(screen.getAllByRole('button', { name: 'Start an agent working on this entry' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Start 1 agent' }))
    await waitFor(() => expect(started()).toEqual([['p1', workOnEntryPrompt(review), { land: false }]]))
  })
})
