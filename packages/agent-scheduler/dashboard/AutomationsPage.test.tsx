import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModuleHostContext, type ModuleCommandResult, type ModuleHost, type ModuleProject } from '@openagt/dashboard/module'
import { AutomationsPage } from './AutomationsPage.js'
import { ANY_AGENT, ON_CLAUDE, STATUS, hostAnswering } from './fixtures.js'
import { checked, choices, offered, openList, pick, queryRadio, radio, radioNames, showing } from './test-controls.js'

// The coding agents' own lists, as the dashboard asked them: what a row's agent and model are picked from, and named by.
vi.mock('../../openagent/dashboard/rpc/models.js', () => ({
  onModels: vi.fn(async () => ({
    'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5' }, { id: 'haiku', name: 'Haiku 5.5' }] },
    codex: { models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }] },
  })),
}))

const GEMSTACK = { id: 'p1', name: 'gemstack', gitHost: true }
const OTHER = { id: 'p2', name: 'other', gitHost: false }

function show(host: ModuleHost, projects: ModuleProject[] = [GEMSTACK]) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <AutomationsPage projects={projects} projectId={null} path={[]} />
    </ModuleHostContext.Provider>,
  )
}

/** A host whose `status` answers {@link STATUS} and whose saves are answered by `saved`. */
function scheduler(saved: (projectId: string, args: string[]) => ModuleCommandResult = () => ({ ok: true, output: { ok: true } })) {
  return hostAnswering((projectId, args) => (args[0] === 'status' ? { ok: true, output: STATUS } : saved(projectId, args)))
}

/** {@link STATUS} with two rows made with "New automation", both as the tool wrote them: one shared with the project, one kept on this machine. */
const MINE = {
  ...STATUS,
  schedule: [
    ...STATUS.schedule,
    { command: 'answer-comments', every: '15m', when: 'gh api comments', waitsFor: 'when someone commented', description: 'Answer each new comment below.', editable: true },
    { command: 'tidy', every: '1d', description: 'Tidy up.', onThisMachine: true, editable: true },
  ],
}

/** What `agent-scheduler show answer-comments` prints for the shared one. */
const SHOWN = { ok: true, name: 'answer-comments', prompt: 'Answer each new comment below.', every: '15m', when: 'gh api comments', waitsFor: 'when someone commented', file: '.claude/skills/answer-comments/SKILL.md' }

/** What `agent-scheduler show tidy` prints for the one kept on this machine. */
const KEPT = { ok: true, name: 'tidy', prompt: 'Tidy up.', every: '1d', file: '.agent-scheduler/automations/tidy.md', onThisMachine: true }

/** A host whose `status` answers {@link MINE}, whose `show` answers the automation asked for, and whose saves are answered by `saved`. */
function mine(saved: (projectId: string, args: string[]) => ModuleCommandResult = () => ({ ok: true, output: { ok: true } }), status: () => unknown = () => MINE) {
  return hostAnswering((projectId, args) => (args[0] === 'status' ? { ok: true, output: status() } : args[0] === 'show' ? { ok: true, output: args[1] === 'tidy' ? KEPT : SHOWN } : saved(projectId, args)))
}

type Ran = ReturnType<typeof hostAnswering>['runCommand']

/** What the page ran apart from its reads, the rows and an automation's file: its saves, in the order they were asked. */
const saves = (runCommand: Ran): string[][] => runCommand.mock.calls.filter(([, args]) => args[0] !== 'status' && args[0] !== 'show').map(([, args]) => args)

const row = (name: string): HTMLElement => screen.getByRole('listitem', { name })
const editing = (name: string): HTMLElement => screen.getByRole('group', { name: `Editing ${name}` })
const part = (panel: HTMLElement, name: string): HTMLElement => within(panel).getByRole('region', { name })
/** Whether a control takes no press: a button or a select held by the browser, or a radio that says it is held. */
const disabled = (control: HTMLElement): boolean => (control as HTMLButtonElement).disabled === true || control.getAttribute('aria-disabled') === 'true'
/** The select of a panel that picks how far its runs publish. */
const publish = (panel: HTMLElement): HTMLElement => within(panel).getByRole('combobox', { name: 'What its runs publish' })
/** What a panel or the form says its row waits for, which is no choice: the plain line that opens "When it runs". */
const waitsFor = (panel: HTMLElement): string => part(panel, 'When it runs').querySelector('p')?.textContent ?? ''
/** Open a row's panel and wait for it: a row a person made is read first. */
async function edit(name: string): Promise<HTMLElement> {
  fireEvent.click(within(row(name)).getByRole('button', { name: `Edit ${name}` }))
  return within(row(name)).findByRole('group', { name: `Editing ${name}` })
}
const gone = (name: string): Promise<void> => waitFor(() => expect(screen.queryByRole('group', { name: `Editing ${name}` })).toBeNull())
/** Wait for a row's panel to say its file was saved again, put the note away with Done, and answer what it said. */
async function savedAgain(name: string): Promise<string> {
  const done = await within(row(name)).findByRole('button', { name: 'Done' })
  const said = within(row(name)).getByRole('group', { name: `Editing ${name}` }).textContent ?? ''
  fireEvent.click(done)
  await gone(name)
  return said
}

afterEach(cleanup)

describe('the Automations page: its rows', () => {
  test("one row per scheduled command: the command, what its skill says it does, where it stands, when it runs in the skill's plain words, how far its runs publish, and its switch", async () => {
    const { host } = scheduler()
    show(host)
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    expect(screen.getByText("What starts by itself while nobody is at the keyboard. Every row starts switched off: it runs on this machine only once you switch it on here.")).toBeTruthy()
    expect(within(gemstack).getByText('Scheduler on').className).toMatch(/text-success/)
    expect(within(gemstack).getByText('opus')).toBeTruthy()
    // Nobody made a row of their own here: one group, the skills'.
    expect(within(gemstack).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(["From the project's skills"])

    const cleanupRow = row('/post-merge-cleanup')
    expect(within(cleanupRow).getByText('Write up merged pull requests.')).toBeTruthy()
    expect(within(cleanupRow).getByText('On').className).toMatch(/text-success/)
    expect(within(cleanupRow).getByText('Never ran')).toBeTruthy()
    expect(within(cleanupRow).getByText('Every 1 day')).toBeTruthy()
    expect(within(cleanupRow).getByText('May commit, pushes nothing')).toBeTruthy()
    expect(within(cleanupRow).getByRole('switch', { name: 'Run /post-merge-cleanup by itself' }).getAttribute('aria-checked')).toBe('true')

    // Nobody switched it on here: Off, whatever its skill says.
    const queueRow = row('/work-queue')
    expect(within(queueRow).getByText('Work one queued task.')).toBeTruthy()
    expect(within(queueRow).getByText('When the queue holds a task')).toBeTruthy()
    expect(within(queueRow).getByText('As its skill says')).toBeTruthy()
    expect(within(queueRow).getByText('Off').className).toMatch(/text-muted-foreground/)
    expect(within(queueRow).getByRole('switch', { name: 'Run /work-queue by itself' }).getAttribute('aria-checked')).toBe('false')
    // The same three controls on every row.
    for (const name of ['/post-merge-cleanup', '/work-queue']) expect(within(row(name)).getAllByRole('button').map(b => b.textContent)).toEqual(['Run now', 'Edit'])
  })

  test('a project\'s rows come in two groups, the automations a person made and the commands of the project\'s skills; a row a person made says who gets it, and one kept on this machine is named without a slash; only a row that could follow its skill marks a pick as "your pick"', async () => {
    const since = '2026-10-03T08:00:00.000Z'
    const picked = { ...MINE, paces: { tidy: { every: '1d', at: '10:00', since }, 'post-merge-cleanup': { every: '2d', since } }, agents: { 'answer-comments': 2, 'work-queue': 3 } }
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: picked } : { ok: true, output: { ok: true } }))
    show(host)
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    expect(within(gemstack).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Your automations', "From the project's skills"])
    const yours = within(gemstack).getByRole('group', { name: 'Your automations' })
    const skills = within(gemstack).getByRole('group', { name: "From the project's skills" })
    expect(within(yours).getByRole('heading', { name: 'Your automations' })).toBeTruthy()
    expect(within(skills).getByRole('heading', { name: "From the project's skills" })).toBeTruthy()
    expect(within(yours).getAllByRole('listitem').map(li => li.getAttribute('aria-label'))).toEqual(['/answer-comments', 'tidy'])
    expect(within(skills).getAllByRole('listitem').map(li => li.getAttribute('aria-label'))).toEqual(['/post-merge-cleanup', '/work-queue'])

    expect(within(row('/answer-comments')).getByText('shared with the project')).toBeTruthy()
    const kept = row('tidy')
    expect(within(kept).getByText('only on this machine')).toBeTruthy()
    // One kept on this machine is no command to type: no slash in its title, its buttons or its switch.
    expect(within(kept).getByText('tidy')).toBeTruthy()
    expect(within(kept).queryByText('/tidy')).toBeNull()
    expect(within(kept).getByRole('button', { name: 'Run tidy now' })).toBeTruthy()
    expect(within(kept).getByRole('button', { name: 'Edit tidy' })).toBeTruthy()
    fireEvent.click(within(kept).getByRole('switch', { name: 'Run tidy by itself' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['switch', 'tidy', 'on']))
    // A skill's row keeps its slash and says neither.
    for (const name of ['/post-merge-cleanup', '/work-queue']) expect(within(row(name)).queryByText(/only on this machine|shared with the project/)).toBeNull()

    // Everything on a row a person made is their pick; on a skill's row a pick of theirs is said.
    expect(within(kept).getByText('Every 1 day at 10:00')).toBeTruthy()
    expect(within(row('/answer-comments')).getByText('Up to 2 at once')).toBeTruthy()
    for (const name of ['/answer-comments', 'tidy']) expect(within(row(name)).queryByText('your pick')).toBeNull()
    expect(within(row('/post-merge-cleanup')).getByText('Every 2 days')).toBeTruthy()
    expect(within(row('/post-merge-cleanup')).getAllByText('your pick').length).toBe(1)
    expect(within(row('/work-queue')).getByText('Up to 3 at once')).toBeTruthy()
    expect(within(row('/work-queue')).getAllByText('your pick').length).toBe(1)
  })

  test('a project with rows of one kind alone shows that group alone', async () => {
    const own = { ...MINE, schedule: MINE.schedule.filter(c => 'editable' in c) }
    const { host } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: own } : { ok: true, output: { ok: true } }))
    show(host)
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    expect(within(gemstack).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Your automations'])
  })

  test('where a row stands, in one line: on or off; never ran, when it last ran, or that its last run failed, which opens that run; and what the scheduler last decided for it while it is on, in plain words', async () => {
    const on = '2026-10-03T08:00:00.000Z'
    const status = {
      ...STATUS,
      switches: { 'post-merge-cleanup': on, 'update-tickets': on, triage: on, 'plan-tickets': on, 'check-links': on },
      lastTick: {
        ...STATUS.lastTick,
        decisions: [
          { command: 'post-merge-cleanup', outcome: 'not due (last start 2h ago, every 1d)' },
          { command: 'update-tickets', outcome: 'not due' },
          { command: 'triage', outcome: 'cap reached (1 in flight: r9 on other-box)' },
          { command: 'plan-tickets', outcome: 'not due (next start from 2099-01-03 10:00, every 2d at 10:00)' },
          { command: 'check-links', outcome: 'check failed: gh: not found' },
          { command: 'work-queue', outcome: 'switched off on this machine' },
        ],
      },
      schedule: [
        { command: 'post-merge-cleanup', every: '1d', lastRun: { id: 'r1', at: new Date(Date.now() - 2 * 3_600_000).toISOString() } },
        { command: 'update-tickets', every: '15m', when: 'gh issue list' },
        { command: 'triage', every: '6h' },
        { command: 'plan-tickets', every: '2d' },
        { command: 'check-links', when: 'gh api' },
        { command: 'work-queue', when: 'npx queue', lastRun: { id: '2026-10-03T09-00-00-000Z', at: '2026-10-03T09:00:00.000Z', failed: true } },
      ],
    }
    const { host } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: status } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    // When it last ran is said with its age, and opens that run.
    const ran = within(row('/post-merge-cleanup')).getByRole('button', { name: /^Last ran \d+\w+ ago$/ })
    expect(ran.className).not.toMatch(/text-danger/)
    fireEvent.click(ran)
    expect(host.openAgent).toHaveBeenLastCalledWith('p1', 'r1')
    // A wait that is not over says when the row starts next.
    expect(within(row('/post-merge-cleanup')).getByText('Next start in 22h')).toBeTruthy()
    expect(within(row('/update-tickets')).getByText('Never ran')).toBeTruthy()
    expect(within(row('/update-tickets')).getByText('No work')).toBeTruthy()
    expect(within(row('/triage')).getByText('One is already running')).toBeTruthy()
    expect(within(row('/plan-tickets')).getByText('Next start 3 Jan 10:00')).toBeTruthy()
    // A reason only the tool knows is said in the tool's words.
    expect(within(row('/check-links')).getByText('Check failed: gh: not found')).toBeTruthy()
    // Switched off here, and its failure is still said: nothing tries the work again by itself. An off row says no decision.
    const off = row('/work-queue')
    const failed = within(off).getByRole('button', { name: /^Last run failed \d+\w+ ago$/ })
    expect(failed.className).toMatch(/text-danger/)
    fireEvent.click(failed)
    expect(host.openAgent).toHaveBeenLastCalledWith('p1', '2026-10-03T09-00-00-000Z')
    expect(within(off).getByText('Off')).toBeTruthy()
    expect(within(off).queryByText(/switched off/i)).toBeNull()
    expect(within(off).queryByText('No work')).toBeNull()
    expect(within(row('/update-tickets')).queryByRole('button', { name: /^Last r/ })).toBeNull()
  })

  test('a row set to a coding agent that cannot read its skill says so whatever its switch, read off the files and not off the last look, and its "Run now" is held: it would start nothing', async () => {
    // One skill only in Codex's folder and picked for Claude Code here; one in Claude Code's folder alone whose skill names Codex.
    const schedule = [
      { command: 'post-merge-cleanup', every: '1d', agent: 'codex', able: ['codex'] },
      { command: 'work-queue', when: 'npx queue', agent: 'codex', able: ['claude-code'] },
    ]
    const status = { ...STATUS, schedule, runsOn: { 'post-merge-cleanup': 'claude-code' }, lastTick: { ...STATUS.lastTick, decisions: [] } }
    const { host } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: status } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    // One switched on, one off: both say it.
    for (const [name, words] of [['/post-merge-cleanup', 'Cannot start on Claude Code: its skill is not in .claude/skills'], ['/work-queue', 'Cannot start on Codex: its skill is not in .agents/skills']] as const) {
      const said = within(row(name)).getByText(words)
      expect(said.className, name).toMatch(/text-warning/)
      expect(disabled(within(row(name)).getByRole('button', { name: `Run ${name} now` })), name).toBe(true)
      // Its picks can still be set: another agent is one of them.
      expect(disabled(within(row(name)).getByRole('button', { name: `Edit ${name}` })), name).toBe(false)
    }
  })

  test("flipping a row's switch runs `switch` in its project", async () => {
    const { host, runCommand } = scheduler()
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    fireEvent.click(screen.getByRole('switch', { name: 'Run /work-queue by itself' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['switch', 'work-queue', 'on']))
    fireEvent.click(screen.getByRole('switch', { name: 'Run /post-merge-cleanup by itself' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['switch', 'post-merge-cleanup', 'off']))
  })

  test('"Run now" runs `now` for its row, switched on or off, and the row says it started a run, which "Open it" opens; an answer that names no run still says it started', async () => {
    const answers: ModuleCommandResult[] = [
      { ok: true, output: { ok: true, command: 'work-queue', run: '2026-10-09T18-50-37-688Z' } },
      { ok: true, output: { ok: true } },
    ]
    const { host, runCommand } = scheduler((_, args) => (args[0] === 'now' ? answers.shift()! : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    // Switched off here: a person asked, so it starts all the same.
    const queue = row('/work-queue')
    const statusReads = runCommand.mock.calls.filter(([, args]) => args[0] === 'status').length
    fireEvent.click(within(queue).getByRole('button', { name: 'Run /work-queue now' }))
    const started = await within(queue).findByRole('status')
    expect(runCommand).toHaveBeenCalledWith('p1', ['now', 'work-queue'])
    expect(started.textContent).toBe('Started a run. Open it')
    expect(started.className).toMatch(/text-success/)
    // The rows were read again before it said so: the row then says when it last ran.
    expect(runCommand.mock.calls.filter(([, args]) => args[0] === 'status').length).toBeGreaterThan(statusReads)
    fireEvent.click(within(started).getByRole('button', { name: 'Open it' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', '2026-10-09T18-50-37-688Z')
    // Said on its own row alone.
    expect(within(row('/post-merge-cleanup')).queryByRole('status')).toBeNull()

    fireEvent.click(within(row('/post-merge-cleanup')).getByRole('button', { name: 'Run /post-merge-cleanup now' }))
    const unnamed = await within(row('/post-merge-cleanup')).findByRole('status')
    expect(unnamed.textContent?.trim()).toBe('Started a run.')
    expect(within(unnamed).queryByRole('button')).toBeNull()
    expect(saves(runCommand)).toEqual([['now', 'work-queue'], ['now', 'post-merge-cleanup']])
  })

  test('a "Run now" that starts nothing says why on its row: nothing to do, or one already running, is a plain note; anything else is said as a failure, in the page\'s words for the scheduler\'s decision; the next one takes the line away', async () => {
    const answers: ModuleCommandResult[] = [
      { ok: false, error: 'not due' },
      { ok: false, error: 'cap reached (1 in flight: 2026-10-09T18-50-37-688Z on this-box)' },
      { ok: false, error: "not on origin/main: a run's checkout starts from origin/main, and the command's skill is not there" },
      { ok: false, error: 'check failed: gh: not found' },
      { ok: false, error: 'agent-scheduler took too long' },
      { ok: false, error: 'not ready: `claude` is not logged in. Run `claude /login`, then start again.' },
      { ok: true, output: { ok: true, run: 'r1' } },
    ]
    const { host } = scheduler((_, args) => (args[0] === 'now' ? answers.shift()! : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const queue = row('/work-queue')
    const now = (): void => void fireEvent.click(within(queue).getByRole('button', { name: 'Run /work-queue now' }))
    now()
    const note = await within(queue).findByRole('status')
    expect(note.textContent).toBe('Nothing started. No work: its shell line printed nothing.')
    expect(note.className).toMatch(/text-muted-foreground/)
    expect(within(queue).queryByRole('alert')).toBeNull()
    now()
    await waitFor(() => expect(within(queue).getByRole('status').textContent).toBe('Nothing started. One is already running.'))
    expect(within(queue).queryByRole('alert')).toBeNull()
    now()
    const alert = await within(queue).findByRole('alert')
    expect(alert.textContent).toBe('Nothing started. Cannot start yet: its skill is not on origin/main.')
    expect(alert.className).toMatch(/text-danger/)
    expect(within(queue).queryByRole('status')).toBeNull()
    now()
    await waitFor(() => expect(within(queue).getByRole('alert').textContent).toBe('Nothing started. Check failed: gh: not found.'))
    now()
    // The dashboard ended the command before it answered: whether a run started is not known, and the row does not say that none did.
    await waitFor(() => expect(within(queue).getByRole('alert').textContent).toBe('No answer in time. A run may have started all the same: if one did, the row says when it last ran.'))
    // A reason that ends with its own full stop gets no second one.
    now()
    await waitFor(() => expect(within(queue).getByRole('alert').textContent).toBe('Nothing started. Not ready: `claude` is not logged in. Run `claude /login`, then start again.'))
    // One that starts takes the failure away.
    now()
    await within(queue).findByText('Started a run.')
    expect(within(queue).queryByRole('alert')).toBeNull()
  })

  test('a save the command refused says why on its own row; a refused pick is said in the open panel, which stays open; the next save takes the line away', async () => {
    let refuse = true
    const { host } = scheduler(() => (refuse ? { ok: false, error: 'the schedule of work-queue cannot be read: unknown key evry' } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    fireEvent.click(screen.getByRole('switch', { name: 'Run /work-queue by itself' }))
    const alert = await within(row('/work-queue')).findByRole('alert')
    expect(alert.textContent).toBe('The switch was not saved: the schedule of work-queue cannot be read: unknown key evry')
    expect(within(row('/post-merge-cleanup')).queryByRole('alert')).toBeNull()
    // Opening the row takes the line of the last save away.
    const panel = await edit('/work-queue')
    expect(within(row('/work-queue')).queryByRole('alert')).toBeNull()
    await pick(publish(panel), 'Commit')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe('The publish pick was not saved: the schedule of work-queue cannot be read: unknown key evry'))
    expect(editing('/work-queue')).toBeTruthy()
    expect(showing(publish(panel))).toBe('Commit')
    refuse = false
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('/work-queue')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a command that could not even be asked is a save not taken: the row says why, comes back, and the next save still runs', async () => {
    let down = true
    const { host, runCommand } = hostAnswering((projectId, args) => {
      if (args[0] === 'status') return { ok: true, output: STATUS }
      if (down) throw new Error('Failed to fetch')
      return { ok: true, output: { ok: true } }
    })
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    fireEvent.click(screen.getByRole('switch', { name: 'Run /work-queue by itself' }))
    expect((await within(row('/work-queue')).findByRole('alert')).textContent).toBe('The switch was not saved: Failed to fetch')
    await waitFor(() => expect(row('/work-queue').className).not.toMatch(/opacity-60/))
    expect(disabled(within(row('/work-queue')).getByRole('button', { name: 'Run /work-queue now' }))).toBe(false)
    down = false
    fireEvent.click(screen.getByRole('switch', { name: 'Run /post-merge-cleanup by itself' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['switch', 'post-merge-cleanup', 'off']))
    await waitFor(() => expect(row('/post-merge-cleanup').className).not.toMatch(/opacity-60/))
  })

  test("two projects: each under its own name with its scheduler's status, and a row saves in its own project", async () => {
    const { host, runCommand } = hostAnswering((projectId, args) =>
      args[0] === 'status' ? { ok: true, output: projectId === 'p1' ? STATUS : { ...STATUS, on: false, running: false, switches: {}, publishes: {} } } : { ok: true, output: { ok: true } },
    )
    show(host, [GEMSTACK, OTHER])
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    const other = screen.getByRole('region', { name: 'other' })
    expect(within(gemstack).getByText('Scheduler on')).toBeTruthy()
    expect(within(other).getByText('Scheduler off')).toBeTruthy()
    const cleanupThere = within(other).getByRole('switch', { name: 'Run /post-merge-cleanup by itself' })
    expect(cleanupThere.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(cleanupThere)
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p2', ['switch', 'post-merge-cleanup', 'on']))
    expect(runCommand).not.toHaveBeenCalledWith('p1', ['switch', 'post-merge-cleanup', 'on'])
    // "Run now" needs no scheduler running: offered in the project whose scheduler is off, and run there.
    fireEvent.click(within(other).getByRole('button', { name: 'Run /work-queue now' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p2', ['now', 'work-queue']))
  })

  test('a row is held, its three controls with it, until its save has answered and the rows were read again; the same command in another project is not; and saves go one at a time', async () => {
    const answers: ((result: ModuleCommandResult) => void)[] = []
    const { host, runCommand } = scheduler()
    runCommand.mockImplementation(async (_projectId: string, args: string[]) => (args[0] === 'status' ? { ok: true, output: STATUS } : new Promise<ModuleCommandResult>(resolve => answers.push(resolve))))
    show(host, [GEMSTACK, OTHER])
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    const held = within(gemstack).getByRole('listitem', { name: '/work-queue' })
    fireEvent.click(within(held).getByRole('switch', { name: 'Run /work-queue by itself' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['switch', 'work-queue', 'on']))
    expect(held.className).toMatch(/opacity-60/)
    expect(disabled(within(held).getByRole('button', { name: 'Run /work-queue now' }))).toBe(true)
    expect(disabled(within(held).getByRole('button', { name: 'Edit /work-queue' }))).toBe(true)
    expect(within(held).getByRole('switch', { name: 'Run /work-queue by itself' }).hasAttribute('data-disabled')).toBe(true)
    // The same command in the other project is not held.
    expect(within(screen.getByRole('region', { name: 'other' })).getByRole('listitem', { name: '/work-queue' }).className).not.toMatch(/opacity-60/)
    // A second save waits for the first: each reads the state file, changes it and writes it back.
    fireEvent.click(within(gemstack).getByRole('switch', { name: 'Run /post-merge-cleanup by itself' }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(saves(runCommand)).toEqual([['switch', 'work-queue', 'on']])
    answers[0]!({ ok: true, output: { ok: true } })
    await waitFor(() => expect(held.className).not.toMatch(/opacity-60/))
    await waitFor(() => expect(saves(runCommand)).toEqual([['switch', 'work-queue', 'on'], ['switch', 'post-merge-cleanup', 'off']]))
    expect(disabled(within(held).getByRole('button', { name: 'Edit /work-queue' }))).toBe(false)
    answers[1]!({ ok: true, output: { ok: true } })
    await waitFor(() => expect(within(gemstack).getByRole('listitem', { name: '/post-merge-cleanup' }).className).not.toMatch(/opacity-60/))
  })

  test('a tick that decided nothing says why in the heading; a scheduler that is off, or on with no process, says what that means and how it starts', async () => {
    const { host } = hostAnswering(projectId => ({ ok: true, output: { ...STATUS, ...(projectId === 'p1' ? { lastTick: { ...STATUS.lastTick, decisions: [], note: 'agent-data could not be pulled: origin is unreachable' } } : { on: false, lastTick: { ...STATUS.lastTick, decisions: [], note: 'off' } }) } }))
    show(host, [GEMSTACK, OTHER])
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    expect(within(gemstack).getByText(/: agent-data could not be pulled: origin is unreachable/)).toBeTruthy()
    const other = screen.getByRole('region', { name: 'other' })
    expect(within(other).getByText('Scheduler off')).toBeTruthy()
    expect(within(other).queryByText(/: off/)).toBeNull()
    expect(within(other).getByText('The scheduler is off in this project, so nothing here starts by itself. It starts with the dashboard once the project has run `npx @openagt/agent-scheduler@0.1 init`, or by hand with `npx @openagt/agent-scheduler@0.1 start`.')).toBeTruthy()
    expect(within(gemstack).queryByText(/so nothing here starts/)).toBeNull()
    cleanup()
    const { host: stopped } = hostAnswering(() => ({ ok: true, output: { ...STATUS, running: false } }))
    show(stopped)
    expect(await screen.findByText('The scheduler is on but its process is not running, so nothing here starts by itself. `npx @openagt/agent-scheduler@0.1 start`, run in the project, starts it.')).toBeTruthy()
  })

  test('a skill whose schedule cannot be read is named with the reason, and an automation kept on this machine that the scheduler does not list is said so in its own words', async () => {
    const status = { ...STATUS, unreadable: [{ skill: 'triage', reason: 'row 2: unknown key evry' }, { skill: 'tidy', reason: 'it has no schedule', own: true }] }
    const { host } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: status } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(screen.getAllByRole('alert').map(a => a.textContent)).toEqual(['The schedule of the triage skill cannot be read, so it is not listed: row 2: unknown key evry', 'The automation tidy, kept on this machine, is not listed: it has no schedule'])
    // The rows that could be read are listed all the same.
    expect(row('/work-queue')).toBeTruthy()
  })

  test('a project with nothing to list says so, the same whether or not its scheduler ever looked: the rows are read from its files; one whose scheduler cannot be read says why, and offers no "New automation"', async () => {
    const answers: Record<string, ModuleCommandResult> = {
      p1: { ok: true, output: { ok: true, on: true, keepAlive: false, running: true, model: 'opus', spendOffset: 7, schedule: [], unreadable: [] } },
      p2: { ok: false, error: 'not inside a git repository' },
      p3: { ok: true, output: { ok: true, on: true, keepAlive: false, running: true, model: 'opus', spendOffset: 7, schedule: [], unreadable: [], lastTick: { at: '2026-10-03T10:00:00.000Z', decisions: [], schedule: [], note: 'no skill of this project schedules a command' } } },
    }
    const { host } = hostAnswering(projectId => answers[projectId]!)
    show(host, [GEMSTACK, OTHER, { id: 'p3', name: 'third', gitHost: true }])
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    expect(within(gemstack).getByText('Nothing here: no skill of this project says it can be scheduled.')).toBeTruthy()
    expect(screen.queryByText(/has not looked at its skills/)).toBeNull()
    expect(within(gemstack).queryByRole('list')).toBeNull()
    expect(within(gemstack).queryByRole('group')).toBeNull()
    const other = screen.getByRole('region', { name: 'other' })
    expect(within(other).getByRole('alert').textContent).toBe('The scheduler could not be read: not inside a git repository')
    expect(within(other).getByText('Scheduler not readable')).toBeTruthy()
    expect(within(other).queryByRole('button', { name: /New automation/ })).toBeNull()
    // Never read once: the line alone, no row.
    expect(within(other).queryByRole('list')).toBeNull()
    const third = screen.getByRole('region', { name: 'third' })
    expect(within(third).getByText('Nothing here: no skill of this project says it can be scheduled.')).toBeTruthy()
    // Said once, in the page's words: the tick's own note for it is not repeated in the heading.
    expect(within(third).queryByText(/no skill of this project schedules a command/)).toBeNull()
    // A project with nothing listed can still be given an automation.
    expect(within(third).getByRole('button', { name: 'New automation in third' })).toBeTruthy()
  })
})

describe("the Edit panel of a skill's row", () => {
  test('Edit opens the panel in the row, with its parts in order: what it does is shown greyed, since its words are the skill\'s; nothing is to save until something changes; Save runs `publish` and closes it, Cancel saves nothing', async () => {
    const { host, runCommand } = scheduler()
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(screen.queryByRole('combobox', { name: 'What its runs publish' })).toBeNull()

    const editor = await edit('/post-merge-cleanup')
    expect(within(editor).getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual(['What it does', 'When it runs', 'How many at once', 'What it runs on', 'What its runs publish'])
    // A skill's row is read from what the scheduler listed: no file is opened.
    expect(runCommand.mock.calls.some(([, args]) => args[0] === 'show')).toBe(false)
    const does = part(editor, 'What it does')
    expect(within(does).getByText('Write up merged pull requests.')).toBeTruthy()
    expect(within(does).getByText("Its words are its skill's, /post-merge-cleanup: they are changed in the skill's file, by whoever writes the skill.")).toBeTruthy()
    expect(within(does).queryByRole('textbox')).toBeNull()
    expect(within(does).queryByText('Its shell line')).toBeNull()
    expect(within(editor).queryByRole('button', { name: 'Remove' })).toBeNull()
    // The row's line of picks gives way to the panel, which says them as they would be.
    expect(within(row('/post-merge-cleanup')).getAllByText(/May commit, pushes nothing/).length).toBe(1)
    const menu = publish(editor)
    expect(await choices(menu)).toEqual(['As the skill says', 'Commit', 'Publish branch', 'Open PR', 'Merge on green'])
    expect(showing(menu), 'nobody picked here').toBe('Commit')
    expect(within(editor).getByText('Every 1 day. Claude Code, Opus 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    expect(disabled(within(editor).getByRole('button', { name: 'Save' }))).toBe(true)
    expect(within(editor).getByText('Saved for you, in this project, on this machine. No tracked file changes.')).toBeTruthy()
    await pick(menu, 'Open PR')
    expect(showing(menu)).toBe('Open PR')
    expect(within(editor).getByText('Every 1 day. Claude Code, Opus 5.5. May open a pull request.')).toBeTruthy()
    // Nothing is saved until Save.
    expect(saves(runCommand)).toEqual([])
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['publish', 'post-merge-cleanup', 'pr']))
    await gone('/post-merge-cleanup')
    expect(within(row('/post-merge-cleanup')).getByText('May commit, pushes nothing')).toBeTruthy()

    // A skill with a shell line shows it, greyed, with what it waits for.
    const second = await edit('/work-queue')
    const shown = part(second, 'What it does')
    expect(within(shown).getByText('Work one queued task.')).toBeTruthy()
    expect(within(shown).getByText('Its shell line')).toBeTruthy()
    expect(within(shown).getByText('when the queue holds a task')).toBeTruthy()
    expect(shown.querySelector('pre')?.textContent).toBe('npx queue')
    expect(showing(publish(second))).toBe('As the skill says')
    await pick(publish(second), 'Merge on green')
    fireEvent.click(within(second).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Editing /work-queue' })).toBeNull()
    expect(saves(runCommand)).toEqual([['publish', 'post-merge-cleanup', 'pr']])
  })

  test('a skill that does not say what it does is said so', async () => {
    const status = { ...STATUS, schedule: [{ command: 'triage', every: '6h' }] }
    const { host } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: status } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(within(part(await edit('/triage'), 'What it does')).getByText('It does not say.')).toBeTruthy()
  })

  test('the panel offers how long the row waits after a start: as the skill says, or so many of a unit with a time of day for days or more; Save runs `pace`, and the sentence follows the pick', async () => {
    const { host, runCommand } = scheduler()
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const editor = await edit('/post-merge-cleanup')
    const when = part(editor, 'When it runs')
    expect(checked(radio(when, 'As the skill says'))).toBe(true)
    expect(within(when).getByText('(1 day)')).toBeTruthy()
    // Its skill gives no check: nothing could say when there is work.
    expect(queryRadio(editor, 'No wait')).toBeNull()

    // Picking a wait of one's own starts from the skill's own interval.
    fireEvent.click(radio(when, 'A wait you set'))
    expect(radioNames(when).map(name => checked(radio(when, name)))).toEqual([false, true])
    const count = within(editor).getByLabelText('How long') as HTMLInputElement
    const unit = within(editor).getByLabelText('Unit')
    expect([count.value, showing(unit)]).toEqual(['1', 'day'])
    expect(await choices(unit)).toEqual(['minute', 'hour', 'day', 'week', 'month'])
    fireEvent.change(count, { target: { value: '2' } })
    expect(showing(unit)).toBe('days')
    expect(await choices(unit)).toEqual(['minutes', 'hours', 'days', 'weeks', 'months'])
    expect(within(editor).getByText('Counted from its last start, on any machine that shares this repository.')).toBeTruthy()
    fireEvent.change(within(editor).getByLabelText('Time of day'), { target: { value: '10:00' } })
    expect(within(editor).getByText("optional, this machine's time")).toBeTruthy()
    expect(within(editor).getByText('Every 2 days at 10:00. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    expect(saves(runCommand)).toEqual([])
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['pace', 'post-merge-cleanup', '2d', '10:00']))
    await gone('/post-merge-cleanup')
    // The other picks did not change: one command ran.
    expect(saves(runCommand)).toEqual([['pace', 'post-merge-cleanup', '2d', '10:00']])
  })

  test('minutes and hours take no time of day; a count that is no whole number above 0 is no pace yet, and Save waits', async () => {
    const { host, runCommand } = scheduler()
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const editor = await edit('/post-merge-cleanup')
    fireEvent.click(radio(part(editor, 'When it runs'), 'A wait you set'))
    fireEvent.change(within(editor).getByLabelText('Time of day'), { target: { value: '10:00' } })
    await pick(within(editor).getByLabelText('Unit'), 'hour')
    expect(within(editor).queryByLabelText('Time of day')).toBeNull()
    expect(within(editor).getByText('Every 1 hour. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    const save = within(editor).getByRole('button', { name: 'Save' })
    for (const typed of ['', '0', '1.5']) {
      fireEvent.change(within(editor).getByLabelText('How long'), { target: { value: typed } })
      expect(disabled(save), typed).toBe(true)
      expect(within(editor).getByText('Type a whole number, from 1 to 9999.')).toBeTruthy()
    }
    // A time left half typed: the field has no text, the browser says the entry is bad, and Save waits.
    fireEvent.change(within(editor).getByLabelText('How long'), { target: { value: '2' } })
    await pick(within(editor).getByLabelText('Unit'), 'days')
    const time = within(editor).getByLabelText('Time of day') as HTMLInputElement
    Object.defineProperty(time, 'validity', { configurable: true, value: { badInput: true } })
    fireEvent.change(time, { target: { value: '' } })
    expect(disabled(save)).toBe(true)
    expect(within(editor).getByText('Finish the time, like 10:00, or clear it.')).toBeTruthy()
    Object.defineProperty(time, 'validity', { configurable: true, value: { badInput: false } })
    fireEvent.change(time, { target: { value: '09:30' } })
    expect(disabled(save)).toBe(false)
    expect(within(editor).getByText('Every 2 days at 09:30. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    fireEvent.change(time, { target: { value: '' } })
    expect(within(editor).getByText("optional, this machine's time")).toBeTruthy()
    await pick(within(editor).getByLabelText('Unit'), 'months')
    expect(within(editor).getByText("optional, this machine's time; a month counts as 30 days")).toBeTruthy()
    fireEvent.change(within(editor).getByLabelText('How long'), { target: { value: '30' } })
    await pick(within(editor).getByLabelText('Unit'), 'minutes')
    expect(disabled(save)).toBe(false)
    fireEvent.click(save)
    // The time typed beside days is not sent beside minutes.
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['pace', 'post-merge-cleanup', '30m']))
  })

  test('a row with a pace of its own opens on it; "As the skill says" takes it back; a row whose skill has an interval and a check is offered "No wait"; a pace and a publish pick changed together are two saves, the pace first', async () => {
    const since = '2026-10-08T07:00:00.000Z'
    const { host, runCommand } = hostAnswering((projectId, args) =>
      args[0] !== 'status'
        ? { ok: true, output: { ok: true } }
        : {
            ok: true,
            output: {
              ...STATUS,
              switches: { 'post-merge-cleanup': '2026-10-03T08:00:00.000Z', 'update-tickets': '2026-10-03T08:00:00.000Z' },
              paces: { 'post-merge-cleanup': { every: '2d', at: '10:00', since } },
              lastTick: { ...STATUS.lastTick, decisions: [] },
              schedule: [...STATUS.schedule, { command: 'update-tickets', every: '15m', when: 'gh issue list', waitsFor: 'when an issue changed' }],
            },
          },
    )
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(within(row('/post-merge-cleanup')).getByText('Every 2 days at 10:00')).toBeTruthy()
    expect(within(row('/update-tickets')).getByText('Every 15 minutes at most, when an issue changed')).toBeTruthy()

    const editor = await edit('/post-merge-cleanup')
    expect(checked(radio(part(editor, 'When it runs'), 'A wait you set'))).toBe(true)
    expect([(within(editor).getByLabelText('How long') as HTMLInputElement).value, showing(within(editor).getByLabelText('Unit')), (within(editor).getByLabelText('Time of day') as HTMLInputElement).value]).toEqual(['2', 'days', '10:00'])
    expect(within(editor).getByText('Every 2 days at 10:00. Claude Code, Opus 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    fireEvent.click(radio(part(editor, 'When it runs'), 'As the skill says'))
    expect(within(editor).getByText('Every 1 day. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['pace', 'post-merge-cleanup', 'skill']))
    await gone('/post-merge-cleanup')

    const second = await edit('/update-tickets')
    // What it waits for is said, not picked; what its skill says is the wait alone.
    expect(waitsFor(second)).toBe('Only when there is work: when an issue changed. The scheduler looks every minute.')
    expect(within(part(second, 'When it runs')).getByText('(15 minutes)')).toBeTruthy()
    fireEvent.click(radio(second, 'No wait'))
    expect(checked(radio(second, 'No wait'))).toBe(true)
    expect(within(second).getByText('When an issue changed. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    await pick(publish(second), 'Open PR')
    fireEvent.click(within(second).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['publish', 'update-tickets', 'pr']))
    expect(saves(runCommand)).toEqual([
      ['pace', 'post-merge-cleanup', 'skill'],
      ['pace', 'update-tickets', 'work'],
      ['publish', 'update-tickets', 'pr'],
    ])
    await gone('/update-tickets')
  })

  test('a row with a shell line says what it waits for in a plain line, which is no choice, and that the scheduler looks every minute; the one choice is how long it waits after a start, of three: as the skill says, a wait of one\'s own, or no wait', async () => {
    const lines = [
      { command: 'update-tickets', every: '15m', when: 'gh issue list', waitsFor: 'when an issue changed' },
      { command: 'check-links', every: '1h', when: 'gh api' },
      { command: 'triage', every: '6h', when: 'gh api', waitsFor: 'when a ticket has no label.' },
    ]
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: { ...STATUS, schedule: [...STATUS.schedule, ...lines] } } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const editor = await edit('/update-tickets')
    const when = part(editor, 'When it runs')
    expect(waitsFor(editor)).toBe('Only when there is work: when an issue changed. The scheduler looks every minute.')
    // The choice comes after, under its own name: the line above it is not one of the things to pick.
    const wait = within(when).getByText('Wait after a start').parentElement!
    expect(within(wait).queryByText(/Only when there is work/)).toBeNull()
    // One group with one name: the radio group's, and no second group around it.
    expect(within(when).queryByRole('group')).toBeNull()
    expect(within(wait).getByRole('radiogroup', { name: 'How long /update-tickets waits after a start' })).toBeTruthy()
    expect(radioNames(when).map(name => [name, checked(radio(when, name))])).toEqual([['As the skill says', true], ['A wait you set', false], ['No wait', false]])
    expect(within(wait).getByText('(15 minutes)')).toBeTruthy()
    expect(within(wait).getByText('it starts as soon as there is work')).toBeTruthy()
    expect(within(wait).getByText('Counted from its last start, on any machine that shares this repository.')).toBeTruthy()
    // A shell line with no plain words is said by what it does; words that end a sentence get no second full stop.
    expect(waitsFor(await edit('/check-links'))).toBe('Only when there is work: when its shell line prints something. The scheduler looks every minute.')
    expect(waitsFor(await edit('/triage'))).toBe('Only when there is work: when a ticket has no label. The scheduler looks every minute.')
    // A shell line and no interval: what the skill says is no wait already, so it is not offered a second time.
    const queue = part(await edit('/work-queue'), 'When it runs')
    expect(waitsFor(editing('/work-queue'))).toBe('Only when there is work: when the queue holds a task. The scheduler looks every minute.')
    expect(radioNames(queue)).toEqual(['As the skill says', 'A wait you set'])
    expect(within(queue).getByText('(no wait)')).toBeTruthy()
    expect(saves(runCommand)).toEqual([])
  })

  test('a row with no shell line runs by time alone, said in the plain line, and is offered no "No wait": nothing could say when there is work', async () => {
    const { host } = scheduler()
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const editor = await edit('/post-merge-cleanup')
    const when = part(editor, 'When it runs')
    expect(waitsFor(editor)).toBe('By time alone. It starts again once the wait is over.')
    expect(within(when).queryByText(/Only when there is work|The scheduler looks every minute/)).toBeNull()
    expect(within(when).getByText('Wait after a start')).toBeTruthy()
    expect(radioNames(when).map(name => [name, checked(radio(when, name))])).toEqual([['As the skill says', true], ['A wait you set', false]])
    expect(queryRadio(when, 'No wait')).toBeNull()
    expect(within(when).queryByText(/it starts as soon as there is work|needs a shell line/)).toBeNull()
  })

  test('beside a shell line a time of day is "not before": the row starts once the line finds work, which may be later that day, and the field is named so; a row that runs by time alone starts "at" it, in a field named "Time of day"', async () => {
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: { ...STATUS, schedule: [...STATUS.schedule, { command: 'update-tickets', every: '15m', when: 'gh issue list', waitsFor: 'when an issue changed' }] } } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const editor = await edit('/update-tickets')
    const when = part(editor, 'When it runs')
    // Minutes take no time of day, under either name.
    expect(within(when).queryByLabelText(/time of day/i)).toBeNull()
    await pick(within(when).getByLabelText('Unit'), 'days')
    const time = within(when).getByLabelText('Not before this time of day') as HTMLInputElement
    expect(time.type).toBe('time')
    expect(within(when).queryByLabelText('Time of day')).toBeNull()
    expect(within(when).getByText('not before')).toBeTruthy()
    expect(within(when).queryByText('at')).toBeNull()
    fireEvent.change(time, { target: { value: '10:00' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await gone('/update-tickets')
    expect(saves(runCommand)).toEqual([['pace', 'update-tickets', '15d', '10:00']])

    const alone = part(await edit('/post-merge-cleanup'), 'When it runs')
    expect((within(alone).getByLabelText('Time of day') as HTMLInputElement).type).toBe('time')
    expect(within(alone).queryByLabelText('Not before this time of day')).toBeNull()
    expect(within(alone).getByText('at')).toBeTruthy()
    expect(within(alone).queryByText('not before')).toBeNull()
  })

  test('a wait typed while another choice is picked is the pick: the number, the unit and the time of day are open whatever is picked, and typing in one, or picking a unit, picks "A wait you set"; Save runs `pace` with what was typed', async () => {
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: { ...STATUS, schedule: [...STATUS.schedule, { command: 'update-tickets', every: '15m', when: 'gh issue list' }] } } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const picks = (when: HTMLElement): [string, boolean][] => radioNames(when).map(name => [name, checked(radio(when, name))])
    let editor = await edit('/post-merge-cleanup')
    let when = part(editor, 'When it runs')
    expect(picks(when)).toEqual([['As the skill says', true], ['A wait you set', false]])
    // Not held while the skill is followed: they show the skill's own interval, to start from.
    const count = within(when).getByLabelText('How long') as HTMLInputElement
    expect([count.value, showing(within(when).getByLabelText('Unit'))]).toEqual(['1', 'day'])
    expect([count, within(when).getByLabelText('Unit'), within(when).getByLabelText('Time of day')].map(disabled)).toEqual([false, false, false])
    expect(within(editor).getByText('Every 1 day. Claude Code, Opus 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    fireEvent.change(count, { target: { value: '3' } })
    expect(picks(when)).toEqual([['As the skill says', false], ['A wait you set', true]])
    expect(within(editor).getByText('Every 3 days. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await gone('/post-merge-cleanup')
    expect(saves(runCommand)).toEqual([['pace', 'post-merge-cleanup', '3d']])

    // A unit picked is a wait typed too.
    editor = await edit('/post-merge-cleanup')
    when = part(editor, 'When it runs')
    expect(picks(when)).toEqual([['As the skill says', true], ['A wait you set', false]])
    await pick(within(when).getByLabelText('Unit'), 'week')
    expect(picks(when)).toEqual([['As the skill says', false], ['A wait you set', true]])
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await gone('/post-merge-cleanup')
    expect(saves(runCommand).slice(1)).toEqual([['pace', 'post-merge-cleanup', '1w']])

    // So is a time of day.
    editor = await edit('/post-merge-cleanup')
    when = part(editor, 'When it runs')
    fireEvent.change(within(when).getByLabelText('Time of day'), { target: { value: '08:30' } })
    expect(picks(when)).toEqual([['As the skill says', false], ['A wait you set', true]])
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await gone('/post-merge-cleanup')
    expect(saves(runCommand).slice(2)).toEqual([['pace', 'post-merge-cleanup', '1d', '08:30']])

    // The same from "No wait".
    editor = await edit('/update-tickets')
    when = part(editor, 'When it runs')
    fireEvent.click(radio(when, 'No wait'))
    expect(picks(when)).toEqual([['As the skill says', false], ['A wait you set', false], ['No wait', true]])
    fireEvent.change(within(when).getByLabelText('How long'), { target: { value: '2' } })
    expect(picks(when)).toEqual([['As the skill says', false], ['A wait you set', true], ['No wait', false]])
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await gone('/update-tickets')
    expect(saves(runCommand).slice(3)).toEqual([['pace', 'update-tickets', '2m']])
  })

  test('a pace that is not taken stops there: the publish pick is not sent, the panel stays open with both picks, and says why', async () => {
    const { host, runCommand } = scheduler((projectId, args) => (args[0] === 'pace' ? { ok: false, error: 'post-merge-cleanup has no check, so nothing would say when there is work' } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const editor = await edit('/post-merge-cleanup')
    fireEvent.click(radio(part(editor, 'When it runs'), 'A wait you set'))
    fireEvent.change(within(editor).getByLabelText('How long'), { target: { value: '3' } })
    await pick(publish(editor), 'Open PR')
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect((await within(row('/post-merge-cleanup')).findByRole('alert')).textContent).toBe('The pace was not saved: post-merge-cleanup has no check, so nothing would say when there is work')
    const still = editing('/post-merge-cleanup')
    expect((within(still).getByLabelText('How long') as HTMLInputElement).value).toBe('3')
    expect(showing(publish(still))).toBe('Open PR')
    expect(saves(runCommand)).toEqual([['pace', 'post-merge-cleanup', '3d']])
    // Picking again takes the line away.
    fireEvent.change(within(still).getByLabelText('How long'), { target: { value: '4' } })
    expect(within(row('/post-merge-cleanup')).queryByRole('alert')).toBeNull()
  })

  test('the panel offers how many agents may work on the row at once: as the skill says, or up to a number; Save runs `agents`, between the pace and the publish pick; a row with its own number opens on it', async () => {
    const { host, runCommand } = hostAnswering((projectId, args) =>
      args[0] !== 'status'
        ? { ok: true, output: { ok: true } }
        : { ok: true, output: { ...STATUS, agents: { 'work-queue': 3 }, schedule: [{ command: 'post-merge-cleanup', every: '1d', agents: 2 }, STATUS.schedule[1]] } },
    )
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    // The skill lets two run at once; a person's own number shows on the row too.
    expect(within(row('/post-merge-cleanup')).getByText('Up to 2 at once')).toBeTruthy()
    expect(within(row('/post-merge-cleanup')).queryByText('your pick')).toBeNull()
    expect(within(row('/work-queue')).getByText('Up to 3 at once')).toBeTruthy()
    expect(within(row('/work-queue')).getByText('your pick')).toBeTruthy()

    const editor = await edit('/post-merge-cleanup')
    const many = part(editor, 'How many at once')
    expect(within(many).getByRole('radiogroup', { name: 'How many of /post-merge-cleanup at once' })).toBeTruthy()
    expect(radioNames(many)).toEqual(['As the skill says', 'A number you set'])
    expect(checked(radio(many, 'As the skill says'))).toBe(true)
    expect(within(many).getByText('(up to 2 at once)')).toBeTruthy()
    expect(within(many).getByText('A new one starts only when the row is due, and only while fewer than this are working on any machine that shares this repository.')).toBeTruthy()
    expect(within(editor).getByText('Every 1 day. Up to 2 at once. Claude Code, Opus 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    // Picking a number starts from the skill's.
    fireEvent.click(radio(many, 'A number you set'))
    expect([checked(radio(many, 'As the skill says')), checked(radio(many, 'A number you set'))]).toEqual([false, true])
    const count = within(many).getByLabelText('How many agents') as HTMLInputElement
    expect(count.value).toBe('2')
    const save = within(editor).getByRole('button', { name: 'Save' })
    for (const typed of ['', '0', '1.5', '100']) {
      fireEvent.change(count, { target: { value: typed } })
      expect(disabled(save), typed).toBe(true)
      expect(within(editor).getByText('Type a whole number of agents, from 1 to 99.')).toBeTruthy()
    }
    // Lowered to one where the skill lets two: the sentence says so, it does not go quiet.
    fireEvent.change(count, { target: { value: '1' } })
    expect(within(many).getByText('agent at once')).toBeTruthy()
    expect(within(editor).getByText('Every 1 day. One at a time. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    fireEvent.change(count, { target: { value: '4' } })
    expect(within(editor).getByText('Every 1 day. Up to 4 at once. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    fireEvent.click(radio(part(editor, 'When it runs'), 'A wait you set'))
    fireEvent.change(within(editor).getByLabelText('How long'), { target: { value: '3' } })
    await pick(publish(editor), 'Open PR')
    fireEvent.click(save)
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['publish', 'post-merge-cleanup', 'pr']))
    expect(saves(runCommand)).toEqual([
      ['pace', 'post-merge-cleanup', '3d'],
      ['agents', 'post-merge-cleanup', '4'],
      ['publish', 'post-merge-cleanup', 'pr'],
    ])
    await gone('/post-merge-cleanup')

    // A row with its own number opens on it, and "As the skill says" takes it back.
    const second = part(await edit('/work-queue'), 'How many at once')
    expect(checked(radio(second, 'A number you set'))).toBe(true)
    expect((within(second).getByLabelText('How many agents') as HTMLInputElement).value).toBe('3')
    expect(within(second).getByText('(one at a time)')).toBeTruthy()
    fireEvent.click(radio(second, 'As the skill says'))
    fireEvent.click(within(editing('/work-queue')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['agents', 'work-queue', 'skill']))
  })

  test("a person's own number of one is said on the row; a number of agents that is not taken stops there: the publish pick is not sent and the panel stays open; a pace that is no pace yet is the hint that shows first", async () => {
    const { host, runCommand } = hostAnswering((projectId, args) => {
      if (args[0] === 'status') return { ok: true, output: { ...STATUS, agents: { 'work-queue': 1 } } }
      return args[0] === 'agents' ? { ok: false, error: 'no skill of this project schedules post-merge-cleanup' } : { ok: true, output: { ok: true } }
    })
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    // The skill says nothing, so one at a time, and so does this person: said because it is their pick.
    expect(within(row('/work-queue')).getByText('One at a time')).toBeTruthy()
    expect(within(row('/work-queue')).getByText('your pick')).toBeTruthy()
    expect(within(row('/post-merge-cleanup')).queryByText('One at a time')).toBeNull()

    const editor = await edit('/post-merge-cleanup')
    const many = part(editor, 'How many at once')
    fireEvent.click(radio(many, 'A number you set'))
    // Both half typed: the pace's hint shows first, then the number's.
    fireEvent.change(within(many).getByLabelText('How many agents'), { target: { value: '' } })
    fireEvent.click(radio(part(editor, 'When it runs'), 'A wait you set'))
    fireEvent.change(within(editor).getByLabelText('How long'), { target: { value: '' } })
    expect(within(editor).getByText('Type a whole number, from 1 to 9999.')).toBeTruthy()
    fireEvent.change(within(editor).getByLabelText('How long'), { target: { value: '2' } })
    expect(within(editor).getByText('Type a whole number of agents, from 1 to 99.')).toBeTruthy()
    fireEvent.change(within(many).getByLabelText('How many agents'), { target: { value: '99' } })
    await pick(publish(editor), 'Open PR')
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect((await within(row('/post-merge-cleanup')).findByRole('alert')).textContent).toBe('The number of agents was not saved: no skill of this project schedules post-merge-cleanup')
    expect(editing('/post-merge-cleanup')).toBeTruthy()
    expect(saves(runCommand)).toEqual([
      ['pace', 'post-merge-cleanup', '2d'],
      ['agents', 'post-merge-cleanup', '99'],
    ])
  })

  test('a project with no git host package is offered no level, Commit and Publish branch only', async () => {
    const { host } = scheduler()
    show(host, [OTHER])
    await screen.findByRole('region', { name: 'other' })
    await edit('/post-merge-cleanup')
    expect(await choices(screen.getByRole('combobox', { name: 'What its runs publish' }))).toEqual(['As the skill says', 'Commit', 'Publish branch'])
  })

  test('while a panel saves it takes no more picks, no second Save and no Cancel, and Escape does not close it; it closes once what it saved has been read back', async () => {
    let answer!: (result: ModuleCommandResult) => void
    const { host, runCommand } = scheduler()
    runCommand.mockImplementation(async (_projectId: string, args: string[]) => (args[0] === 'status' ? { ok: true, output: STATUS } : new Promise<ModuleCommandResult>(resolve => (answer = resolve))))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const editor = await edit('/post-merge-cleanup')
    await pick(publish(editor), 'Open PR')
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['publish', 'post-merge-cleanup', 'pr']))
    expect(disabled(within(editor).getByRole('button', { name: 'Save' }))).toBe(true)
    expect(disabled(within(editor).getByRole('button', { name: 'Cancel' }))).toBe(true)
    expect(disabled(publish(editor))).toBe(true)
    // Every control says so itself: a Base UI radio or select is not held by a fieldset around it.
    expect(disabled(within(editor).getByLabelText('How many agents'))).toBe(true)
    expect(within(editor).getAllByRole('radio').map(disabled)).toEqual([true, true, true, true])
    expect(within(editor).getAllByRole('combobox').map(disabled)).toEqual([true, true, true, true])
    expect(disabled(within(editor).getByLabelText('How long'))).toBe(true)
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(editing('/post-merge-cleanup')).toBeTruthy()
    const statusReads = runCommand.mock.calls.filter(([, args]) => args[0] === 'status').length
    answer({ ok: true, output: { ok: true } })
    await gone('/post-merge-cleanup')
    expect(runCommand.mock.calls.filter(([, args]) => args[0] === 'status').length).toBeGreaterThan(statusReads)
    expect(saves(runCommand)).toEqual([['publish', 'post-merge-cleanup', 'pr']])
  })

  test('the keyboard follows the panel: opening it lands on the pace in force; Escape closes it while nothing is changed and hands the keyboard back to its Edit button; with a pick not saved Escape closes nothing, and Cancel does', async () => {
    const { host, runCommand } = scheduler()
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    let editor = await edit('/work-queue')
    expect(document.activeElement).toBe(radio(part(editor, 'When it runs'), 'As the skill says'))
    // Escape in a select's open list closes the list, not the panel.
    fireEvent.keyDown(await openList(publish(editor)), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(editing('/work-queue')).toBeTruthy()
    fireEvent.keyDown(publish(editor), { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Editing /work-queue' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit /work-queue' })))
    // A pick not saved: a slip of a key loses nothing.
    editor = await edit('/work-queue')
    await pick(publish(editor), 'Merge on green')
    fireEvent.keyDown(publish(editor), { key: 'Escape' })
    expect(editing('/work-queue')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Editing /work-queue' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit /work-queue' })))
    expect(saves(runCommand)).toEqual([])
  })
})

describe('the Edit panel of a row a person made', () => {
  test('Edit reads the automation with `show` and opens the same panel with its words to change: what the agent is told and its shell line, one pace control with no skill to follow, a lone number of agents, the publish menu, and Remove; one Save runs `edit`, `agents` and `publish` in that order and then says what is left to commit', async () => {
    const { host, runCommand } = mine(() => ({ ok: true, output: { ok: true, command: 'answer-comments', file: SHOWN.file, startsFrom: 'origin/main' } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const own = row('/answer-comments')
    const panel = await edit('/answer-comments')
    expect(runCommand).toHaveBeenCalledWith('p1', ['show', 'answer-comments'])
    // The same parts, in the same order, as a skill's row.
    expect(within(panel).getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual(['What it does', 'When it runs', 'How many at once', 'What it runs on', 'What its runs publish'])
    const does = part(panel, 'What it does')
    expect((within(does).getByLabelText('What the agent is told') as HTMLTextAreaElement).value).toBe('Answer each new comment below.')
    expect((within(does).getByLabelText(/A shell line that prints what is new/) as HTMLTextAreaElement).value).toBe('gh api comments')
    expect((within(does).getByLabelText(/What the line waits for/) as HTMLInputElement).value).toBe('when someone commented')
    expect(within(does).getByRole('button', { name: 'Try it' })).toBeTruthy()
    // The keyboard lands on what the agent is told.
    expect(document.activeElement).toBe(within(does).getByLabelText('What the agent is told'))
    // One pace control: the automation's own pace, with no skill to follow.
    const when = part(panel, 'When it runs')
    expect(radioNames(when)).toEqual(['A wait you set', 'No wait'])
    expect(checked(radio(when, 'A wait you set'))).toBe(true)
    expect([(within(when).getByLabelText('How long') as HTMLInputElement).value, showing(within(when).getByLabelText('Unit'))]).toEqual(['15', 'minutes'])
    // The wait is the least time between two starts: the row still starts only when its shell line finds work.
    expect(waitsFor(panel)).toBe('Only when there is work: when someone commented. The scheduler looks every minute.')
    expect(disabled(radio(when, 'No wait'))).toBe(false)
    // A lone number: there is no skill's number to go back to.
    const many = part(panel, 'How many at once')
    expect(within(many).queryByRole('radio')).toBeNull()
    expect((within(many).getByLabelText('How many agents') as HTMLInputElement).value).toBe('1')
    expect(showing(publish(panel))).toBe('Commit')
    expect(within(panel).getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect(within(panel).getByText(`Its words and its pace are in a skill file of this project, ${SHOWN.file}: a change to them is yours to commit. The rest is saved on this machine.`)).toBeTruthy()
    // Nothing to save yet.
    expect(within(panel).getByText('Every 15 minutes at most, when someone commented. Claude Code, Opus 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    expect(disabled(within(panel).getByRole('button', { name: 'Save' }))).toBe(true)

    fireEvent.change(within(does).getByLabelText('What the agent is told'), { target: { value: '- Answer in one line.' } })
    fireEvent.change(within(when).getByLabelText('How long'), { target: { value: '30' } })
    fireEvent.change(within(many).getByLabelText('How many agents'), { target: { value: '2' } })
    expect(within(many).getByText('agents at once')).toBeTruthy()
    await pick(publish(panel), 'Open PR')
    expect(within(panel).getByText('Every 30 minutes at most, when someone commented. Up to 2 at once. Claude Code, Opus 5.5. May open a pull request.')).toBeTruthy()
    const statusReads = runCommand.mock.calls.filter(([, args]) => args[0] === 'status').length
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    const saved = await within(own).findByText(/It is a change to a file of yours, in this project, and nothing was committed for you\./)
    // Its interval went into its file with its words: no pick of this machine's stands in for it.
    expect(saves(runCommand)).toEqual([
      ['edit', 'answer-comments', '--prompt=- Answer in one line.', '--every=30m', '--when=gh api comments', '--waits-for=when someone commented'],
      ['agents', 'answer-comments', '2'],
      ['publish', 'answer-comments', 'pr'],
    ])
    const note = editing('/answer-comments')
    expect(note.textContent).toContain(`Saved /answer-comments again, in ${SHOWN.file}.`)
    expect(saved.textContent).toContain('An agent is told the new words only once the change is on origin/main: commit it and bring it there.')
    // The row shows the change at once, so the note says nothing of when.
    expect(note.textContent).not.toMatch(/once the scheduler/)
    expect(runCommand.mock.calls.filter(([, args]) => args[0] === 'status').length).toBeGreaterThan(statusReads)
    // Saved: nothing is held any more, though the note is still up.
    await waitFor(() => expect(disabled(screen.getByRole('button', { name: 'Edit tidy' }))).toBe(false))
    fireEvent.click(within(note).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('group', { name: 'Editing /answer-comments' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit /answer-comments' })))
  })

  test('an automation kept on this machine opens the same way; a time of day alone is this machine\'s, kept with `pace` and no change to its file; a change to its words runs `edit` alone, and the panel closes with nothing to commit; a refused save says why and keeps what was typed; Cancel saves nothing', async () => {
    const answers: ModuleCommandResult[] = [
      { ok: true, output: { ok: true } },
      { ok: false, error: 'it cannot run as written: neither every nor when says when' },
      { ok: true, output: { ok: true, command: 'tidy', file: KEPT.file, startsFrom: 'origin/main', onThisMachine: true } },
    ]
    const { host, runCommand } = mine(() => answers.shift()!)
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    let panel = await edit('tidy')
    expect(runCommand).toHaveBeenCalledWith('p1', ['show', 'tidy'])
    // It follows no skill: with no level its runs do as its prompt says.
    expect((await choices(publish(panel)))[0]).toBe('As the prompt says')
    expect(within(panel).getByText('Kept on this machine alone, outside git: .agent-scheduler/automations/tidy.md.')).toBeTruthy()
    // It counts this machine's runs alone.
    expect(within(panel).getByText('Counted from its last start, on this machine.')).toBeTruthy()
    expect(within(panel).getByText(/only while fewer than this are working on this machine\./)).toBeTruthy()
    expect(within(panel).queryByText(/any machine that shares this repository/)).toBeNull()
    expect(waitsFor(panel)).toBe('By time alone. It starts again once the wait is over.')
    expect(within(panel).getByText('Every 1 day. Claude Code, Opus 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    fireEvent.change(within(panel).getByLabelText('Time of day'), { target: { value: '10:00' } })
    expect(within(panel).getByText('Every 1 day at 10:00. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('tidy')
    expect(saves(runCommand)).toEqual([['pace', 'tidy', '1d', '10:00']])

    panel = await edit('tidy')
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Tidy up, gently.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    expect((await within(panel).findByRole('alert')).textContent).toBe('It was not saved: it cannot run as written: neither every nor when says when')
    expect((within(panel).getByLabelText('What the agent is told') as HTMLTextAreaElement).value).toBe('Tidy up, gently.')
    // Typing again takes the refusal away.
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Tidy up, gently!' } })
    expect(within(panel).queryByRole('alert')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    // Nothing is left for the person to do, and the row shows the change at once: no note, the panel just closes.
    await gone('tidy')
    expect(screen.queryByText(/Saved tidy again/)).toBeNull()
    expect(saves(runCommand).slice(1)).toEqual([
      ['edit', 'tidy', '--prompt=Tidy up, gently.', '--every=1d', '--when=', '--waits-for='],
      ['edit', 'tidy', '--prompt=Tidy up, gently!', '--every=1d', '--when=', '--waits-for='],
    ])

    // Cancel: no command but the reads.
    panel = await edit('tidy')
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Never saved.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Editing tidy' })).toBeNull()
    expect(saves(runCommand).length).toBe(3)
  })

  test('an automation with no shell line has one way to run, after a wait, so nothing is to pick: no dot is drawn in "When it runs", the number and the unit alone; a shell line typed brings the choice of two, and taken out again takes it away; the same in "New automation"', async () => {
    const { host, runCommand } = mine()
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('tidy')
    const when = part(panel, 'When it runs')
    expect(waitsFor(panel)).toBe('By time alone. It starts again once the wait is over.')
    expect(within(when).queryByRole('radio')).toBeNull()
    expect(within(when).queryByRole('radiogroup')).toBeNull()
    // The wait is still there to type, under its name.
    const wait = within(when).getByRole('group', { name: 'Wait after a start' })
    expect([(within(wait).getByLabelText('How long') as HTMLInputElement).value, showing(within(wait).getByLabelText('Unit'))]).toEqual(['1', 'day'])
    expect([within(wait).getByLabelText('How long'), within(wait).getByLabelText('Unit'), within(wait).getByLabelText('Time of day')].map(disabled)).toEqual([false, false, false])
    expect(within(wait).getByText('Counted from its last start, on this machine.')).toBeTruthy()

    const line = within(panel).getByLabelText(/A shell line that prints what is new/)
    fireEvent.change(line, { target: { value: 'gh api threads' } })
    expect(within(when).getByRole('radiogroup', { name: 'How long tidy waits after a start' })).toBeTruthy()
    expect(radioNames(when).map(name => [name, checked(radio(when, name))])).toEqual([['A wait you set', true], ['No wait', false]])
    expect(waitsFor(panel)).toBe('Only when there is work: when its shell line prints something. The scheduler looks every minute.')
    // Beside a shell line the time of day is "not before".
    expect(within(when).getByLabelText('Not before this time of day')).toBeTruthy()
    expect(within(when).queryByLabelText('Time of day')).toBeNull()
    // A line of spaces is no line.
    fireEvent.change(line, { target: { value: '  ' } })
    expect(within(when).queryByRole('radio')).toBeNull()
    expect(within(when).getByLabelText('Time of day')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'New automation in gemstack' }))
    const form = part(screen.getByRole('group', { name: 'New automation' }), 'When it runs')
    expect(within(form).queryByRole('radio')).toBeNull()
    expect(within(form).queryByRole('radiogroup')).toBeNull()
    expect([(within(form).getByLabelText('How long') as HTMLInputElement).value, showing(within(form).getByLabelText('Unit'))]).toEqual(['1', 'day'])
    expect(saves(runCommand)).toEqual([])
  })

  test('an interval changed with a time of day is two saves: the interval into the file with `edit`, then the two with `pace`; a pick alone runs neither', async () => {
    const { host, runCommand } = mine(() => ({ ok: true, output: { ok: true, command: 'tidy', file: KEPT.file, startsFrom: 'origin/main', onThisMachine: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    let panel = await edit('tidy')
    fireEvent.change(within(panel).getByLabelText('How long'), { target: { value: '2' } })
    fireEvent.change(within(panel).getByLabelText('Time of day'), { target: { value: '09:30' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('tidy')
    expect(saves(runCommand)).toEqual([
      ['edit', 'tidy', '--prompt=Tidy up.', '--every=2d', '--when=', '--waits-for='],
      ['pace', 'tidy', '2d', '09:30'],
    ])
    panel = await edit('tidy')
    await pick(publish(panel), 'As the prompt says')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('tidy')
    expect(saves(runCommand).slice(2)).toEqual([['publish', 'tidy', 'nothing']])
  })

  test('"No wait" waits for a shell line; picked, the automation is saved with no interval; with the line taken out again nothing says when, and Save waits; "Try it" tries the line as it stands, and saves nothing', async () => {
    const { host, runCommand } = mine((_, args) => (args[0] === 'try' ? { ok: true, output: { ok: true, lastRun: '2026-10-08T10:00:00Z', ran: true, due: true, printed: '[1]' } } : { ok: true, output: { ok: true, command: args[1], file: 'f', startsFrom: 'HEAD', onThisMachine: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    // No shell line: nothing could say when there is something new.
    const kept = await edit('tidy')
    expect(queryRadio(kept, 'No wait')).toBeNull()
    expect(disabled(within(kept).getByRole('button', { name: 'Try it' }))).toBe(true)
    // The plain words show with no line too: they are what "Write the line" is asked from.
    expect(within(kept).getByLabelText(/What the line waits for/)).toBeTruthy()
    expect(disabled(within(kept).getByRole('button', { name: 'Write the line' }))).toBe(true)
    fireEvent.click(within(kept).getByRole('button', { name: 'Cancel' }))

    const panel = await edit('/answer-comments')
    const when = part(panel, 'When it runs')
    fireEvent.click(radio(when, 'No wait'))
    // The wait typed before is set aside, not held: typing in it would pick it back.
    expect(radioNames(when).map(name => checked(radio(when, name)))).toEqual([false, true])
    expect(within(panel).getByLabelText('How long').parentElement?.className).toMatch(/opacity-60/)
    expect(disabled(within(panel).getByLabelText('How long'))).toBe(false)
    expect(disabled(within(panel).getByLabelText('Unit'))).toBe(false)
    expect(within(when).getByText('it starts as soon as there is work')).toBeTruthy()
    expect(within(panel).getByText('When someone commented. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    const line = within(panel).getByLabelText(/A shell line that prints what is new/)
    fireEvent.change(line, { target: { value: '' } })
    expect(within(panel).getByText('Say when it runs: on a pace, by a shell line, or both.')).toBeTruthy()
    expect(disabled(within(panel).getByRole('button', { name: 'Save' }))).toBe(true)
    // The pick still shows, with what it lacks, so the person sees what to change.
    expect(checked(radio(when, 'No wait'))).toBe(true)
    expect(within(when).getByText('needs a shell line: without one nothing says when')).toBeTruthy()
    expect(waitsFor(panel)).toBe('By time alone. It starts again once the wait is over.')
    fireEvent.change(line, { target: { value: 'gh api other' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Try it' }))
    const answer = await within(panel).findByRole('status', { name: 'What the line answered' })
    expect(runCommand).toHaveBeenCalledWith('p1', ['try', '--when=gh api other'])
    expect(within(answer).getByText('It printed something: an agent would start now.')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['edit', 'answer-comments', '--prompt=Answer each new comment below.', '--every=', '--when=gh api other', '--waits-for=when someone commented']))
    expect(saves(runCommand)).toEqual([['try', '--when=gh api other'], ['edit', 'answer-comments', '--prompt=Answer each new comment below.', '--every=', '--when=gh api other', '--waits-for=when someone commented']])
  })

  test('a row has one pace: a time of day picked on this machine is shown with its interval, and clearing it takes the pick back with `pace … skill`; a pick of another interval made before opens as the row\'s pace with nothing to save, and goes into the file only with a change of the person\'s', async () => {
    const since = '2026-10-03T08:00:00.000Z'
    // A number of agents picked here that is the file's own is no pick to take back either.
    let picks: unknown = { paces: { tidy: { every: '1d', at: '10:00', since } }, agents: { tidy: 1 } }
    const kept = (): ModuleCommandResult => ({ ok: true, output: { ok: true, command: 'tidy', file: KEPT.file, startsFrom: 'HEAD', onThisMachine: true } })
    const { host, runCommand } = mine(kept, () => ({ ...MINE, ...(picks as object) }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(within(row('tidy')).getByText('Every 1 day at 10:00')).toBeTruthy()
    const panel = await edit('tidy')
    expect([(within(panel).getByLabelText('How long') as HTMLInputElement).value, showing(within(panel).getByLabelText('Unit')), (within(panel).getByLabelText('Time of day') as HTMLInputElement).value]).toEqual(['1', 'day', '10:00'])
    expect(within(panel).getByText('Every 1 day at 10:00. Claude Code, Opus 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    expect(disabled(within(panel).getByRole('button', { name: 'Save' }))).toBe(true)
    fireEvent.change(within(panel).getByLabelText('Time of day'), { target: { value: '' } })
    expect(within(panel).getByText('Every 1 day. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('tidy')
    // The file already says every day: only this machine's pick goes.
    expect(saves(runCommand)).toEqual([['pace', 'tidy', 'skill']])

    cleanup()
    picks = { paces: { tidy: { every: '2d', at: '10:00', since } } }
    const again = mine(kept, () => ({ ...MINE, ...(picks as object) }))
    show(again.host)
    await screen.findByRole('region', { name: 'gemstack' })
    const second = await edit('tidy')
    expect([(within(second).getByLabelText('How long') as HTMLInputElement).value, showing(within(second).getByLabelText('Unit')), (within(second).getByLabelText('Time of day') as HTMLInputElement).value]).toEqual(['2', 'days', '10:00'])
    // Opened, not changed: nothing is to save, and nothing else is held.
    expect(within(second).getByText('Every 2 days at 10:00. Claude Code, Opus 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    expect(disabled(within(second).getByRole('button', { name: 'Save' }))).toBe(true)
    expect(disabled(screen.getByRole('button', { name: 'Edit /work-queue' }))).toBe(false)
    fireEvent.change(within(second).getByLabelText('What the agent is told'), { target: { value: 'Tidy up, twice.' } })
    fireEvent.click(within(second).getByRole('button', { name: 'Save' }))
    await gone('tidy')
    // The interval goes into the file with the words; this machine already holds it with its time.
    expect(saves(again.runCommand)).toEqual([['edit', 'tidy', '--prompt=Tidy up, twice.', '--every=2d', '--when=', '--waits-for=']])
  })

  test('an automation whose file cannot be opened, changed by hand since it was saved, still opens its panel: what it does is shown greyed with why, its picks follow "As it was saved", and there is no Remove; so does one whose answer the panel cannot show', async () => {
    const refusal = '.claude/skills/answer-comments is a skill of the project, or an automation changed by hand since it was saved: edit or remove its files yourself'
    const answers: ModuleCommandResult[] = [{ ok: false, error: refusal }, { ok: true, output: { ok: true, name: 'answer-comments' } }]
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: MINE } : args[0] === 'show' ? answers.shift()! : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    let panel = await edit('/answer-comments')
    const does = part(panel, 'What it does')
    expect(within(does).getByText(`Its words cannot be changed here: ${refusal}`)).toBeTruthy()
    expect(within(does).getByText('Answer each new comment below.')).toBeTruthy()
    expect(does.querySelector('pre')?.textContent).toBe('gh api comments')
    expect(within(does).queryByRole('textbox')).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Try it' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Remove' })).toBeNull()
    // Its picks are this machine's, and follow how it was saved: it is no skill.
    expect(checked(radio(part(panel, 'When it runs'), 'As it was saved'))).toBe(true)
    expect(checked(radio(part(panel, 'How many at once'), 'As it was saved'))).toBe(true)
    // No pace and no number of a skill's to follow: the words are only the publish menu's first label.
    expect(radioNames(panel)).not.toContain('As the skill says')
    expect(within(panel).getByText('Saved for you, in this project, on this machine. No tracked file changes.')).toBeTruthy()
    // They can still be set.
    await pick(publish(panel), 'Open PR')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('/answer-comments')
    expect(saves(runCommand)).toEqual([['publish', 'answer-comments', 'pr']])

    panel = await edit('/answer-comments')
    expect(within(panel).getByText('Its words cannot be changed here: its file holds something this panel cannot show')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  test('an automation kept on this machine whose file the tool no longer reads as its own opens without asking for it: its picks follow "As it was saved", count this machine\'s runs alone, and it has no Remove', async () => {
    const status = { ...STATUS, schedule: [...STATUS.schedule, { command: 'watch-competitor', every: '1h', description: 'Look for new threads.', onThisMachine: true }] }
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: status } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    // Still a row of the person's own: in their group, named without a slash.
    expect(within(screen.getByRole('group', { name: 'Your automations' })).getByRole('listitem', { name: 'watch-competitor' })).toBeTruthy()
    const box = await edit('watch-competitor')
    expect(runCommand.mock.calls.some(([, args]) => args[0] === 'show')).toBe(false)
    expect(within(box).getAllByText('As it was saved').length).toBe(2)
    expect(radioNames(box)).toEqual(['As it was saved', 'A wait you set', 'As it was saved', 'A number you set'])
    expect(within(box).getByText('Counted from its last start, on this machine.')).toBeTruthy()
    expect(within(box).getByText(/only while fewer than this are working on this machine\./)).toBeTruthy()
    expect(within(box).queryByText(/any machine that shares this repository/)).toBeNull()
    expect(within(box).queryByRole('textbox')).toBeNull()
    expect(within(box).queryByRole('button', { name: 'Remove' })).toBeNull()
    // It is no skill: its words are in its own file, which the panel names.
    expect(within(box).getByText('Its words cannot be changed here: its file was changed by hand since it was saved. They are changed in the file itself, .agent-scheduler/automations/watch-competitor.md.')).toBeTruthy()
    expect(within(box).queryByText(/its skill's/)).toBeNull()
  })

  test('a row that goes while its panel is open, removed elsewhere, closes it, though it held a change: no panel is left open where nobody sees it, and the buttons it held come back', async () => {
    let status: unknown = MINE
    const { host } = mine(undefined, () => status)
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('/answer-comments')
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Typed, then its file was deleted.' } })
    expect(disabled(screen.getByRole('button', { name: 'Edit tidy' }))).toBe(true)
    expect(disabled(screen.getByRole('button', { name: 'New automation in gemstack' }))).toBe(true)
    // Its file is deleted in a terminal; any save on the page reads the rows again.
    status = { ...MINE, schedule: MINE.schedule.filter(c => c.command !== 'answer-comments') }
    fireEvent.click(within(row('tidy')).getByRole('switch', { name: 'Run tidy by itself' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: '/answer-comments' })).toBeNull())
    await waitFor(() => expect(disabled(screen.getByRole('button', { name: 'New automation in gemstack' }))).toBe(false))
    expect(disabled(screen.getByRole('button', { name: 'Edit tidy' }))).toBe(false)
    expect(screen.queryByRole('group', { name: /^Editing/ })).toBeNull()
  })

  test("an automation that answers `show` late, after a form or another row's panel was opened, opens nothing over it", async () => {
    const late: ((shown: ModuleCommandResult) => void)[] = []
    const { host, runCommand } = scheduler()
    runCommand.mockImplementation(async (_projectId: string, args: string[]) => (args[0] === 'status' ? { ok: true, output: MINE } : args[0] === 'show' ? new Promise<ModuleCommandResult>(resolve => late.push(resolve)) : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    fireEvent.click(within(row('/answer-comments')).getByRole('button', { name: 'Edit /answer-comments' }))
    // The row is held while its file is read.
    await waitFor(() => expect(row('/answer-comments').className).toMatch(/opacity-60/))
    fireEvent.click(screen.getByRole('button', { name: 'New automation in gemstack' }))
    fireEvent.change(within(screen.getByRole('group', { name: 'New automation' })).getByRole('textbox', { name: 'Name' }), { target: { value: 'typed-meanwhile' } })
    late[0]!({ ok: true, output: SHOWN })
    // The row is let go once the answer is in, and the form that was opened meanwhile still holds what was typed.
    await waitFor(() => expect(row('/answer-comments').className).not.toMatch(/opacity-60/))
    expect(screen.queryByRole('group', { name: 'Editing /answer-comments' })).toBeNull()
    expect((within(screen.getByRole('group', { name: 'New automation' })).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('typed-meanwhile')
    fireEvent.click(within(screen.getByRole('group', { name: 'New automation' })).getByRole('button', { name: 'Cancel' }))

    // The same when another row was opened meanwhile.
    fireEvent.click(within(row('tidy')).getByRole('button', { name: 'Edit tidy' }))
    await waitFor(() => expect(late.length).toBe(2))
    await edit('/work-queue')
    late[1]!({ ok: true, output: KEPT })
    await waitFor(() => expect(row('tidy').className).not.toMatch(/opacity-60/))
    expect(screen.queryByRole('group', { name: 'Editing tidy' })).toBeNull()
    expect(editing('/work-queue')).toBeTruthy()
  })

  test('"Remove" is in the panel and asks first, saying what is deleted; Cancel and Escape go back to the panel with what was typed, and remove nothing; Remove runs `remove`, the row goes, and the project says what is left for the person to do until they put it away', async () => {
    let status: unknown = MINE
    const { host, runCommand } = hostAnswering((projectId, args) => {
      if (args[0] === 'status') return { ok: true, output: projectId === 'p1' ? status : { ...STATUS, schedule: [] } }
      if (args[0] === 'show') return { ok: true, output: SHOWN }
      status = { ...MINE, schedule: MINE.schedule.filter(c => c.command !== args[1]) }
      return { ok: true, output: { ok: true, command: 'answer-comments', file: '.claude/skills/answer-comments/SKILL.md', git: 'committed', startsFrom: 'origin/main' } }
    })
    show(host, [GEMSTACK, OTHER])
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    const own = row('/answer-comments')
    // Nothing on the row itself deletes it.
    expect(within(own).queryByRole('button', { name: /Remove/ })).toBeNull()
    const panel = await edit('/answer-comments')
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Typed before asking.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove' }))
    const asked = within(own).getByRole('group', { name: 'Removing /answer-comments' })
    expect(screen.queryByRole('group', { name: 'Editing /answer-comments' })).toBeNull()
    expect(asked.textContent).toContain('Remove /answer-comments?')
    expect(asked.textContent).toContain('Its skill file is deleted from your files in this project, and nothing is committed for you. Git can bring back only what you committed of it: a file never committed, or your last changes to it, cannot be brought back. Everyone else who has the project keeps the row until your deletion reaches them. Its switch and your picks for it go with it. The records of its past runs stay.')
    // The keyboard lands on the way out, not on the deletion.
    expect(document.activeElement).toBe(within(asked).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Removing /answer-comments' })).toBeNull()
    expect((within(editing('/answer-comments')).getByLabelText('What the agent is told') as HTMLTextAreaElement).value).toBe('Typed before asking.')
    fireEvent.click(within(editing('/answer-comments')).getByRole('button', { name: 'Remove' }))
    fireEvent.keyDown(within(own).getByRole('group', { name: 'Removing /answer-comments' }), { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Removing /answer-comments' })).toBeNull()
    expect(editing('/answer-comments')).toBeTruthy()
    expect(saves(runCommand)).toEqual([])

    fireEvent.click(within(editing('/answer-comments')).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(within(own).getByRole('group', { name: 'Removing /answer-comments' })).getByRole('button', { name: 'Remove' }))
    const note = await within(gemstack).findByRole('status', { name: 'Removed' })
    expect(saves(runCommand)).toEqual([['remove', 'answer-comments']])
    expect(screen.getAllByRole('status', { name: 'Removed' }).length, 'said in the project it was removed from, and in no other').toBe(1)
    expect(note.textContent).toContain('Removed /answer-comments: .claude/skills/answer-comments/SKILL.md is deleted, and nothing was committed for you. Commit the deletion and bring it to origin/main: until then everyone else who has the project keeps the row.')
    await waitFor(() => expect(screen.queryByRole('listitem', { name: '/answer-comments' })).toBeNull())
    expect(row('tidy')).toBeTruthy()
    // What was typed went with the row: nothing is held any more.
    await waitFor(() => expect(disabled(screen.getByRole('button', { name: 'Edit tidy' }))).toBe(false))
    fireEvent.click(within(note).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('status', { name: 'Removed' })).toBeNull()
  })

  test('removing an automation kept on this machine says first that it cannot be brought back; a removal that is refused says why in the question, and the row stays', async () => {
    const answers: ModuleCommandResult[] = [
      { ok: false, error: '.agent-scheduler/automations/tidy.md was changed by hand since it was saved: edit or remove the file itself' },
      { ok: true, output: { ok: true, command: 'tidy', file: '.agent-scheduler/automations/tidy.md', onThisMachine: true } },
    ]
    const { host, runCommand } = mine(() => answers.shift()!)
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const kept = row('tidy')
    fireEvent.click(within(await edit('tidy')).getByRole('button', { name: 'Remove' }))
    const asked = within(kept).getByRole('group', { name: 'Removing tidy' })
    expect(asked.textContent).toContain('Remove tidy?')
    expect(asked.textContent).toContain('Its file is deleted. It is kept on this machine alone, outside git, so it cannot be brought back.')
    fireEvent.click(within(asked).getByRole('button', { name: 'Remove' }))
    expect((await within(asked).findByRole('alert')).textContent).toBe('It was not removed: .agent-scheduler/automations/tidy.md was changed by hand since it was saved: edit or remove the file itself')
    expect(runCommand).toHaveBeenCalledWith('p1', ['remove', 'tidy'])
    expect(row('tidy')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Removed' })).toBeNull()
    // Why it was not removed is said in the question alone: back in the panel the line is gone, and so it is when the question is asked again.
    fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }))
    expect(within(within(kept).getByRole('group', { name: 'Editing tidy' })).queryByRole('alert')).toBeNull()
    fireEvent.click(within(within(kept).getByRole('group', { name: 'Editing tidy' })).getByRole('button', { name: 'Remove' }))
    expect(within(within(kept).getByRole('group', { name: 'Removing tidy' })).queryByRole('alert')).toBeNull()
    // Removed, while a tick that was under way still lists it for a moment: the question is closed, so the row does not come back asking.
    fireEvent.click(within(within(kept).getByRole('group', { name: 'Removing tidy' })).getByRole('button', { name: 'Remove' }))
    expect((await screen.findByRole('status', { name: 'Removed' })).textContent).toContain('Removed tidy: .agent-scheduler/automations/tidy.md is deleted. Nothing is to commit.')
    expect(screen.queryByRole('group', { name: 'Removing tidy' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Editing tidy' })).toBeNull()
    expect(within(row('tidy')).queryByRole('alert')).toBeNull()
  })

  test("a prompt made longer by hand than the panel can send does not hold the row's picks: they are saved without the words; changing the words says where they are changed", async () => {
    const long = 'p'.repeat(4001)
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: MINE } : args[0] === 'show' ? { ok: true, output: { ...KEPT, prompt: long } } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('tidy')
    expect(within(panel).getByText('Every 1 day. Claude Code, Opus 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    await pick(publish(panel), 'As the prompt says')
    fireEvent.change(within(panel).getByLabelText('Time of day'), { target: { value: '10:00' } })
    expect(disabled(within(panel).getByRole('button', { name: 'Save' }))).toBe(false)
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('tidy')
    expect(saves(runCommand)).toEqual([['pace', 'tidy', '1d', '10:00'], ['publish', 'tidy', 'nothing']])
    // The words themselves are too long to send from here.
    const again = await edit('tidy')
    fireEvent.change(within(again).getByLabelText('What the agent is told'), { target: { value: `${long}!` } })
    expect(within(again).getByText('What the agent is told is 4002 characters, and this form takes 4000 at most. Change it in its file, .agent-scheduler/automations/tidy.md.')).toBeTruthy()
    expect(disabled(within(again).getByRole('button', { name: 'Save' }))).toBe(true)
  })

  test('a save that stops midway says that the file was written already, and the save that goes through later still says what is left to commit', async () => {
    const answers: ModuleCommandResult[] = [
      { ok: true, output: { ok: true, command: 'answer-comments', file: SHOWN.file, startsFrom: 'origin/main' } },
      { ok: false, error: 'the state could not be written' },
      { ok: true, output: { ok: true } },
    ]
    const { host, runCommand } = mine(() => answers.shift()!)
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('/answer-comments')
    fireEvent.change(within(panel).getByLabelText('How long'), { target: { value: '2' } })
    await pick(within(panel).getByLabelText('Unit'), 'days')
    fireEvent.change(within(panel).getByLabelText('Not before this time of day'), { target: { value: '10:00' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    expect((await within(panel).findByRole('alert')).textContent).toBe('The pace was not saved: the state could not be written. Its words and its pace are saved, in .claude/skills/answer-comments/SKILL.md: a change of yours to commit.')
    // Pressed again, only what is still to save is sent: the file is not written twice.
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    const said = await savedAgain('/answer-comments')
    expect(said).toContain('It is a change to a file of yours, in this project, and nothing was committed for you.')
    expect(saves(runCommand).map(args => args[0])).toEqual(['edit', 'pace', 'pace'])
    expect(saves(runCommand)[2]).toEqual(['pace', 'answer-comments', '2d', '10:00'])
  })

  test('a pick of "No wait" left on this machine for a row whose file has only a shell line goes once the person picks a pace: it would stand in for the pace in the file', async () => {
    const watch = { command: 'watch', when: 'gh api threads', description: 'Look for new threads.', onThisMachine: true, editable: true }
    const status = { ...STATUS, paces: { watch: { work: true } }, schedule: [...STATUS.schedule, watch] }
    const shown = { ok: true, name: 'watch', prompt: 'Look for new threads.', when: 'gh api threads', file: '.agent-scheduler/automations/watch.md', onThisMachine: true }
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: status } : args[0] === 'show' ? { ok: true, output: shown } : { ok: true, output: { ok: true, command: 'watch', file: shown.file, startsFrom: 'HEAD', onThisMachine: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('watch')
    expect(checked(radio(panel, 'No wait'))).toBe(true)
    fireEvent.click(radio(panel, 'A wait you set'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('watch')
    expect(saves(runCommand)).toEqual([
      ['edit', 'watch', '--prompt=Look for new threads.', '--every=1d', '--when=gh api threads', '--waits-for='],
      ['pace', 'watch', 'skill'],
    ])
  })
})

describe('what a row runs on', () => {
  /** Rows for every case: Claude Code alone, a skill that names its own model, a skill in both folders that names Codex, and one kept on this machine. */
  const RUNS = {
    ...STATUS,
    schedule: [
      { command: 'post-merge-cleanup', every: '1d', ...ON_CLAUDE },
      { command: 'update-tickets', every: '15m', model: 'haiku', modelAgent: 'claude-code', ...ON_CLAUDE },
      { command: 'say-pear', every: '1d', agent: 'codex', able: ['claude-code', 'codex'] },
      { command: 'tidy', every: '1d', onThisMachine: true, editable: true, ...ANY_AGENT },
    ],
  }
  const runs = (over: object = {}, saved: () => ModuleCommandResult = () => ({ ok: true, output: { ok: true } })) =>
    hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: { ...RUNS, ...over } } : args[0] === 'show' ? { ok: true, output: KEPT } : saved()))
  const menu = (panel: HTMLElement, name: 'Agent' | 'Model'): HTMLElement => within(part(panel, 'What it runs on')).getByLabelText(name)

  test("a row's line says the agent and the model its runs are on: the scheduler's model on Claude Code, the skill's own where it names one, the agent alone on Codex; a pick of the person's says so on a skill's row", async () => {
    const { host } = runs({ models: { 'post-merge-cleanup': { agent: 'claude-code', model: 'haiku' } }, runsOn: { 'say-pear': 'claude-code' } })
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    // Named as the agent lists them, once its list is in.
    expect(await within(row('/update-tickets')).findByText('Claude Code, Haiku 5.5')).toBeTruthy()
    expect(within(row('/update-tickets')).queryByText('your pick')).toBeNull()
    expect(within(row('/post-merge-cleanup')).getByText('Claude Code, Haiku 5.5')).toBeTruthy()
    expect(within(row('/post-merge-cleanup')).getByText('your pick')).toBeTruthy()
    // Picked away from the agent its skill is made for: the scheduler's model, not one the skill named for the other agent.
    expect(within(row('/say-pear')).getByText('Claude Code, Opus 5.5')).toBeTruthy()
    expect(within(row('tidy')).getByText('Claude Code, Opus 5.5')).toBeTruthy()
    cleanup()
    // A model picked while the row ran on another agent is none: the row says what it starts on now.
    const moved = runs({ models: { 'post-merge-cleanup': { agent: 'codex', model: 'gpt-5.5' } }, lastTick: { ...STATUS.lastTick, decisions: [{ command: 'post-merge-cleanup', outcome: 'not a command of Codex: its skill is only under .claude/skills, not .agents/skills' }] } })
    show(moved.host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(await within(row('/post-merge-cleanup')).findByText('Claude Code, Opus 5.5')).toBeTruthy()
    expect(within(row('/post-merge-cleanup')).queryByText('your pick')).toBeNull()
    // What the last look said of an agent the row is no longer on is not said: the files say Claude Code can run it.
    expect(within(row('/post-merge-cleanup')).queryByText(/Cannot start/)).toBeNull()
    cleanup()
    const plain = runs()
    show(plain.host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(within(row('/say-pear')).getByText('Codex')).toBeTruthy()
    expect(within(row('/say-pear')).queryByText('your pick')).toBeNull()
  })

  test('the panel offers the agent and the model: an agent that cannot read the row\'s skill is greyed with why; the first model is what follows when nobody picks; Save runs `model` alone for a model, and takes a pick back with `skill`', async () => {
    let picks: object = {}
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: { ...RUNS, ...picks } } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('/update-tickets')
    expect(showing(menu(panel, 'Agent'))).toBe('Claude Code')
    expect(await offered(menu(panel, 'Agent'))).toEqual([['Claude Code', false], ['Codex', true]])
    expect(within(panel).getByText(/Codex cannot run this row: it reads the project's skills from/).textContent).toBe("Codex cannot run this row: it reads the project's skills from .agents/skills, and this row's skill is not there.")
    await waitFor(async () => expect(await choices(menu(panel, 'Model'))).toEqual(['As the skill says (Haiku 5.5)', 'Opus 5.5', 'Haiku 5.5']))
    expect(showing(menu(panel, 'Model'))).toBe('As the skill says (Haiku 5.5)')
    expect(within(panel).getByText('Every 15 minutes. Claude Code, Haiku 5.5. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    await pick(menu(panel, 'Model'), 'Opus 5.5')
    expect(within(panel).getByText('Every 15 minutes. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    picks = { models: { 'update-tickets': { agent: 'claude-code', model: 'opus' } } }
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('/update-tickets')
    expect(saves(runCommand)).toEqual([['model', 'update-tickets', 'opus']])
    expect(within(row('/update-tickets')).getByText('Claude Code, Opus 5.5')).toBeTruthy()
    // Opened on the pick; the first choice takes it back.
    const again = await edit('/update-tickets')
    expect(showing(menu(again, 'Model'))).toBe('Opus 5.5')
    await pick(menu(again, 'Model'), 'As the skill says (Haiku 5.5)')
    picks = {}
    fireEvent.click(within(again).getByRole('button', { name: 'Save' }))
    await gone('/update-tickets')
    expect(saves(runCommand).slice(1)).toEqual([['model', 'update-tickets', 'skill']])
    // A row with no model of its skill's follows the scheduler's.
    const other = await edit('/post-merge-cleanup')
    await waitFor(async () => expect((await choices(menu(other, 'Model')))[0]).toBe("The scheduler's model (Opus 5.5)"))
  })

  test('picking another agent starts its model from what follows there, says what cannot be read of it, and Save runs `agent`, then `model` only when one was picked; the agent its skill is made for is picked back with `skill`', async () => {
    let picks: object = {}
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: { ...RUNS, ...picks } } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('/say-pear')
    // Made for Codex, and in both folders: either agent can run it.
    expect(showing(menu(panel, 'Agent'))).toBe('Codex')
    expect(await offered(menu(panel, 'Agent'))).toEqual([['Claude Code', false], ['Codex', false]])
    await waitFor(async () => expect(await choices(menu(panel, 'Model'))).toEqual(["Codex's own default", 'GPT-5.5']))
    expect(showing(menu(panel, 'Model'))).toBe("Codex's own default")
    expect(within(panel).getByText("How much of Codex's quota is left cannot be read, so its runs start without that check, and their cost is not recorded.")).toBeTruthy()
    expect(within(panel).getByText('Every 1 day. Codex. May commit, pushes nothing. Nothing is changed yet.')).toBeTruthy()
    await pick(menu(panel, 'Model'), 'GPT-5.5')
    expect(showing(menu(panel, 'Model'))).toBe('GPT-5.5')
    await pick(menu(panel, 'Agent'), 'Claude Code')
    // The model picked was Codex's: Claude Code starts from its own first choice, and its quota can be read.
    expect(showing(menu(panel, 'Model'))).toBe("The scheduler's model (Opus 5.5)")
    expect(await choices(menu(panel, 'Model'))).toEqual(["The scheduler's model (Opus 5.5)", 'Opus 5.5', 'Haiku 5.5'])
    expect(within(panel).queryByText(/quota is left cannot be read/)).toBeNull()
    expect(within(panel).getByText('Every 1 day. Claude Code, Opus 5.5. May commit, pushes nothing.')).toBeTruthy()
    picks = { runsOn: { 'say-pear': 'claude-code' } }
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('/say-pear')
    expect(saves(runCommand)).toEqual([['agent', 'say-pear', 'claude-code']])
    // With a model picked for the new agent: the agent first, which takes back any model picked before, then the model.
    const again = await edit('/say-pear')
    expect(showing(menu(again, 'Agent'))).toBe('Claude Code')
    await pick(menu(again, 'Agent'), 'Codex')
    await pick(menu(again, 'Model'), 'GPT-5.5')
    picks = { models: { 'say-pear': { agent: 'codex', model: 'gpt-5.5' } } }
    fireEvent.click(within(again).getByRole('button', { name: 'Save' }))
    await gone('/say-pear')
    expect(saves(runCommand).slice(1)).toEqual([['agent', 'say-pear', 'skill'], ['model', 'say-pear', 'gpt-5.5']])
    expect(within(row('/say-pear')).getByText('Codex, GPT-5.5')).toBeTruthy()
  })

  test('the agent and the model are saved after the number of agents and before the publish pick; one that is not taken stops there and says why; a model the agent does not list stays the pick', async () => {
    const answers: ModuleCommandResult[] = [{ ok: true, output: { ok: true } }, { ok: false, error: 'Codex reads a project\'s skills from .agents/skills, and the skill of tidy is only under .claude/skills' }]
    const { host, runCommand } = runs({ models: { tidy: { agent: 'claude-code', model: 'claude-opus-9' } } }, () => answers.shift() ?? { ok: true, output: { ok: true } })
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('tidy')
    // Kept on this machine, it is no skill: either agent can run it. Its model was picked by an id the agent does not list.
    expect(await offered(menu(panel, 'Agent'))).toEqual([['Claude Code', false], ['Codex', false]])
    expect(showing(menu(panel, 'Model'))).toBe('claude-opus-9')
    await waitFor(async () => expect(await choices(menu(panel, 'Model'))).toEqual(["The scheduler's model (Opus 5.5)", 'Opus 5.5', 'Haiku 5.5', 'claude-opus-9']))
    fireEvent.change(within(panel).getByLabelText('How many agents'), { target: { value: '2' } })
    await pick(menu(panel, 'Agent'), 'Codex')
    await pick(publish(panel), 'As the prompt says')
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    expect((await within(panel).findByRole('alert')).textContent).toBe("The agent was not saved: Codex reads a project's skills from .agents/skills, and the skill of tidy is only under .claude/skills")
    expect(saves(runCommand)).toEqual([['agents', 'tidy', '2'], ['agent', 'tidy', 'codex']])
    // Everything picked is still there.
    expect(showing(menu(panel, 'Agent'))).toBe('Codex')
    expect(showing(publish(panel))).toBe('As the prompt says')
  })
})

describe('one panel or form at a time', () => {
  test('with nothing changed in it, a panel gives way to another row\'s Edit or to "New automation", and a form gives way to a row\'s Edit; while it holds a change not saved, every other Edit and every "New automation" is held, and Escape does not close it', async () => {
    const { host, runCommand } = scheduler()
    show(host, [GEMSTACK, OTHER])
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    const open = (): (string | null)[] => screen.queryAllByRole('group', { name: /^(Editing|New automation)/ }).map(g => g.getAttribute('aria-label'))
    const opens = (): HTMLElement[] => [...screen.getAllByRole('button', { name: /^Edit / }), ...screen.getAllByRole('button', { name: /^New automation in/ })]

    // Nothing changed: its own Edit waits, every other way in stays open.
    fireEvent.click(within(gemstack).getByRole('button', { name: 'Edit /work-queue' }))
    expect(open()).toEqual(['Editing /work-queue'])
    expect(disabled(within(gemstack).getByRole('button', { name: 'Edit /work-queue' }))).toBe(true)
    expect(opens().filter(disabled).length).toBe(1)
    fireEvent.click(within(gemstack).getByRole('button', { name: 'Edit /post-merge-cleanup' }))
    expect(open()).toEqual(['Editing /post-merge-cleanup'])
    fireEvent.click(screen.getByRole('button', { name: 'New automation in gemstack' }))
    expect(open()).toEqual(['New automation'])
    // The form's own button is away while it is open; the other project's is offered.
    expect(screen.queryByRole('button', { name: 'New automation in gemstack' })).toBeNull()
    expect(opens().filter(disabled).length).toBe(0)
    fireEvent.click(within(gemstack).getByRole('button', { name: 'Edit /work-queue' }))
    expect(open()).toEqual(['Editing /work-queue'])

    // A pick not saved: nothing else opens over it.
    await pick(publish(editing('/work-queue')), 'Merge on green')
    expect(opens().filter(b => !disabled(b))).toEqual([])
    fireEvent.keyDown(editing('/work-queue'), { key: 'Escape' })
    expect(open()).toEqual(['Editing /work-queue'])
    // A row's other controls are not a way in: they still answer.
    fireEvent.click(within(gemstack).getByRole('switch', { name: 'Run /post-merge-cleanup by itself' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p1', ['switch', 'post-merge-cleanup', 'off']))
    await waitFor(() => expect(within(gemstack).getByRole('listitem', { name: '/post-merge-cleanup' }).className).not.toMatch(/opacity-60/))
    expect(open()).toEqual(['Editing /work-queue'])
    expect(showing(publish(editing('/work-queue')))).toBe('Merge on green')
    // Picked back to what it was: nothing is held any more.
    await pick(publish(editing('/work-queue')), 'As the skill says')
    expect(opens().filter(disabled).length).toBe(1)
    await pick(publish(editing('/work-queue')), 'Merge on green')
    fireEvent.click(within(editing('/work-queue')).getByRole('button', { name: 'Cancel' }))
    expect(open()).toEqual([])
    expect(opens().filter(disabled).length).toBe(0)

    // The same for the form: typed into, it holds every way in; Cancel lets go.
    fireEvent.click(screen.getByRole('button', { name: 'New automation in gemstack' }))
    const form = screen.getByRole('group', { name: 'New automation' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'typed' } })
    expect(opens().filter(b => !disabled(b))).toEqual([])
    fireEvent.keyDown(form, { key: 'Escape' })
    expect(open()).toEqual(['New automation'])
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(open()).toEqual([])
    expect(opens().filter(disabled).length).toBe(0)
    expect(saves(runCommand)).toEqual([['switch', 'post-merge-cleanup', 'off']])
  })

  test('an automation that answers `show` after a change was made in the panel that is open does not take its place: the change is kept', async () => {
    let answer: (result: ModuleCommandResult) => void = () => {}
    const { host } = hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: MINE } : { ok: true, output: { ok: true } }))
    const plain = host.runCommand
    host.runCommand = ((projectId: string, args: string[]) => (args[0] === 'show' ? new Promise<ModuleCommandResult>(resolve => (answer = resolve)) : plain(projectId, args))) as typeof host.runCommand
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('/work-queue')
    // Nothing is changed yet, so another row may be opened: its automation is being read.
    fireEvent.click(within(row('tidy')).getByRole('button', { name: 'Edit tidy' }))
    await pick(publish(panel), 'Publish branch')
    answer({ ok: true, output: KEPT })
    await waitFor(() => expect(disabled(within(row('tidy')).getByRole('button', { name: 'Edit tidy' }))).toBe(true))
    expect(screen.queryByRole('group', { name: 'Editing tidy' })).toBeNull()
    expect(showing(publish(editing('/work-queue')))).toBe('Publish branch')
  })

  test('a "Run now" that is still starting holds no other save: a switch flipped meanwhile is saved at once', async () => {
    let started: (result: ModuleCommandResult) => void = () => {}
    const { host, runCommand } = scheduler()
    const plain = host.runCommand
    host.runCommand = ((projectId: string, args: string[]) => (args[0] === 'now' ? (runCommand(projectId, args), new Promise<ModuleCommandResult>(resolve => (started = resolve))) : plain(projectId, args))) as typeof host.runCommand
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    fireEvent.click(within(row('/work-queue')).getByRole('button', { name: 'Run /work-queue now' }))
    fireEvent.click(within(row('/post-merge-cleanup')).getByRole('switch'))
    await waitFor(() => expect(saves(runCommand)).toContainEqual(['switch', 'post-merge-cleanup', 'off']))
    // The row being started is held until its answer is in.
    expect(disabled(within(row('/work-queue')).getByRole('button', { name: 'Run /work-queue now' }))).toBe(true)
    started({ ok: true, output: { ok: true, run: 'r1' } })
    await within(row('/work-queue')).findByText('Started a run.')
  })
})

describe('the "New automation" form', () => {
  test('"New automation" opens a form in its project, with its four parts: a name, what it does, when it runs, who gets it; the line under them says what is missing, then when the row would run; Cancel and Escape close it and save nothing', async () => {
    const { host, runCommand } = scheduler()
    show(host, [GEMSTACK, OTHER])
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    expect(screen.queryByRole('group', { name: 'New automation' })).toBeNull()
    fireEvent.click(within(gemstack).getByRole('button', { name: 'New automation in gemstack' }))
    const form = within(gemstack).getByRole('group', { name: 'New automation' })
    // One form, in the project whose button was pressed.
    expect(screen.getAllByRole('group', { name: 'New automation' }).length).toBe(1)
    expect(within(form).getAllByRole('region').map(r => r.getAttribute('aria-label'))).toEqual(['Name', 'What it does', 'When it runs', 'Who gets it'])
    // The keyboard lands on the name.
    expect(document.activeElement).toBe(within(form).getByRole('textbox', { name: 'Name' }))
    expect(waitsFor(form)).toBe('By time alone. It starts again once the wait is over.')
    expect(within(form).getByText('Give it a name. It becomes the command, like /answer-comments.')).toBeTruthy()
    expect(disabled(within(form).getByRole('button', { name: 'Save' }))).toBe(true)
    expect(disabled(within(form).getByRole('button', { name: 'Try it' }))).toBe(true)
    // The plain words for a shell line show before there is a line, to write it from; only a line can pace it alone.
    expect(within(form).getByLabelText(/What the line waits for/)).toBeTruthy()
    expect(disabled(within(form).getByRole('button', { name: 'Write the line' }))).toBe(true)
    expect(queryRadio(form, 'No wait')).toBeNull()
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'answer-comments' } })
    expect(within(form).getByText('Write what the agent is told.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('What the agent is told'), { target: { value: 'Answer each new comment below.' } })
    expect(within(form).getByText('Every 1 day.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText('How long'), { target: { value: '15' } })
    await pick(within(form).getByLabelText('Unit'), 'minutes')
    fireEvent.change(within(form).getByLabelText(/A shell line that prints what is new/), { target: { value: 'gh api comments' } })
    // With a shell line the row starts only when the line finds work: said by the line itself until its plain words are typed.
    expect(waitsFor(form)).toBe('Only when there is work: when its shell line prints something. The scheduler looks every minute.')
    fireEvent.change(within(form).getByLabelText(/What the line waits for/), { target: { value: 'when someone commented' } })
    expect(within(form).getByText('Every 15 minutes at most, when someone commented.')).toBeTruthy()
    expect(waitsFor(form)).toBe('Only when there is work: when someone commented. The scheduler looks every minute.')
    // The shell line alone: the count and the unit are set aside, not held, since typing in one picks the wait back.
    const when = part(form, 'When it runs')
    expect(within(when).getByRole('radiogroup', { name: 'How long the new automation waits after a start' })).toBeTruthy()
    expect(radioNames(when).map(name => [name, checked(radio(when, name))])).toEqual([['A wait you set', true], ['No wait', false]])
    expect(within(form).getByLabelText('How long').parentElement?.className).not.toMatch(/opacity-60/)
    fireEvent.click(radio(when, 'No wait'))
    expect(radioNames(when).map(name => [name, checked(radio(when, name))])).toEqual([['A wait you set', false], ['No wait', true]])
    expect(within(form).getByLabelText('How long').parentElement?.className).toMatch(/opacity-60/)
    expect(disabled(within(form).getByLabelText('How long'))).toBe(false)
    expect(disabled(within(form).getByLabelText('Unit'))).toBe(false)
    expect(within(form).getByText('When someone commented.')).toBeTruthy()
    expect(disabled(within(form).getByRole('button', { name: 'Save' }))).toBe(false)
    // Escape does not close a form that holds text: a slip of a key loses no prompt. Cancel does.
    fireEvent.keyDown(form, { key: 'Escape' })
    expect(screen.getByRole('group', { name: 'New automation' })).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'New automation' })).toBeNull()
    // Opened again it is empty, and Escape closes an empty one.
    fireEvent.click(within(gemstack).getByRole('button', { name: 'New automation in gemstack' }))
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('')
    fireEvent.keyDown(screen.getByRole('group', { name: 'New automation' }), { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'New automation' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New automation in other' })).toBeTruthy()
    expect(runCommand.mock.calls.every(([, args]) => args[0] === 'status')).toBe(true)
  })

  test('"Try it" runs the shell line once in the project and shows what it printed and whether an agent would start; the answer goes away when the line changes', async () => {
    const tries: ModuleCommandResult[] = [
      { ok: true, output: { ok: true, lastRun: '2026-10-08T10:00:00Z', ran: true, due: true, printed: '[{"url":"https://example.test/1"}]' } },
      { ok: true, output: { ok: true, lastRun: '2026-10-08T10:00:00Z', ran: false, due: false, printed: '', error: 'gh: command not found' } },
      { ok: false, error: 'the project is gone' },
    ]
    const { host, runCommand } = scheduler((_, args) => (args[0] === 'try' ? tries.shift()! : { ok: true, output: { ok: true } }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'New automation in gemstack' }))
    const form = screen.getByRole('group', { name: 'New automation' })
    const line = within(form).getByLabelText(/A shell line that prints what is new/)
    fireEvent.change(line, { target: { value: '  gh api comments  ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Try it' }))
    const answer = await within(form).findByRole('status', { name: 'What the line answered' })
    expect(runCommand).toHaveBeenCalledWith('p1', ['try', '--when=gh api comments'])
    expect(within(answer).getByText('It printed something: an agent would start now.').className).toMatch(/text-success/)
    expect(answer.querySelector('pre')?.textContent).toBe('[{"url":"https://example.test/1"}]')
    expect(within(answer).getByText('Tried as if the row had last started a day ago: $LAST_RUN was 2026-10-08T10:00:00Z.')).toBeTruthy()
    // The answer was for that line: another line has none until it is tried.
    fireEvent.change(line, { target: { value: 'gh api other' } })
    expect(within(form).queryByRole('status', { name: 'What the line answered' })).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: 'Try it' }))
    expect((await within(form).findByText('The line failed: gh: command not found')).className).toMatch(/text-danger/)
    fireEvent.change(line, { target: { value: 'gh api third' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Try it' }))
    expect(await within(form).findByText('The line could not be tried: the project is gone')).toBeTruthy()
    // Trying saves nothing.
    expect(runCommand.mock.calls.some(([, args]) => args[0] === 'add')).toBe(false)
  })

  test('"Write the line" asks the coding agent for a shell line from the plain words and puts it in the line\'s box, saving nothing; a NONE or a failure says why and leaves the box', async () => {
    const writes: ModuleCommandResult[] = [
      { ok: true, output: { ok: true, line: 'gh api "repos/{owner}/{repo}/issues/comments?since=$LAST_RUN" --jq \'[.[].html_url]\'' } },
      { ok: true, output: { ok: true, none: 'nothing on the command line says that.' } },
      { ok: false, error: 'the line was not written: the agent took longer than 25 seconds' },
    ]
    const { host, runCommand } = scheduler((_, args) => (args[0] === 'write-line' ? writes.shift()! : { ok: true, output: { ok: true } }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'New automation in gemstack' }))
    const form = screen.getByRole('group', { name: 'New automation' })
    const words = within(form).getByLabelText(/What the line waits for/)
    const line = within(form).getByLabelText(/A shell line that prints what is new/) as HTMLTextAreaElement
    expect(within(form).getByText(/Asks Claude Code once for a shell line from these words/)).toBeTruthy()
    fireEvent.change(words, { target: { value: '  when someone comments on an issue ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Write the line' }))
    await waitFor(() => expect(line.value).toBe('gh api "repos/{owner}/{repo}/issues/comments?since=$LAST_RUN" --jq \'[.[].html_url]\''))
    expect(runCommand).toHaveBeenCalledWith('p1', ['write-line', '--words=when someone comments on an issue', '--agent=claude-code'])
    // The line is the person's to read and try: nothing was saved, and "Try it" takes it.
    expect(disabled(within(form).getByRole('button', { name: 'Try it' }))).toBe(false)
    fireEvent.click(within(form).getByRole('button', { name: 'Write the line' }))
    expect(await within(form).findByText('No line can do that: nothing on the command line says that.')).toBeTruthy()
    expect(line.value).toMatch(/^gh api/)
    fireEvent.change(words, { target: { value: 'when it rains' } })
    expect(within(form).queryByRole('status', { name: 'What the agent answered' })).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: 'Write the line' }))
    expect(await within(form).findByText('The line was not written: the line was not written: the agent took longer than 25 seconds')).toBeTruthy()
    expect(line.value).toMatch(/^gh api/)
    expect(runCommand.mock.calls.some(([, args]) => args[0] === 'add')).toBe(false)
  })

  test('a written line that comes back after the person typed in the line\'s box is dropped', async () => {
    const { host, runCommand } = scheduler()
    let answer!: (result: ModuleCommandResult) => void
    runCommand.mockImplementation(async (_projectId: string, args: string[]) => (args[0] === 'write-line' ? new Promise<ModuleCommandResult>(resolve => (answer = resolve)) : { ok: true, output: args[0] === 'status' ? STATUS : { ok: true } }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'New automation in gemstack' }))
    const form = screen.getByRole('group', { name: 'New automation' })
    const line = within(form).getByLabelText(/A shell line that prints what is new/) as HTMLTextAreaElement
    fireEvent.change(within(form).getByLabelText(/What the line waits for/), { target: { value: 'when someone comments' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Write the line' }))
    expect(disabled(within(form).getByRole('button', { name: 'Writing…' }))).toBe(true)
    fireEvent.change(line, { target: { value: 'my own line' } })
    answer({ ok: true, output: { ok: true, line: 'gh api late' } })
    await waitFor(() => expect(runCommand.mock.results.some(r => r.type === 'return')).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(line.value).toBe('my own line')
  })

  test('an answer that comes back after the line was changed is not shown under the other line', async () => {
    const { host, runCommand } = scheduler()
    let answer!: (result: ModuleCommandResult) => void
    runCommand.mockImplementation(async (_projectId: string, args: string[]) => (args[0] === 'try' ? new Promise<ModuleCommandResult>(resolve => (answer = resolve)) : { ok: true, output: args[0] === 'status' ? STATUS : { ok: true } }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'New automation in gemstack' }))
    const form = screen.getByRole('group', { name: 'New automation' })
    const line = within(form).getByLabelText(/A shell line that prints what is new/)
    fireEvent.change(line, { target: { value: 'a slow line' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Try it' }))
    expect(disabled(within(form).getByRole('button', { name: 'Trying…' }))).toBe(true)
    fireEvent.change(line, { target: { value: 'another line' } })
    answer({ ok: true, output: { ok: true, lastRun: '2026-10-08T10:00:00Z', ran: true, due: true, printed: '[1]' } })
    await waitFor(() => expect(runCommand.mock.results.some(r => r.type === 'return')).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(within(form).queryByRole('status', { name: 'What the line answered' })).toBeNull()
    expect(within(form).queryByText('It printed something: an agent would start now.')).toBeNull()
  })

  test("a second try asked while the first is still running: the first one's late answer changes nothing, and the button stays held until the second answers", async () => {
    const answers: ((result: ModuleCommandResult) => void)[] = []
    const { host, runCommand } = scheduler()
    runCommand.mockImplementation(async (_projectId: string, args: string[]) => (args[0] === 'try' ? new Promise<ModuleCommandResult>(resolve => answers.push(resolve)) : { ok: true, output: args[0] === 'status' ? STATUS : { ok: true } }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'New automation in gemstack' }))
    const form = screen.getByRole('group', { name: 'New automation' })
    const line = within(form).getByLabelText(/A shell line that prints what is new/)
    fireEvent.change(line, { target: { value: 'first line' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Try it' }))
    fireEvent.change(line, { target: { value: 'second line' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Try it' }))
    await waitFor(() => expect(answers.length).toBe(2))
    answers[0]!({ ok: true, output: { ok: true, lastRun: '2026-10-08T10:00:00Z', ran: true, due: true, printed: '["first"]' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(disabled(within(form).getByRole('button', { name: 'Trying…' }))).toBe(true)
    expect(within(form).queryByRole('status', { name: 'What the line answered' })).toBeNull()
    answers[1]!({ ok: true, output: { ok: true, lastRun: '2026-10-08T10:00:00Z', ran: true, due: false, printed: '[]' } })
    expect(await within(form).findByText('It printed nothing to do: no agent would start.')).toBeTruthy()
  })

  test("Save runs `add` in the project and then says where the file is, that it is the person's to commit, and where it has to get to before its row can start; a save that is refused says why and keeps what was typed", async () => {
    const added: ModuleCommandResult[] = [
      { ok: false, error: 'that name is taken: .claude/skills/answer-comments' },
      { ok: true, output: { ok: true, command: 'answer-replies', file: '.claude/skills/answer-replies/SKILL.md', startsFrom: 'origin/main' } },
    ]
    const { host, runCommand } = scheduler((_, args) => (args[0] === 'add' ? added.shift()! : { ok: true, output: { ok: true } }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'New automation in gemstack' }))
    const form = screen.getByRole('group', { name: 'New automation' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'answer-comments' } })
    fireEvent.change(within(form).getByLabelText('What the agent is told'), { target: { value: '- Answer each new comment below.' } })
    fireEvent.change(within(form).getByLabelText(/A shell line that prints what is new/), { target: { value: 'gh api comments' } })
    fireEvent.click(radio(form, 'No wait'))
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('Not saved: that name is taken: .claude/skills/answer-comments')
    // A text that opens with a dash is still its flag's own text; no pace was picked, so none is sent.
    expect(runCommand).toHaveBeenCalledWith('p1', ['add', 'answer-comments', '--prompt=- Answer each new comment below.', '--when=gh api comments'])
    expect((within(form).getByLabelText('What the agent is told') as HTMLTextAreaElement).value).toBe('- Answer each new comment below.')
    // Typing again takes the refusal away.
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'answer-replies' } })
    expect(within(form).queryByRole('alert')).toBeNull()
    const statusReads = runCommand.mock.calls.filter(([, args]) => args[0] === 'status').length
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    const saved = await screen.findByText(/It is a file of yours, in this project, and nothing was committed for you\./)
    const panel = screen.getByRole('group', { name: 'New automation' })
    expect(panel.textContent).toContain('Saved /answer-replies as .claude/skills/answer-replies/SKILL.md.')
    expect(saved.textContent).toContain('Its row cannot start before the file is on origin/main: commit it and bring it there.')
    expect(panel.textContent).toContain('Its row is in the list now, switched off.')
    expect(within(panel).queryByRole('alert')).toBeNull()
    // The rows are read again at once.
    await waitFor(() => expect(runCommand.mock.calls.filter(([, args]) => args[0] === 'status').length).toBeGreaterThan(statusReads))
    // Saved: nothing is held any more, though the note is still up.
    await waitFor(() => expect(disabled(screen.getByRole('button', { name: 'Edit /work-queue' }))).toBe(false))
    fireEvent.click(within(panel).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('group', { name: 'New automation' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New automation in gemstack' })).toBeTruthy()
  })

  test('while a save runs the form takes no more typing and no second Save, and Escape does not close it; in a project whose scheduler is not running the saved panel says the same as in any other: the row is in the list', async () => {
    let answer!: (result: ModuleCommandResult) => void
    const { host, runCommand } = scheduler()
    runCommand.mockImplementation(async (_projectId: string, args: string[]) => (args[0] === 'add' ? new Promise<ModuleCommandResult>(resolve => (answer = resolve)) : { ok: true, output: args[0] === 'status' ? { ...STATUS, running: false } : { ok: true } }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'New automation in gemstack' }))
    const form = screen.getByRole('group', { name: 'New automation' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'daily-notes' } })
    fireEvent.change(within(form).getByLabelText('What the agent is told'), { target: { value: 'Write the notes.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(disabled(within(form).getByRole('button', { name: 'Save' }))).toBe(true))
    expect(disabled(within(form).getByRole('button', { name: 'Cancel' }))).toBe(true)
    expect((within(form).getByRole('textbox', { name: 'Name' }).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    fireEvent.keyDown(form, { key: 'Escape' })
    expect(screen.getByRole('group', { name: 'New automation' })).toBeTruthy()
    await waitFor(() => expect(runCommand.mock.calls.filter(([, args]) => args[0] === 'add').length).toBe(1))
    answer({ ok: true, output: { ok: true, command: 'daily-notes', file: '.claude/skills/daily-notes/SKILL.md', startsFrom: 'HEAD' } })
    const panel = await screen.findByText(/It is a file of yours/)
    expect(panel.textContent).toContain('Its row cannot start before you commit the file.')
    expect(screen.getByRole('group', { name: 'New automation' }).textContent).toContain('Its row is in the list now, switched off.')
    expect(screen.getByRole('group', { name: 'New automation' }).textContent).not.toMatch(/scheduler is not running/)
  })

  test('"Who gets it": shared with the project by default; "Only on this machine" saves with --private, and the saved panel says nothing is to commit and the row can start at once', async () => {
    const { host, runCommand } = scheduler((_, args) => (args[0] === 'add' ? { ok: true, output: { ok: true, command: 'watch-competitor', file: '.agent-scheduler/automations/watch-competitor.md', startsFrom: 'origin/main', onThisMachine: true } } : { ok: true, output: { ok: true } }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'New automation in gemstack' }))
    const form = screen.getByRole('group', { name: 'New automation' })
    const who = within(form).getByRole('radiogroup', { name: 'Who gets the automation' })
    expect(radioNames(who)).toEqual(['Shared with the project', 'Only on this machine'])
    const shared = radio(who, 'Shared with the project')
    const here = radio(who, 'Only on this machine')
    expect([checked(shared), checked(here)]).toEqual([true, false])
    expect(within(form).getByText('Saved as a skill file in this project, which you commit. The row starts switched off.')).toBeTruthy()
    // A shared one is a command to type, shown with its slash before the name; one kept here has none.
    const slashBefore = (): boolean => within(form).getByRole('textbox', { name: 'Name' }).parentElement!.textContent === '/'
    expect(slashBefore()).toBe(true)
    fireEvent.click(here)
    expect([checked(shared), checked(here)]).toEqual([false, true])
    expect(slashBefore()).toBe(false)
    expect(within(form).getByText('Give it a name, like answer-comments.')).toBeTruthy()
    expect(within(form).getByText('Kept on this machine alone, outside git. The row starts switched off, and can start as soon as you switch it on.')).toBeTruthy()
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'watch-competitor' } })
    fireEvent.change(within(form).getByLabelText('What the agent is told'), { target: { value: 'Look for new threads.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    const panel = await screen.findByText('It is kept on this machine alone: nothing to commit, and nobody else gets the row. Its row can start as soon as you switch it on. Its prompt is in the record of each run, which is shared where this project shares its records.')
    // No time of day was typed: one command, and nothing for this machine to keep beside the file.
    expect(saves(runCommand)).toEqual([['add', 'watch-competitor', '--prompt=Look for new threads.', '--every=1d', '--private']])
    expect(panel.closest('[role="group"]')!.textContent).toContain('Saved watch-competitor as .agent-scheduler/automations/watch-competitor.md.')
    expect(panel.closest('[role="group"]')!.textContent).not.toContain('commit it and bring it there')
  })

  test('a time of day typed in the form is this machine\'s: Save runs `add`, then `pace` with the interval and the time; a `pace` that is not taken still leaves the automation saved, and the form says its time was not kept', async () => {
    const added = { ok: true as const, output: { ok: true, command: 'daily-notes', file: '.claude/skills/daily-notes/SKILL.md', startsFrom: 'origin/main' } }
    let keep: ModuleCommandResult = { ok: true, output: { ok: true } }
    const { host, runCommand } = scheduler((_, args) => (args[0] === 'add' ? added : keep))
    show(host)
    const fill = (): HTMLElement => {
      fireEvent.click(screen.getByRole('button', { name: 'New automation in gemstack' }))
      const form = screen.getByRole('group', { name: 'New automation' })
      fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'daily-notes' } })
      fireEvent.change(within(form).getByLabelText('What the agent is told'), { target: { value: 'Write the notes.' } })
      fireEvent.change(within(form).getByLabelText('How long'), { target: { value: '2' } })
      fireEvent.change(within(form).getByLabelText('Time of day'), { target: { value: '09:00' } })
      expect(within(form).getByText('Every 2 days at 09:00.')).toBeTruthy()
      fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
      return form
    }
    await screen.findByRole('button', { name: 'New automation in gemstack' })
    fill()
    await screen.findByText(/It is a file of yours, in this project/)
    // The file holds the interval; the time is kept once the automation is there to keep it for.
    expect(saves(runCommand)).toEqual([
      ['add', 'daily-notes', '--prompt=Write the notes.', '--every=2d'],
      ['pace', 'daily-notes', '2d', '09:00'],
    ])
    expect(within(screen.getByRole('group', { name: 'New automation' })).queryByRole('alert')).toBeNull()
    fireEvent.click(within(screen.getByRole('group', { name: 'New automation' })).getByRole('button', { name: 'Done' }))

    keep = { ok: false, error: 'no skill of this project schedules daily-notes' }
    fill()
    const note = await screen.findByText(/It is a file of yours, in this project/)
    const panel = note.closest('[role="group"]') as HTMLElement
    expect(panel.textContent).toContain('Saved /daily-notes as .claude/skills/daily-notes/SKILL.md.')
    expect(within(panel).getByRole('alert').textContent).toBe("Its time of day was not kept: no skill of this project schedules daily-notes. Its row's Edit sets it.")
  })
})

describe("the rows are the project's files as they stand", () => {
  test("a new row is in the list the moment Save is pressed, also where no scheduler is running: the rows are read again from the project's files while the saved note is still open", async () => {
    let added = false
    const made = { command: 'answer-replies', every: '1d', description: 'Answer each new reply.', editable: true }
    const { host } = hostAnswering((_, args) => {
      // No scheduler runs here, and none ever looked: there is no last tick to list anything.
      if (args[0] === 'status') return { ok: true, output: { ok: true, on: false, keepAlive: false, running: false, model: 'opus', spendOffset: 7, schedule: added ? [...STATUS.schedule, made] : STATUS.schedule, unreadable: [] } }
      if (args[0] === 'add') added = true
      return { ok: true, output: args[0] === 'add' ? { ok: true, command: 'answer-replies', file: '.claude/skills/answer-replies/SKILL.md', startsFrom: 'origin/main' } : { ok: true } }
    })
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'New automation in gemstack' }))
    expect(screen.queryByRole('group', { name: 'Your automations' })).toBeNull()
    const form = screen.getByRole('group', { name: 'New automation' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), { target: { value: 'answer-replies' } })
    fireEvent.change(within(form).getByLabelText('What the agent is told'), { target: { value: 'Answer each new reply.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    const yours = await screen.findByRole('group', { name: 'Your automations' })
    const shown = within(yours).getByRole('listitem', { name: '/answer-replies' })
    expect(within(shown).getByText('Answer each new reply.')).toBeTruthy()
    expect(within(shown).getByText('Off')).toBeTruthy()
    expect(within(shown).getByRole('switch').getAttribute('aria-checked')).toBe('false')
    // The note is still up, and says where the row is.
    expect(screen.getByRole('group', { name: 'New automation' }).textContent).toContain('Its row is in the list now, switched off.')
  })

  test("an edited row says its new words the moment its save is over: what it does and its pace are read again from its file, with no scheduler having looked since", async () => {
    let edited = false
    const { host, runCommand } = hostAnswering((_, args) => {
      if (args[0] === 'status') return { ok: true, output: edited ? { ...MINE, schedule: MINE.schedule.map(c => (c.command === 'tidy' ? { ...c, every: '2d', description: 'Tidy up, gently.' } : c)) } : MINE }
      if (args[0] === 'show') return { ok: true, output: KEPT }
      if (args[0] === 'edit') edited = true
      return { ok: true, output: { ok: true, command: 'tidy', file: KEPT.file, startsFrom: 'HEAD', onThisMachine: true } }
    })
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(within(row('tidy')).getByText('Tidy up.')).toBeTruthy()
    expect(within(row('tidy')).getByText('Every 1 day')).toBeTruthy()
    const panel = await edit('tidy')
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Tidy up, gently.' } })
    fireEvent.change(within(panel).getByLabelText('How long'), { target: { value: '2' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('tidy')
    expect(saves(runCommand)).toEqual([['edit', 'tidy', '--prompt=Tidy up, gently.', '--every=2d', '--when=', '--waits-for=']])
    // The panel closed only once the rows were read back: the row already says the new words.
    expect(within(row('tidy')).getByText('Tidy up, gently.')).toBeTruthy()
    expect(within(row('tidy')).getByText('Every 2 days')).toBeTruthy()
    expect(within(row('tidy')).queryByText('Tidy up.')).toBeNull()
  })

  test('a read of the scheduler that fails for a moment keeps the rows as they were last read, under the line that says why: a panel open in one of them stays, with what was typed; the next read that goes through takes the line away', async () => {
    let failing = false
    const { host, runCommand } = hostAnswering((_, args) => (args[0] === 'status' ? (failing ? { ok: false, error: 'the state file could not be read' } : { ok: true, output: MINE }) : args[0] === 'show' ? { ok: true, output: KEPT } : { ok: true, output: { ok: true } }))
    show(host)
    const gemstack = await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('tidy')
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Tidy up, and say what moved.' } })
    // A save of another row reads the rows again, and that read fails.
    failing = true
    fireEvent.click(within(row('/work-queue')).getByRole('switch'))
    expect((await within(gemstack).findByRole('alert')).textContent).toBe('The scheduler could not be read: the state file could not be read')
    expect(within(gemstack).getByText('Scheduler not readable')).toBeTruthy()
    expect(runCommand).toHaveBeenCalledWith('p1', ['switch', 'work-queue', 'on'])
    // The rows stay, in their groups, and so does the panel with what was typed in it.
    expect(within(screen.getByRole('group', { name: 'Your automations' })).getByRole('listitem', { name: 'tidy' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: "From the project's skills" })).getByRole('listitem', { name: '/work-queue' })).toBeTruthy()
    expect((within(editing('tidy')).getByLabelText('What the agent is told') as HTMLTextAreaElement).value).toBe('Tidy up, and say what moved.')
    expect(disabled(within(editing('tidy')).getByRole('button', { name: 'Save' }))).toBe(false)
    // Read again, and it goes through: the line goes, and nothing typed went with it.
    failing = false
    fireEvent.click(within(row('/post-merge-cleanup')).getByRole('switch'))
    await waitFor(() => expect(within(gemstack).queryByRole('alert')).toBeNull())
    expect(within(gemstack).getByText('Scheduler on')).toBeTruthy()
    expect((within(editing('tidy')).getByLabelText('What the agent is told') as HTMLTextAreaElement).value).toBe('Tidy up, and say what moved.')
  })
})

describe('a save held against what the panel opened', () => {
  /** What `show` answers for the shared automation, with the tool's name for what its file says. */
  const VERSIONED = { ...SHOWN, version: 'v1' }
  const written = (version: string): ModuleCommandResult => ({ ok: true, output: { ok: true, command: 'answer-comments', file: SHOWN.file, startsFrom: 'origin/main', version } })
  const versioned = (saved: (args: string[]) => ModuleCommandResult) => hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: MINE } : args[0] === 'show' ? { ok: true, output: VERSIONED } : saved(args)))

  test("Save says which version of the file the panel opened, last on the line, so a change made to the file by hand since is not written over; the refusal is said like any other, and the panel stays open with what was typed", async () => {
    const refusal = '.claude/skills/answer-comments/SKILL.md was changed since it was opened here: open it again to see what it says now'
    const { host, runCommand } = versioned(() => ({ ok: false, error: refusal }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('/answer-comments')
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Answer in one line.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    expect((await within(panel).findByRole('alert')).textContent).toBe(`It was not saved: ${refusal}`)
    expect(saves(runCommand)).toEqual([['edit', 'answer-comments', '--prompt=Answer in one line.', '--every=15m', '--when=gh api comments', '--waits-for=when someone commented', '--was=v1']])
    expect(editing('/answer-comments')).toBeTruthy()
    expect((within(panel).getByLabelText('What the agent is told') as HTMLTextAreaElement).value).toBe('Answer in one line.')
    // Nothing was written, so nothing is said of a file to commit.
    expect(within(panel).getByRole('alert').textContent).not.toMatch(/are saved/)
  })

  test("a panel that saved its file once holds the next save against the version that save wrote, not the one it opened: its own save is no change made by hand", async () => {
    const answers: ModuleCommandResult[] = [written('v2'), { ok: false, error: 'the state could not be written' }, written('v3'), { ok: true, output: { ok: true } }]
    const { host, runCommand } = versioned(() => answers.shift()!)
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('/answer-comments')
    fireEvent.change(within(panel).getByLabelText('How long'), { target: { value: '2' } })
    await pick(within(panel).getByLabelText('Unit'), 'days')
    fireEvent.change(within(panel).getByLabelText('Not before this time of day'), { target: { value: '10:00' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await within(panel).findByRole('alert')
    // The file is written, the time of day is not: the person changes the words once more and saves again.
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Answer in one line.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await savedAgain('/answer-comments')
    expect(saves(runCommand)).toEqual([
      ['edit', 'answer-comments', '--prompt=Answer each new comment below.', '--every=2d', '--when=gh api comments', '--waits-for=when someone commented', '--was=v1'],
      ['pace', 'answer-comments', '2d', '10:00'],
      ['edit', 'answer-comments', '--prompt=Answer in one line.', '--every=2d', '--when=gh api comments', '--waits-for=when someone commented', '--was=v2'],
      ['pace', 'answer-comments', '2d', '10:00'],
    ])
  })

  test('an answer of `show` that names no version saves as before, held against nothing', async () => {
    const { host, runCommand } = mine(() => written('v2'))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('/answer-comments')
    fireEvent.change(within(panel).getByLabelText('What the agent is told'), { target: { value: 'Answer in one line.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await savedAgain('/answer-comments')
    expect(saves(runCommand)).toEqual([['edit', 'answer-comments', '--prompt=Answer in one line.', '--every=15m', '--when=gh api comments', '--waits-for=when someone commented']])
  })
})

describe('a row that resumes', () => {
  /** A skill's row that resumes the runs its check names, switched on, beside a row that starts runs. */
  const RESUMING = {
    ...STATUS,
    switches: { reply: '2026-10-03T08:00:00.000Z' },
    schedule: [STATUS.schedule[1], { command: 'reply', when: 'npx replies', waitsFor: "when someone answered on a run's pull request", description: 'Answer on the pull request.', resumes: true, ...ON_CLAUDE }],
  }
  const resuming = (over: object = {}, saved: (args: string[]) => ModuleCommandResult = () => ({ ok: true, output: { ok: true } })) =>
    hostAnswering((_, args) => (args[0] === 'status' ? { ok: true, output: { ...RESUMING, ...over } } : saved(args)))

  test("its line says each run answers on its own agent and model, and nothing of a publish pick; another row's line is as before", async () => {
    const { host } = resuming({ models: { reply: { agent: 'claude-code', model: 'haiku' } }, publishes: { reply: 'pr' } })
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const reply = row('/reply')
    expect(within(reply).getByText('Answers on the coding agent and model that opened the pull request')).toBeTruthy()
    expect(within(reply).queryByText('your pick')).toBeNull()
    expect(within(reply).queryByText(/May (commit|open)|As its skill says/)).toBeNull()
    expect(within(reply).getByText("When someone answered on a run's pull request")).toBeTruthy()
    expect(within(row('/work-queue')).getByText('May commit, pushes nothing')).toBeTruthy()
  })

  test('its panel picks no agent, model or publish level, and says why; how often it runs and how many at once are picked as on any row, and Save sends only those', async () => {
    const { host, runCommand } = resuming()
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    const panel = await edit('/reply')
    const runsOn = part(panel, 'What it runs on')
    expect(runsOn.textContent).toContain('Answers on the coding agent and model that opened the pull request.')
    expect(within(runsOn).queryByLabelText('Agent')).toBeNull()
    expect(within(runsOn).queryByLabelText('Model')).toBeNull()
    expect(within(panel).queryByRole('combobox', { name: 'What its runs publish' })).toBeNull()
    expect(within(panel).queryByRole('region', { name: 'What its runs publish' })).toBeNull()
    expect(within(panel).getByText("When someone answered on a run's pull request. Answers on the coding agent and model that opened the pull request. Nothing is changed yet.")).toBeTruthy()
    const many = part(panel, 'How many at once')
    fireEvent.click(radio(many, 'A number you set'))
    fireEvent.change(within(many).getByLabelText('How many agents'), { target: { value: '3' } })
    expect(within(panel).getByText("When someone answered on a run's pull request. Up to 3 at once. Answers on the coding agent and model that opened the pull request.")).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }))
    await gone('/reply')
    expect(saves(runCommand)).toEqual([['agents', 'reply', '3']])
  })

  test("what the scheduler last decided says the reason of a run it did not resume in the page's words, and nothing of one it resumed; \"Run now\" says it resumed a run, which \"Open it\" opens", async () => {
    const capped = resuming({ lastTick: { at: '2026-10-03T10:00:00.000Z', decisions: [{ command: 'reply', outcome: 'run r2 not resumed: cap reached (1 in flight: r1 on this-box)' }] } })
    show(capped.host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(within(row('/reply')).getByText('One is already running')).toBeTruthy()
    cleanup()
    const quota = resuming({ lastTick: { at: '2026-10-03T10:00:00.000Z', decisions: [{ command: 'reply', outcome: 'run r2 not resumed: quota: Current week is 99% used' }] } })
    show(quota.host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(within(row('/reply')).getByText('Quota: Current week is 99% used')).toBeTruthy()
    cleanup()
    const { host, runCommand } = resuming({ lastTick: { at: '2026-10-03T10:00:00.000Z', decisions: [{ command: 'reply', outcome: 'resumed r1', run: 'r1' }] } }, args => (args[0] === 'now' ? { ok: true, output: { ok: true, command: 'reply', run: 'r1' } } : { ok: true, output: { ok: true } }))
    show(host)
    await screen.findByRole('region', { name: 'gemstack' })
    expect(within(row('/reply')).queryByText(/resumed/i)).toBeNull()
    fireEvent.click(within(row('/reply')).getByRole('button', { name: 'Run /reply now' }))
    const said = await within(row('/reply')).findByRole('status')
    expect(said.textContent).toBe('Resumed a run. Open it')
    fireEvent.click(within(said).getByRole('button', { name: 'Open it' }))
    expect(host.openAgent).toHaveBeenCalledWith('p1', 'r1')
    expect(saves(runCommand)).toEqual([['now', 'reply']])
  })
})
