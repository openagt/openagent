import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HostServicesContext, INERT_HOST_SERVICES, type HostServices } from '../../ui/dashboard/lib/host-services.js'
import { mountedOf, type MountedModules } from '@openagt/ui/module/testing'
import { forgetRemembered } from '@openagt/ui/module'
import type { PlacedEntry } from '../src/queue.js'
import type { Taker } from '../src/server.js'
import { QueuePage } from './QueuePage.js'
import { NO_MODULES, fakeHost, renderWithHost, type FakeHost } from './test-host.js'
import { workOnEntryPrompt } from '../src/module.js'
import { openMenu, phoneScreen } from '../../ui/dashboard/test-utils.js'

// The page rendered from nothing but this package: a host whose server part answers `entries` and
// `taker`, which reads the scheduler's switch in the settings, and whose command takes the queue's
// own `done` and `add`. What other packages tell it (what a path into the project's files is called)
// comes through the dashboard's mounted modules, faked here by what such a package would declare.

const alpha = { id: 'p1', name: 'alpha', remote: 'github.com/me/project' }
const PLAN = 'Create tickets/2026-08-01_login-page.plan.md'
const FULL: PlacedEntry[] = [{ entry: 'Hand-written on top' }, { entry: 'Hot fix', priority: 8 }, { entry: 'Also urgent', priority: 8 }, { entry: 'Later', priority: 3 }]

afterEach(() => {
  cleanup()
  // The answers kept for the next visit too: one test's is never another's first frame.
  forgetRemembered()
  localStorage.clear()
})

let host: FakeHost
/** The page over a queue that answers `full`, and takes every `done` and `add`; who takes from it is `taker`, unknown without one. */
function show(full: PlacedEntry[] = FULL, modules: MountedModules = NO_MODULES, { services, taker }: { services?: HostServices; taker?: Taker | 'pending' } = {}) {
  host = fakeHost({ p1: full }, taker)
  host.act.mockImplementation(async () => ({ ok: true, output: { ok: true } }))
  const page = <QueuePage projects={[alpha]} projectId={null} path={[]} />
  return renderWithHost(services ? <HostServicesContext.Provider value={services}>{page}</HostServicesContext.Provider> : page, host, modules)
}

/** The section headings and the entries' names, top to bottom, as the page shows them. */
const shown = () => [...document.querySelectorAll('h2, ul > li')].map(node => (node.tagName === 'H2' ? node.textContent : node.querySelector('[title]')?.textContent))
/** Entry `place`'s menu opened, and its removal asked for. */
const removeEntry = async (place: number): Promise<void> => {
  await openMenu(await screen.findByRole('button', { name: `More for entry ${place}` }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove from the queue' }))
}
/** What the line under the page's title says of who takes from the queue. */
const taker = (): string => screen.getByRole('status', { name: 'Who takes from the queue' }).textContent ?? ''

describe('QueuePage', () => {
  test('shows the entries in the order agents take them, under the section each sits in: an unranked entry above the sections is first', async () => {
    show()
    await screen.findByText('Hand-written on top')
    expect(shown()).toEqual(['No priority', 'Hand-written on top', 'Priority 8', 'Hot fix', 'Also urgent', 'Priority 3', 'Later'])
  })

  test('under a name, where the entry came from, or a typed entry\'s words after its name, starting with a capital', async () => {
    show([{ entry: 'Tidy the loader', priority: 5 }, { entry: '[Login page](tickets/2026-08-01_login-page.md)', priority: 5 }, { entry: '[Upstream bug](https://github.com/x/y/issues/1)', priority: 5 }, { entry: 'Search: forgive typos in product names', priority: 5 }])
    const first = (await screen.findByText('Tidy the loader')).closest('li')!
    // A typed line with nothing after its name is the name alone.
    expect(first.textContent).not.toContain('·')
    const typed = screen.getByText('Search').closest('li')!
    expect(typed.textContent).toContain('Forgive typos in product names')
    expect(typed.querySelector('[title]')?.getAttribute('title')).toBe('Search: forgive typos in product names')
    expect(screen.getByText('Login page').closest('li')!.textContent).toContain('From a ticket')
    expect(screen.getByText('Upstream bug').closest('li')!.textContent).toContain('From github.com')
  })

  test("while the queue is first read, its rows' shapes stand where the entries will, and the entries take their place", async () => {
    // A browser that kept no list from an earlier visit.
    localStorage.clear()
    host = fakeHost({ p1: FULL })
    let answer = () => {}
    host.call.mockImplementation((_projectId, name) => (name === 'entries' ? new Promise(resolve => (answer = () => resolve({ ok: true, output: FULL }))) : Promise.resolve({ ok: false, error: 'not in this test' })))
    renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, host, NO_MODULES)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText('Nothing queued')).toBeNull()
    answer()
    await screen.findByText('Hand-written on top')
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  test('names a section by its priority, the number the queue file holds, ends of the scale too', async () => {
    show([{ entry: 'Now', priority: 10 }, { entry: 'Some day', priority: 0 }])
    await screen.findByText('Now')
    expect(screen.getByRole('region', { name: 'Priority 10' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Priority 0' })).toBeTruthy()
  })

  describe('who takes from the queue', () => {
    const since = '2026-10-03T08:00:00.000Z'

    test("the command that works the queue, switched off on this computer: entries wait, and the line opens the scheduler's page in the project", async () => {
      show(FULL, NO_MODULES, { taker: { on: false } })
      await waitFor(() => expect(taker()).toBe('Entries wait here until you start them. Change it in Automations.'))
      const link = screen.getByRole('link', { name: 'Automations' })
      expect(link.getAttribute('href')).toBe('/p1/automations')
      fireEvent.click(link)
      expect(host.openPage).toHaveBeenCalledWith('automations', [], 'p1')
    })

    test('switched on: agents take entries by themselves, at the pace set here when one is', async () => {
      show(FULL, NO_MODULES, { taker: { on: true } })
      await waitFor(() => expect(taker()).toBe('Agents take entries from here by themselves. Change it in Automations.'))
      cleanup()
      forgetRemembered()
      localStorage.clear()
      show(FULL, NO_MODULES, { taker: { on: true, pace: { every: '6h', since } } })
      await waitFor(() => expect(taker()).toBe('Agents take entries from here by themselves, at most every 6 hours. Change it in Automations.'))
      cleanup()
      forgetRemembered()
      localStorage.clear()
      show(FULL, NO_MODULES, { taker: { on: true, pace: { work: true } } })
      await waitFor(() => expect(taker()).toBe('Agents take entries from here by themselves, whenever there is work. Change it in Automations.'))
    })

    test('while who takes from it is not known, not read yet or a read that failed, the page says nothing of it', async () => {
      show(FULL, NO_MODULES, { taker: 'pending' })
      await screen.findByText('Hot fix')
      expect(screen.queryByRole('status', { name: 'Who takes from the queue' })).toBeNull()
      cleanup()
      show(FULL)
      await screen.findByText('Hot fix')
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(screen.queryByRole('status', { name: 'Who takes from the queue' })).toBeNull()
    })

    test('coming back to the page, the line stands from the first frame: what was read last time, until the fresh read lands', async () => {
      show(FULL, NO_MODULES, { taker: { on: true } })
      await waitFor(() => expect(taker()).toContain('Agents take entries from here by themselves'))
      cleanup()
      show(FULL, NO_MODULES, { taker: 'pending' })
      await screen.findByText('Hot fix')
      expect(taker()).toContain('Agents take entries from here by themselves')
      // Opened again, in a new tab: what was read is kept beside the page too.
      cleanup()
      forgetRemembered()
      show(FULL, NO_MODULES, { taker: 'pending' })
      expect(taker()).toContain('Agents take entries from here by themselves.')
    })
  })

  describe('starting', () => {
    test('an entry\'s "Start now" starts one agent on that entry alone', async () => {
      show()
      await screen.findByText('Hot fix')
      fireEvent.click(screen.getByRole('button', { name: 'Start now: entry 2' }))
      await waitFor(() => expect(host.startRun.mock.calls).toEqual([['p1', workOnEntryPrompt('Hot fix')]]))
    })

    test('beside a free entry\'s "Start now", its menu sets a run up first or removes it; one an agent is on, only removes it', async () => {
      host = fakeHost({ p1: FULL })
      host.agents.mockImplementation(async () => [{ id: 'run-7', status: 'running', startedAt: '2026-10-01T10:00:00.000Z', ask: workOnEntryPrompt('Hand-written on top') }])
      renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, host)
      await screen.findByRole('button', { name: /^An agent is on it/ })
      await openMenu(screen.getByRole('button', { name: 'More for entry 1' }))
      expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Remove from the queue'])
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
      await openMenu(screen.getByRole('button', { name: 'More for entry 2' }))
      expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Configure first, then run', 'Remove from the queue'])
      fireEvent.click(screen.getByRole('menuitem', { name: 'Configure first, then run' }))
      expect(host.configureRun).toHaveBeenCalledWith('p1', workOnEntryPrompt('Hot fix'))
    })

    test('the batch starts one agent per entry from the top, as many as the count says, without leaving the page', async () => {
      show()
      await screen.findByText('Hot fix')
      fireEvent.change(screen.getByRole('spinbutton', { name: 'How many agents to start' }), { target: { value: '2' } })
      fireEvent.click(screen.getByRole('button', { name: 'Start 2 agents' }))
      await waitFor(() =>
        expect(host.startRun.mock.calls).toEqual([
          ['p1', workOnEntryPrompt('Hand-written on top'), { land: false }],
          ['p1', workOnEntryPrompt('Hot fix'), { land: false }],
        ]),
      )
    })

    test('the count says the agents the batch starts: never more than the entries', async () => {
      show([{ entry: 'Only one' }])
      await screen.findByText('Only one')
      const box = screen.getByRole('spinbutton', { name: 'How many agents to start' }) as HTMLInputElement
      expect([box.value, box.max]).toEqual(['1', '1'])
      // Its name is said once: by the box, not again by a group around it.
      expect(screen.getAllByLabelText('How many agents to start')).toEqual([box])
      // A count typed past the entries snaps back, and the box says why while it is in use.
      fireEvent.focus(box)
      fireEvent.change(box, { target: { value: '9' } })
      expect(box.value).toBe('1')
      expect((await screen.findByRole('tooltip')).textContent).toBe('How many agents to start: one per entry, from the top of the queue, so at most 1.')
      expect(screen.getByRole('button', { name: 'Start 1 agent' })).toBeTruthy()
    })

    test('the count is stepped as well as typed, the AI Queue card\'s control', async () => {
      show()
      await screen.findByText('Hot fix')
      fireEvent.click(screen.getByRole('button', { name: 'One agent fewer' }))
      expect(screen.getByRole('button', { name: 'Start 2 agents' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'One agent more' }))
      expect(screen.getByRole('button', { name: 'Start 3 agents' })).toBeTruthy()
    })

    test('a start that is refused says why', async () => {
      show()
      await screen.findByText('Hot fix')
      host.startRun.mockResolvedValueOnce({ ok: false, error: 'the daemon refused' })
      fireEvent.click(screen.getByRole('button', { name: 'Start now: entry 1' }))
      expect((await screen.findByRole('alert')).textContent).toBe('the daemon refused')
    })

    test('an entry a working agent was asked says so, and opens that agent; one that only waits does not', async () => {
      host = fakeHost({ p1: FULL })
      host.agents.mockImplementation(async () => [
        { id: 'run-7', status: 'running', startedAt: '2026-10-01T10:00:00.000Z', ask: workOnEntryPrompt('Hot fix') },
        { id: 'run-6', status: 'done', startedAt: '2026-10-01T09:00:00.000Z', ask: workOnEntryPrompt('Later') },
      ])
      renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, host)
      const on = await screen.findByRole('button', { name: /^An agent is on it · \d+d$/ })
      expect(screen.getAllByRole('button', { name: /^An agent is on it/ })).toHaveLength(1)
      expect(on.closest('li')?.textContent).toContain('Hot fix')
      fireEvent.click(on)
      expect(host.openAgent).toHaveBeenCalledWith('p1', 'run-7')
    })

    test('an agent waiting on the person\'s answer is on its entry too: the row offers no start, and the batch starts the entries nobody is on', async () => {
      host = fakeHost({ p1: FULL })
      host.agents.mockImplementation(async () => [{ id: 'run-7', status: 'waiting', startedAt: '2026-10-01T10:00:00.000Z', ask: workOnEntryPrompt('Hand-written on top') }])
      renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, host)
      await screen.findByRole('button', { name: /^(An agent is on it|Waiting on you) · / })
      expect(screen.queryByRole('button', { name: 'Start now: entry 1' })).toBeNull()
      fireEvent.change(screen.getByRole('spinbutton', { name: 'How many agents to start' }), { target: { value: '2' } })
      fireEvent.click(screen.getByRole('button', { name: 'Start 2 agents' }))
      await waitFor(() =>
        expect(host.startRun.mock.calls).toEqual([
          ['p1', workOnEntryPrompt('Hot fix'), { land: false }],
          ['p1', workOnEntryPrompt('Also urgent'), { land: false }],
        ]),
      )
    })

    test('an entry an agent is on gets no second one: its row offers no start, and the batch starts the entries nobody is on', async () => {
      host = fakeHost({ p1: FULL })
      host.agents.mockImplementation(async () => [{ id: 'run-7', status: 'running', startedAt: '2026-10-01T10:00:00.000Z', ask: workOnEntryPrompt('Hand-written on top') }])
      renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, host)
      await screen.findByRole('button', { name: /^(An agent is on it|Waiting on you) · / })
      expect(screen.queryByRole('button', { name: 'Start now: entry 1' })).toBeNull()
      // Its one press is its menu, which still removes it.
      await removeEntry(1)
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
      fireEvent.change(screen.getByRole('spinbutton', { name: 'How many agents to start' }), { target: { value: '2' } })
      fireEvent.click(screen.getByRole('button', { name: 'Start 2 agents' }))
      await waitFor(() =>
        expect(host.startRun.mock.calls).toEqual([
          ['p1', workOnEntryPrompt('Hot fix'), { land: false }],
          ['p1', workOnEntryPrompt('Also urgent'), { land: false }],
        ]),
      )
    })

    test('on a phone a row has one press, its menu, holding its start, the launcher and its removal', async () => {
      const wide = phoneScreen()
      try {
        show(FULL, NO_MODULES, { taker: { on: false } })
        await screen.findByText('Hot fix')
        expect(screen.queryByRole('button', { name: /^Start now: entry/ })).toBeNull()
        // Who takes from the queue said once; the field, then the count and the batch's start, over the entries they start.
        await waitFor(() => expect(screen.getAllByRole('status', { name: 'Who takes from the queue' })).toHaveLength(1))
        const field = screen.getByRole('textbox', { name: 'A task to add to the queue' })
        const start = screen.getByRole('button', { name: 'Start 3 agents' })
        const first = screen.getByText('Hand-written on top')
        expect(field.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(start.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        await openMenu(screen.getByRole('button', { name: 'More for entry 2' }))
        expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Start now', 'Configure first, then run', 'Remove from the queue'])
        fireEvent.click(screen.getByRole('menuitem', { name: 'Start now' }))
        await waitFor(() => expect(host.startRun.mock.calls).toEqual([['p1', workOnEntryPrompt('Hot fix')]]))
      } finally {
        wide()
      }
    })
  })

  describe('removing', () => {
    test('removing, from the entry\'s menu, asks first, naming the entry as its row does; "Remove" runs `queue done` with the line as written and reads the queue again', async () => {
      const ticket = '[Login page](tickets/2026-08-01_login-page.md)'
      show([{ entry: 'Hot fix', priority: 5 }, { entry: ticket, priority: 5 }])
      await screen.findByText('Login page')
      await removeEntry(2)
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog.textContent).toContain('Remove this entry from the queue?')
      expect(within(dialog).getByRole('heading').nextElementSibling?.textContent).toMatch(/^Login page is deleted from the queue of /)
      expect(dialog.textContent).not.toContain('tickets/')
      expect(host.act).not.toHaveBeenCalled()
      const reads = () => host.call.mock.calls.filter(([, name]) => name === 'entries').length
      const before = reads()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['done', '--', ticket]))
      await waitFor(() => expect(reads()).toBeGreaterThan(before))
    })

    test('after a removal the focus is on the entry now in its place, else on the one before it, else on the field that adds one', async () => {
      let entries = [{ entry: 'First' }, { entry: 'Second' }, { entry: 'Third' }]
      host = fakeHost()
      host.call.mockImplementation(async (_projectId, name) => (name === 'entries' ? { ok: true, output: entries } : { ok: false, error: 'not in this test' }))
      host.act.mockImplementation(async (_projectId: string, args: string[]) => {
        entries = entries.filter(placed => placed.entry !== args[2])
        return { ok: true, output: { ok: true } }
      })
      renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, host, NO_MODULES)
      const remove = async (place: number, focused: string) => {
        await removeEntry(place)
        fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
        await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe(focused))
      }
      await screen.findByText('Third')
      await remove(3, 'More for entry 2')
      await remove(1, 'More for entry 1')
      expect(document.activeElement?.closest('li')?.textContent).toContain('Second')
      await remove(1, 'A task to add to the queue')
    })

    test('"Cancel" removes nothing', async () => {
      show()
      await screen.findByText('Hot fix')
      await removeEntry(2)
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(host.act).not.toHaveBeenCalled()
    })

    test('a removal the queue refuses stays on screen with the queue\'s reason', async () => {
      show()
      await screen.findByText('Hot fix')
      host.act.mockImplementation(async () => ({ ok: false, error: 'no open queue entry reads "Hot fix"' }))
      await removeEntry(2)
      const dialog = await screen.findByRole('alertdialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
      expect(await within(dialog).findByText('no open queue entry reads "Hot fix"')).toBeTruthy()
      expect(screen.getByRole('alertdialog')).toBeTruthy()
    })
  })

  describe('adding', () => {
    const field = (): HTMLInputElement => screen.getByRole('textbox', { name: 'A task to add to the queue' }) as HTMLInputElement
    const add = (): HTMLButtonElement => screen.getByRole('button', { name: 'Add to queue' }) as HTMLButtonElement

    test('nothing typed adds nothing: the press says what is missing under the field, with the caret there; a task typed is added with `queue add` at priority 5, trimmed, and the field empties', async () => {
      show()
      await screen.findByText('Hot fix')
      // Where the task goes is the pick's title; under the field stands nothing until a press adds nothing.
      expect(screen.getByLabelText('Priority of the new task').getAttribute('title')).toBe('Goes to the end of priority 5')
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.click(add())
      expect(host.act).not.toHaveBeenCalled()
      expect(screen.getByRole('alert').textContent).toBe('Write the task first.')
      expect(document.activeElement).toBe(field())
      fireEvent.change(field(), { target: { value: '  Tidy the loader  ' } })
      fireEvent.click(add())
      await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['add', '--priority', '5', '--', 'Tidy the loader']))
      await waitFor(() => expect(field().value).toBe(''))
    })

    test('once a task is added, by Enter or by the press, the caret is back in the field, for the next one', async () => {
      show()
      await screen.findByText('Hot fix')
      fireEvent.change(field(), { target: { value: 'Tidy the loader' } })
      add().focus()
      fireEvent.click(add())
      await waitFor(() => expect(field().value).toBe(''))
      expect(document.activeElement).toBe(field())
    })

    test('the priority picked is the section the task goes to', async () => {
      show()
      await screen.findByText('Hot fix')
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
      await screen.findByText('Hot fix')
      host.act.mockImplementation(async () => ({ ok: false, error: 'the push was refused' }))
      fireEvent.change(field(), { target: { value: 'Tidy the loader' } })
      fireEvent.click(add())
      expect((await screen.findByRole('alert')).textContent).toBe('Not added: the push was refused')
      expect(field().value).toBe('Tidy the loader')
    })

    test('an empty queue is the same page: who takes from it, the field that takes a task, and one line under it', async () => {
      show([], NO_MODULES, { taker: { on: false } })
      expect(await screen.findByText('Nothing queued.')).toBeTruthy()
      expect(field()).toBeTruthy()
      await waitFor(() => expect(taker()).toContain('Change it in Automations.'))
    })
  })

  describe('what an entry reads as', () => {
    /** A dashboard in which the page at `tickets` names its files. */
    const naming = (names: NonNullable<MountedModules['views']['app.page'][number]['names']>): MountedModules => mountedOf({ views: { 'app.page': [{ place: 'app.page', id: 'tickets', label: 'Tickets', View: () => null, package: 'a-tickets', projects: ['p1'], names }] } })

    test('with no page that names it, an entry that names a file reads as written, and opens nothing', async () => {
      show([{ entry: PLAN, priority: 5 }])
      const entry = await screen.findByText(PLAN)
      expect(entry.tagName).toBe('SPAN')
    })

    test('an entry that names a file another page opens reads as that page\'s name for it, with the line as written under it, and opens that page', async () => {
      const openPage = vi.fn()
      const names = vi.fn(async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md' } }))
      show([{ entry: PLAN, priority: 5 }], naming(names), { services: { ...INERT_HOST_SERVICES, openPage } })
      const title = await screen.findByRole('button', { name: 'Plan: Login page' })
      expect(names).toHaveBeenCalledWith(expect.objectContaining({ package: 'a-tickets' }), 'p1', ['tickets/2026-08-01_login-page.plan.md'])
      expect(screen.getByText(PLAN)).toBeTruthy()
      fireEvent.click(title)
      expect(openPage).toHaveBeenCalledWith('tickets', ['2026-08-01_login-page.md'], 'p1')
      // What an agent is started with is still the line as written.
      fireEvent.click(screen.getByRole('button', { name: 'Start now: entry 1' }))
      await waitFor(() => expect(host.startRun.mock.calls).toEqual([['p1', workOnEntryPrompt(PLAN)]]))
      // The question names it as the row does, with the line as written; what is removed is that line: the queue knows no other name for it.
      await removeEntry(1)
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText('Plan: Login page')).toBeTruthy()
      expect(within(dialog).getByText(PLAN)).toBeTruthy()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(host.act).toHaveBeenCalledWith('p1', ['done', '--', PLAN]))
    })

    test('an entry whose file is there already (a plan already written) is left over: its row offers no start, only its removal, and the batch leaves it out', async () => {
      const names = async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md', done: { ask: PLAN, title: 'Plan: Login page · already written' } } })
      show([{ entry: PLAN, priority: 8 }, { entry: 'Urgent', priority: 8 }, { entry: 'Later', priority: 3 }], naming(names))
      await screen.findByRole('button', { name: 'Plan: Login page · already written' })
      expect(screen.queryByRole('button', { name: 'Start now: entry 1' })).toBeNull()
      await openMenu(screen.getByRole('button', { name: 'More for entry 1' }))
      expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Remove from the queue'])
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      expect((screen.getByRole('spinbutton', { name: 'How many agents to start' }) as HTMLInputElement).max).toBe('2')
      fireEvent.click(screen.getByRole('button', { name: 'Start 2 agents' }))
      await waitFor(() =>
        expect(host.startRun.mock.calls).toEqual([
          ['p1', workOnEntryPrompt('Urgent'), { land: false }],
          ['p1', workOnEntryPrompt('Later'), { land: false }],
        ]),
      )
    })

    test('an entry that names a plan already written but asks something else of it is work: its row offers a start, and the batch takes it', async () => {
      const review = 'Review tickets/2026-08-01_login-page.plan.md for accessibility issues'
      const names = async () => ({ 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md', done: { ask: PLAN, title: 'Plan: Login page · already written' } } })
      show([{ entry: review, priority: 8 }], naming(names))
      // Named as the plan it asks about: "already written" would say it is done.
      await screen.findByRole('button', { name: 'Plan: Login page' })
      expect(screen.getByRole('button', { name: 'Start now: entry 1' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Start 1 agent' }))
      await waitFor(() => expect(host.startRun.mock.calls).toEqual([['p1', workOnEntryPrompt(review), { land: false }]]))
    })

    test('a queued link reads as its text; to a web address it opens there, into the project it opens the page that names its target', async () => {
      const openPage = vi.fn()
      show(
        [{ entry: '[Upstream bug](https://github.com/x/y/issues/1)' }, { entry: '[Login page](tickets/2026-08-01_login-page.md)' }],
        naming(async () => ({ 'tickets/2026-08-01_login-page.md': { title: 'Login page, as the ticket says' } })),
        { services: { ...INERT_HOST_SERVICES, openPage } },
      )
      const upstream = await screen.findByRole('link', { name: 'Upstream bug' })
      expect(upstream.getAttribute('href')).toBe('https://github.com/x/y/issues/1')
      fireEvent.click(await screen.findByRole('button', { name: 'Login page' }))
      expect(openPage).toHaveBeenCalledWith('tickets', ['2026-08-01_login-page.md'], 'p1')
    })
  })

  test('a second visit opens with the last list at once, faded once its fresh read has been out a second', async () => {
    show()
    await screen.findByText('Hot fix')
    cleanup()
    forgetRemembered()
    const slow = fakeHost()
    // Answered only once the test has looked, so no read is left out for the next test.
    const reads: (() => void)[] = []
    slow.call.mockImplementation(() => new Promise(resolve => reads.push(() => resolve({ ok: false, error: 'read too late' }))))
    try {
      renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, slow, NO_MODULES)
      const entry = screen.getByText('Hot fix')
      expect(entry.closest('[data-stale]')).toBeNull()
      await waitFor(() => expect(entry.closest('[data-stale]')).not.toBeNull(), { timeout: 2000 })
    } finally {
      for (const answer of reads) answer()
      await waitFor(() => expect(document.querySelector('[data-stale]')).toBeNull())
      cleanup()
      forgetRemembered()
    }
  })

  test('a second visit names the entries from the first frame: the names read last time stand until the fresh read lands, or until the page that names them is in', async () => {
    const named = { 'tickets/2026-08-01_login-page.plan.md': { title: 'Plan: Login page', href: 'tickets/2026-08-01_login-page.md' } }
    const tickets = (names: () => Promise<typeof named>): MountedModules => mountedOf({ views: { 'app.page': [{ place: 'app.page', id: 'tickets', label: 'Tickets', View: () => null, package: 'a-tickets', projects: ['p1'], names }] } })
    show([{ entry: PLAN, priority: 5 }], tickets(async () => named))
    await screen.findByRole('button', { name: 'Plan: Login page' })
    cleanup()
    forgetRemembered()
    show([{ entry: PLAN, priority: 5 }], tickets(() => new Promise(() => {})))
    expect(screen.getByRole('button', { name: 'Plan: Login page' })).toBeTruthy()
    // Nor while the page that names it is not in yet: no answer is no name.
    cleanup()
    forgetRemembered()
    show([{ entry: PLAN, priority: 5 }], { ...NO_MODULES, loaded: false })
    await waitFor(() => expect(host.call).toHaveBeenCalledWith('p1', 'entries', {}))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByRole('button', { name: 'Plan: Login page' })).toBeTruthy()
  })

  test('a project whose queue cannot be read is named with the reason, and has no field to add to', async () => {
    host = fakeHost({})
    renderWithHost(<QueuePage projects={[alpha]} projectId={null} path={[]} />, host)
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read the queue of alpha: no answer for p1: entries')
    expect(screen.queryByRole('textbox', { name: 'A task to add to the queue' })).toBeNull()
  })
})
