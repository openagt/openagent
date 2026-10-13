import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueueCard } from './QueueCard.js'
import { HostServicesContext, INERT_HOST_SERVICES } from '../../openagent/dashboard/lib/host-services.js'
import type { MountedModules } from '../../openagent/dashboard/lib/use-modules.js'
import { NO_MODULES, fakeHost, renderWithHost, type FakeHost } from './test-host.js'
import { workOnEntryPrompt } from '../src/module.js'
import { configureFirst } from '../../openagent/dashboard/test-utils.js'

// The card on the Overview, rendered from nothing but this package: a host answering the queue
// command, and no other module mounted. A queued ticket is a link into a repository the card has
// no page for, so it reads as text: the card names no tickets package.

const alpha = { id: 'p1', name: 'alpha', gitHost: true }
const beta = { id: 'p2', name: 'beta', gitHost: true }
const LOGIN = '[Login page](tickets/2026-08-01_login-page.md)'
const UPSTREAM = '[Upstream bug](https://github.com/x/y/issues/1)'

let host: FakeHost
const render = (answers: Record<string, unknown[]> = {}) => {
  host = fakeHost(Object.fromEntries(Object.entries(answers).map(([id, entries]) => [id, { '--local': entries }])))
  return renderWithHost(<QueueCard projects={[alpha, beta]} />, host)
}
/** The starts the host was asked for: `[projectId, prompt, opts]` each. */
const started = () => host.startRun.mock.calls.map(([projectId, prompt, opts]) => [projectId, prompt, opts])

afterEach(cleanup)

describe('QueueCard', () => {
  test('lists every project with open entries from `queue --local`, and leaves out a project with none', async () => {
    render({ p1: [LOGIN, 'Tidy the loader'], p2: [] })
    expect(await screen.findByText('Login page')).toBeTruthy()
    expect(screen.getByText('Tidy the loader')).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.queryByText('beta')).toBeNull()
    expect(host.runCommand).toHaveBeenCalledWith('p1', ['--local'])
    expect(host.runCommand).toHaveBeenCalledWith('p2', ['--local'])
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

  test('says "Nothing queued." when no project has an entry, and names a project whose command failed', async () => {
    render({ p1: [], p2: [] })
    expect(await screen.findByText('Nothing queued.')).toBeTruthy()
    cleanup()
    render({ p1: [LOGIN] })
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read the queue of beta: no answer for p2: queue --local')
    expect(screen.getByText('Login page')).toBeTruthy()
  })

  test('the play button starts one agent on that entry alone, landing on it', async () => {
    render({ p1: [LOGIN, 'Tidy the loader'] })
    await screen.findByText('Login page')
    fireEvent.click(screen.getAllByRole('button', { name: 'Spin up an agent working on this entry' })[1]!)
    await waitFor(() => expect(started()).toEqual([['p1', workOnEntryPrompt('Tidy the loader'), undefined]]))
  })

  test('the fan-out starts one agent per top entry, as many as the count says, each pinned to its own entry, without landing', async () => {
    render({ p1: [LOGIN, 'Tidy the loader', 'Third', 'Fourth'] })
    await screen.findByText('Login page')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'How many agents to spin up' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spin up 2 agents working on the top 2 entries' }))
    await waitFor(() =>
      expect(started()).toEqual([
        ['p1', workOnEntryPrompt(LOGIN), { land: false }],
        ['p1', workOnEntryPrompt('Tidy the loader'), { land: false }],
      ]),
    )
  })

  test('the fan-out is capped at the entries there are, and stops at the first refusal with its reason', async () => {
    render({ p1: [LOGIN, 'Tidy the loader'], p2: [] })
    await screen.findByText('Login page')
    host.startRun.mockResolvedValueOnce({ ok: true, agentId: 'run-1' }).mockResolvedValueOnce({ ok: false, error: 'the daemon refused' })
    fireEvent.click(screen.getByRole('button', { name: 'Spin up 2 agents working on the top 2 entries' }))
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

  test('the entries are numbered in the order agents take them, and the card\'s title opens the Queue page', async () => {
    render({ p1: [LOGIN, 'Tidy the loader'] })
    await screen.findByText('Login page')
    expect([...document.querySelectorAll('ul ul > li')].map(row => row.querySelector('span')?.textContent)).toEqual(['1.', '2.'])
    const title = screen.getByRole('link', { name: 'AI Queue' })
    expect(title.getAttribute('href')).toBe('/queue')
    fireEvent.click(title)
    expect(host.openPage).toHaveBeenCalledWith('queue')
  })

  test('with a page installed that names the file an entry points at, the entry reads as that name and opens that page', async () => {
    const openPage = vi.fn()
    host = fakeHost({ p1: { '--local': ['Create tickets/2026-08-01_login-page.plan.md'] }, p2: { '--local': [] } })
    const modules: MountedModules = { ...NO_MODULES, pages: [{ segment: 'tickets', label: 'Tickets', Page: () => null, package: 'a-tickets', projects: ['p1'], names: async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md' } }) }] }
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
    expect(openPage).toHaveBeenCalledWith('tickets', ['p1', '2026-08-01_login-page.md'])
  })
})
