import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HostServicesContext, INERT_HOST_SERVICES, type HostServices } from '../../dashboard/dashboard/lib/host-services.js'
import type { MountedModules } from '../../dashboard/dashboard/lib/use-modules.js'
import type { ModuleScheduledCommand } from '@openagt/dashboard/module'
import { QueuePage } from './QueuePage.js'
import { NO_MODULES, fakeHost, renderWithHost, type FakeHost } from './test-host.js'
import { workOnEntryPrompt } from '../src/module.js'

// The page rendered from nothing but this package: a host answering `queue --local --full`, and
// the queue's own `done` and `add`. What other packages tell it (which commands start by
// themselves, what a path into the project's files is called) comes through the dashboard's
// mounted modules, faked here by what such a package would declare.

const alpha = { id: 'p1', name: 'alpha', gitHost: true }
const PLAN = 'Create tickets/2026-08-01_login-page.plan.md'
const FULL = [{ entry: 'Hand-written on top' }, { entry: 'Urgent', priority: 8 }, { entry: 'Also urgent', priority: 8 }, { entry: 'Later', priority: 3 }]

afterEach(cleanup)

let host: FakeHost
/** The page over a queue that answers `full`, and takes every `done` and `add`. */
function show(full: unknown[] = FULL, modules: MountedModules = NO_MODULES, services?: HostServices) {
  host = fakeHost({ p1: { '--local --full': full } })
  host.act.mockImplementation(async () => ({ ok: true, output: { ok: true } }))
  const page = <QueuePage projects={[alpha]} projectId={null} path={[]} />
  return renderWithHost(services ? <HostServicesContext.Provider value={services}>{page}</HostServicesContext.Provider> : page, host, modules)
}

/** A dashboard in which a package schedules commands, as `commands` says of the project. */
function scheduling(commands: ModuleScheduledCommand[]): MountedModules {
  return {
    ...NO_MODULES,
    pages: [{ segment: 'automations', label: 'Automations', Page: () => null, package: 'a-scheduler', projects: ['p1'] }],
    schedule: { page: 'automations', read: async () => commands, package: 'a-scheduler', projects: ['p1'] },
  }
}

/** The section headers and entries, top to bottom, as the page shows them: an entry with its number. */
const shown = () => [...document.querySelectorAll('h3, ol > li')].map(node => (node.tagName === 'H3' ? node.textContent : `${node.querySelector('span')?.textContent} ${node.querySelector('.min-w-0')?.textContent}`))
const taker = (): string => screen.getByRole('status', { name: 'Who takes from the queue' }).textContent ?? ''

describe('QueuePage', () => {
  test('shows the entries in the order agents take them, numbered across the sections: an unranked entry above the sections is first', async () => {
    show()
    await screen.findByText('Hand-written on top')
    expect(shown()).toEqual(['No priority', '1. Hand-written on top', 'Priority 8', '2. Urgent', '3. Also urgent', 'Priority 3', '4. Later'])
  })

  test('says what the two ends of the scale mean: on the page, and on a section at either end', async () => {
    show([{ entry: 'Now', priority: 10 }, { entry: 'Some day', priority: 0 }])
    await screen.findByText('Now')
    expect(screen.getByText(/10 is the most urgent, 0 is only if there is capacity/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Priority 10 most urgent' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Priority 0 only if there is capacity' })).toBeTruthy()
  })

  describe('who takes from the queue', () => {
    test('with no package that starts commands by itself, entries wait for a person, and nothing links anywhere', async () => {
      show()
      await screen.findByText('Urgent')
      expect(taker()).toBe('Nothing takes from this queue by itself: entries wait until you start them.')
    })

    test('the command that works the queue, switched off: entries wait, and the line opens the page that switches it', async () => {
      const openPage = vi.fn()
      show(FULL, scheduling([{ command: 'plan-tickets', on: true, note: 'Next start in 3h, if there is work' }, { command: 'work-queue', on: false }]), { ...INERT_HOST_SERVICES, openPage })
      await waitFor(() => expect(taker()).toBe('/work-queue is off: entries wait until you start them.Change it in Automations'))
      fireEvent.click(screen.getByRole('link', { name: 'Automations' }))
      expect(openPage).toHaveBeenCalledWith('automations')
    })

    test('switched on: an agent takes the first entry nobody claimed, and when it starts next is said in the scheduling package\'s words', async () => {
      show(FULL, scheduling([{ command: 'work-queue', on: true, note: 'Starts when there is work' }]))
      await waitFor(() => expect(taker()).toBe('/work-queue is on: an agent takes the first entry nobody has claimed. Starts when there is work.Change it in Automations'))
    })

    test('switched on while nothing starts by itself: the line says off, with why', async () => {
      show(FULL, scheduling([{ command: 'work-queue', on: false, note: 'The scheduler is off' }]))
      await waitFor(() => expect(taker()).toContain('/work-queue is off: entries wait until you start them. The scheduler is off.'))
    })

    test('while what starts by itself is not known, the page says nothing of it: not read yet, or a read that failed', async () => {
      // The installed modules are not known yet.
      show(FULL, { ...NO_MODULES, loaded: false })
      await screen.findByText('Urgent')
      expect(screen.queryByRole('status', { name: 'Who takes from the queue' })).toBeNull()
      cleanup()
      // The scheduling package could not read this project.
      show(FULL, { ...NO_MODULES, schedule: { page: 'automations', read: async () => Promise.reject(new Error('no')), package: 'a-scheduler', projects: ['p1'] } })
      await screen.findByText('Urgent')
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(screen.queryByRole('status', { name: 'Who takes from the queue' })).toBeNull()
    })

    test('a project whose scheduled commands hold none that works the queue has nothing taking from it', async () => {
      show(FULL, scheduling([{ command: 'plan-tickets', on: true }]))
      await screen.findByText('Urgent')
      await waitFor(() => expect(host.runCommand).toHaveBeenCalled())
      expect(taker()).toBe('Nothing takes from this queue by itself: entries wait until you start them.')
    })
  })

  describe('starting', () => {
    test('an entry\'s play button starts one agent on that entry alone', async () => {
      show()
      await screen.findByText('Urgent')
      fireEvent.click(screen.getByRole('button', { name: 'Start an agent on entry 2' }))
      await waitFor(() => expect(host.startRun.mock.calls).toEqual([['p1', workOnEntryPrompt('Urgent')]]))
    })

    test('the batch starts one agent per entry from the top, as many as the count says, without leaving the page', async () => {
      show()
      await screen.findByText('Urgent')
      fireEvent.change(screen.getByRole('spinbutton', { name: 'How many agents to start' }), { target: { value: '2' } })
      fireEvent.click(screen.getByRole('button', { name: 'Start 2 agents' }))
      await waitFor(() =>
        expect(host.startRun.mock.calls).toEqual([
          ['p1', workOnEntryPrompt('Hand-written on top'), { land: false }],
          ['p1', workOnEntryPrompt('Urgent'), { land: false }],
        ]),
      )
    })

    test('a start that is refused says why', async () => {
      show()
      await screen.findByText('Urgent')
      host.startRun.mockResolvedValueOnce({ ok: false, error: 'the daemon refused' })
      fireEvent.click(screen.getByRole('button', { name: 'Start an agent on entry 1' }))
      expect((await screen.findByRole('alert')).textContent).toBe('the daemon refused')
    })

    test('an entry a working agent was asked says so, and opens that agent; one that only waits does not', async () => {
      host = fakeHost({ p1: { '--local --full': FULL } })
      host.agents.mockImplementation(async () => [
        { id: 'run-7', status: 'running', startedAt: '2026-10-01T10:00:00.000Z', ask: workOnEntryPrompt('Urgent') },
        { id: 'run-6', status: 'done', startedAt: '2026-10-01T09:00:00.000Z', ask: workOnEntryPrompt('Later') },
      ])
      renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, host)
      const on = await screen.findByRole('button', { name: 'An agent is on it' })
      expect(screen.getAllByRole('button', { name: 'An agent is on it' })).toHaveLength(1)
      expect(on.closest('li')?.textContent).toContain('Urgent')
      fireEvent.click(on)
      expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-7')
    })
  })

  describe('removing', () => {
    test('the bin asks first, with the entry as written; "Remove" runs `queue done` with exactly that line and reads the queue again', async () => {
      show()
      await screen.findByText('Urgent')
      fireEvent.click(screen.getByRole('button', { name: 'Remove entry 2 from the queue' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog.textContent).toContain('Remove this entry from the queue?')
      expect(dialog.textContent).toContain('Urgent')
      expect(host.act).not.toHaveBeenCalled()
      const reads = host.runCommand.mock.calls.length
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['done', '--', 'Urgent']))
      await waitFor(() => expect(host.runCommand.mock.calls.length).toBeGreaterThan(reads))
    })

    test('"Cancel" removes nothing', async () => {
      show()
      await screen.findByText('Urgent')
      fireEvent.click(screen.getByRole('button', { name: 'Remove entry 2 from the queue' }))
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(host.act).not.toHaveBeenCalled()
    })

    test('a removal the queue refuses stays on screen with the queue\'s reason', async () => {
      show()
      await screen.findByText('Urgent')
      host.act.mockImplementation(async () => ({ ok: false, error: 'no open queue entry reads "Urgent"' }))
      fireEvent.click(screen.getByRole('button', { name: 'Remove entry 2 from the queue' }))
      const dialog = await screen.findByRole('alertdialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
      expect(await within(dialog).findByText('no open queue entry reads "Urgent"')).toBeTruthy()
      expect(screen.getByRole('alertdialog')).toBeTruthy()
    })
  })

  describe('adding', () => {
    const field = (): HTMLInputElement => screen.getByRole('textbox', { name: 'A task to add to the queue' }) as HTMLInputElement
    const add = (): HTMLButtonElement => screen.getByRole('button', { name: 'Add to queue' }) as HTMLButtonElement

    test('nothing typed adds nothing; a task typed is added with `queue add` at priority 5, trimmed, and the field empties', async () => {
      show()
      await screen.findByText('Urgent')
      expect(add().disabled).toBe(true)
      fireEvent.change(field(), { target: { value: '  Tidy the loader  ' } })
      fireEvent.click(add())
      await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['add', '--priority', '5', '--', 'Tidy the loader']))
      await waitFor(() => expect(field().value).toBe(''))
    })

    test('the priority picked is the section the task goes to', async () => {
      show()
      await screen.findByText('Urgent')
      fireEvent.click(screen.getByRole('combobox', { name: 'Priority of the new task' }))
      // Base UI takes a click only on the choice the pointer is on.
      const urgent = await screen.findByRole('option', { name: /^Priority 10/ })
      fireEvent.mouseMove(urgent)
      fireEvent.click(urgent)
      fireEvent.change(field(), { target: { value: 'Fix the outage' } })
      fireEvent.submit(screen.getByRole('form', { name: 'Add to the queue of alpha' }))
      await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['add', '--priority', '10', '--', 'Fix the outage']))
    })

    test('a task the queue did not take stays typed, with why', async () => {
      show()
      await screen.findByText('Urgent')
      host.act.mockImplementation(async () => ({ ok: false, error: 'the push was refused' }))
      fireEvent.change(field(), { target: { value: 'Tidy the loader' } })
      fireEvent.click(add())
      expect((await screen.findByRole('alert')).textContent).toBe('Not added: the push was refused')
      expect(field().value).toBe('Tidy the loader')
    })

    test('an empty queue still takes a task', async () => {
      show([])
      expect(await screen.findByText('Nothing queued.')).toBeTruthy()
      expect(field()).toBeTruthy()
    })
  })

  describe('what an entry reads as', () => {
    /** A dashboard in which the page at `tickets` names its files. */
    const naming = (names: NonNullable<MountedModules['pages'][number]['names']>): MountedModules => ({ ...NO_MODULES, pages: [{ segment: 'tickets', label: 'Tickets', Page: () => null, package: 'a-tickets', projects: ['p1'], names }] })

    test('with no page that names it, an entry that names a file reads as written, and opens nothing', async () => {
      show([{ entry: PLAN, priority: 5 }])
      const entry = await screen.findByText(PLAN)
      expect(entry.tagName).toBe('SPAN')
    })

    test('an entry that names a file another page opens reads as that page\'s name for it, with the line as written under it, and opens that page', async () => {
      const openPage = vi.fn()
      const names = vi.fn(async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md' } }))
      show([{ entry: PLAN, priority: 5 }], naming(names), { ...INERT_HOST_SERVICES, openPage })
      const title = await screen.findByRole('button', { name: 'Plan: Login page' })
      expect(names).toHaveBeenCalledWith(expect.objectContaining({ package: 'a-tickets' }), 'p1', ['tickets/2026-08-01_login-page.plan.md'])
      expect(screen.getByText(PLAN)).toBeTruthy()
      fireEvent.click(title)
      expect(openPage).toHaveBeenCalledWith('tickets', ['2026-08-01_login-page.md'], 'p1')
      // What an agent is started with is still the line as written.
      fireEvent.click(screen.getByRole('button', { name: 'Start an agent on entry 1' }))
      await waitFor(() => expect(host.startRun.mock.calls).toEqual([['p1', workOnEntryPrompt(PLAN)]]))
      // And what is removed is the line as written: the queue knows no other name for it.
      fireEvent.click(screen.getByRole('button', { name: 'Remove entry 1 from the queue' }))
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['done', '--', PLAN]))
    })

    test('a queued link reads as its text; to a web address it opens there, into the project it opens the page that names its target', async () => {
      const openPage = vi.fn()
      show(
        [{ entry: '[Upstream bug](https://github.com/x/y/issues/1)' }, { entry: '[Login page](tickets/2026-08-01_login-page.md)' }],
        naming(async () => ({ 'tickets/2026-08-01_login-page.md': { title: 'Login page, as the ticket says' } })),
        { ...INERT_HOST_SERVICES, openPage },
      )
      const upstream = await screen.findByRole('link', { name: 'Upstream bug' })
      expect(upstream.getAttribute('href')).toBe('https://github.com/x/y/issues/1')
      fireEvent.click(await screen.findByRole('button', { name: 'Login page' }))
      expect(openPage).toHaveBeenCalledWith('tickets', ['2026-08-01_login-page.md'], 'p1')
    })
  })

  test('a project whose command fails is named with the reason, and has no field to add to', async () => {
    host = fakeHost({})
    renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, host)
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read the queue of alpha: no answer for p1: queue --local --full')
    expect(screen.queryByRole('textbox', { name: 'A task to add to the queue' })).toBeNull()
  })
})
