import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ModuleHostContext, type ModuleHost, type ModuleProject } from '@openagt/dashboard/module'
import { SchedulerCard, offWords } from './SchedulerCard.js'
import defineScheduler from './index.js'
import { ON_CLAUDE, STATUS, hostAnswering } from './fixtures.js'

const GEMSTACK = { id: 'p1', name: 'gemstack', gitHost: true }
const OTHER = { id: 'p2', name: 'other', gitHost: false }

function show(host: ModuleHost, projects: ModuleProject[] = [GEMSTACK, OTHER]) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <SchedulerCard projects={projects} />
    </ModuleHostContext.Provider>,
  )
}

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()
const HOUR = 3_600_000

/** The fixture's two rows, the first with a start an hour ago: `post-merge-cleanup` is on and runs once a day, `work-queue` is off. */
const RAN = { ...STATUS, schedule: [{ ...STATUS.schedule[0], lastRun: { id: '2026-10-03T10-00-00-000Z', at: ago(HOUR) } }, STATUS.schedule[1]] }
const project = (name: string): HTMLElement => screen.getByRole('listitem', { name })

afterEach(cleanup)

describe('the Automations card of the Overview', () => {
  test('it is called what its page is called, and its title opens that page', async () => {
    const { host } = hostAnswering(() => ({ ok: true, output: RAN }))
    show(host, [GEMSTACK])
    const title = await screen.findByRole('link', { name: 'Automations' })
    expect(title.getAttribute('href')).toBe('/automations')
    fireEvent.click(title)
    expect(host.openPage).toHaveBeenCalledWith('automations')
  })

  test('per project: the rows that are on, each with when it starts next, and one line for the rows that are off; a row whose last look started a run opens that agent', async () => {
    const { host } = hostAnswering(projectId => ({ ok: true, output: projectId === 'p1' ? RAN : { ok: true, on: false, keepAlive: true, running: false, model: 'opus', spendOffset: 7 } }))
    show(host)
    const row = within(await screen.findByRole('listitem', { name: 'gemstack' }))
    expect(row.getByText('/post-merge-cleanup')).toBeTruthy()
    expect(row.getByText('Next start in 23h')).toBeTruthy()
    // The row that is off is counted, not listed.
    expect(row.queryByText(/work-queue/)).toBeNull()
    expect(row.getByText('1 more is switched off.')).toBeTruthy()
    expect(row.getByText('Scheduler on').className).toMatch(/text-success/)
    row.getByRole('button', { name: /^Started an agent .*: open it$/ }).click()
    expect(host.openAgent).toHaveBeenCalledWith('p1', '2026-10-03T10-00-00-000Z')
    // A project whose scheduler is off, with nothing scheduled: its status, its keep-alive mark, no row.
    const other = within(project('other'))
    expect(other.getByText('Scheduler off')).toBeTruthy()
    expect(other.getByText('keep-alive')).toBeTruthy()
    expect(other.queryByText(/switched off/)).toBeNull()
  })

  test('a row with a shell line says its next start as its Edit panel would: the wait left, if there is work; then that it starts when there is work', async () => {
    const queue = { command: 'work-queue', every: '6h', when: 'npx queue', waitsFor: 'when the queue holds a task', ...ON_CLAUDE }
    const { host } = hostAnswering(() => ({ ok: true, output: { ...STATUS, switches: { 'work-queue': '2026-10-03T08:00:00.000Z', 'plan-tickets': '2026-10-03T08:00:00.000Z' }, lastTick: { at: STATUS.lastTick.at, decisions: [] }, schedule: [{ ...queue, lastRun: { id: 'r1', at: ago(3 * HOUR) } }, { ...queue, command: 'plan-tickets', lastRun: { id: 'r2', at: ago(9 * HOUR) } }] } }))
    show(host, [GEMSTACK])
    expect(await screen.findByText('Next start in 3h, if there is work')).toBeTruthy()
    expect(screen.getByText('Starts when there is work')).toBeTruthy()
    expect(screen.queryByText(/switched off/)).toBeNull()
  })

  test('with one project shown its name is not repeated; with nothing switched on the card says so and offers the page', async () => {
    const { host } = hostAnswering(() => ({ ok: true, output: { ...STATUS, switches: {} } }))
    show(host, [GEMSTACK])
    expect(await screen.findByText('All 2 are switched off.')).toBeTruthy()
    expect(screen.queryByText('gemstack')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Switch one on' }))
    expect(host.openPage).toHaveBeenCalledWith('automations')
  })

  test('a scheduler whose process is gone: its rows are on and nothing starts, said once, with no next start on a row', async () => {
    const { host } = hostAnswering(() => ({ ok: true, output: { ...RAN, running: false } }))
    show(host, [GEMSTACK])
    expect((await screen.findByText('Scheduler on, not running')).className).toMatch(/text-warning/)
    expect(screen.getByText('The scheduler is on, but not running: nothing starts by itself.')).toBeTruthy()
    expect(screen.getByText('/post-merge-cleanup')).toBeTruthy()
    expect(screen.queryByText(/Next start|Starts /)).toBeNull()
  })

  test('a look that decided nothing says why', async () => {
    const { host } = hostAnswering(() => ({ ok: true, output: { ...STATUS, schedule: [], lastTick: { at: STATUS.lastTick.at, decisions: [], note: 'no skill of this project schedules a command' } } }))
    show(host, [GEMSTACK])
    expect(await screen.findByText('Its last look: no skill of this project schedules a command')).toBeTruthy()
  })

  test('a project whose status cannot be read says why', async () => {
    const { host } = hostAnswering(() => ({ ok: false, error: 'not inside a git repository' }))
    show(host, [GEMSTACK])
    expect(await screen.findByText('Scheduler not readable')).toBeTruthy()
    expect(screen.getByText('not inside a git repository')).toBeTruthy()
  })

  test('how the rows that are off are counted, in a line', () => {
    expect(offWords(0, 3)).toBeUndefined()
    expect(offWords(1, 2)).toBe('1 more is switched off')
    expect(offWords(5, 1)).toBe('5 more are switched off')
    expect(offWords(6, 0)).toBe('All 6 are switched off')
    expect(offWords(1, 0)).toBe('Its one automation is switched off')
  })
})

describe('what the module tells the other pages starts by itself', () => {
  const read = (output: unknown) => defineScheduler.schedule!.read(hostAnswering(() => ({ ok: true, output })).host, GEMSTACK)

  test('each scheduled command with whether it starts by itself now, and for one switched on when it starts next', async () => {
    expect(defineScheduler.schedule!.page).toBe('automations')
    expect(await read(RAN)).toEqual([
      { command: 'post-merge-cleanup', on: true, note: 'Next start in 23h' },
      { command: 'work-queue', on: false },
    ])
  })

  test('a command switched on in a project whose scheduler is not running does not start by itself, and the note says why', async () => {
    expect(await read({ ...RAN, on: false, running: false })).toEqual([
      { command: 'post-merge-cleanup', on: false, note: 'The scheduler is off' },
      { command: 'work-queue', on: false },
    ])
  })

  test('a project whose status cannot be read is not said to have nothing: the read fails, with why', async () => {
    await expect(defineScheduler.schedule!.read(hostAnswering(() => ({ ok: false, error: 'not inside a git repository' })).host, GEMSTACK)).rejects.toThrow('not inside a git repository')
  })

  test('a command whose coding agent cannot run it does not start by itself, whatever its switch, and the note says why', async () => {
    const answer = await read({ ...RAN, runsOn: { 'post-merge-cleanup': 'codex' } })
    expect(answer[0]).toEqual({ command: 'post-merge-cleanup', on: false, note: 'Cannot start on Codex: its skill is not in .agents/skills' })
  })

  test('a scheduler that is off says so once, and not again as its last look\'s word', async () => {
    const { host } = hostAnswering(() => ({ ok: true, output: { ...RAN, on: false, running: false, lastTick: { at: STATUS.lastTick.at, decisions: [], note: 'off' } } }))
    show(host, [GEMSTACK])
    expect(await screen.findByText('Scheduler off')).toBeTruthy()
    expect(screen.getByText('The scheduler is off: nothing starts by itself.')).toBeTruthy()
    expect(screen.queryByText(/last look/)).toBeNull()
  })
})
