import { describe, expect, test } from 'vitest'
import { STATUS, hostAnswering } from './fixtures.js'
import { agentOf, modelLabel, modelOf, runsOnWords, agentsArgs, agentsDraftOf, atOnce, atOnceWords, saysAtOnce, cannotRun, decided, draftOf, isOwn, outcomeWords, loosestSpendOffset, nextWords, offsetsThatDiffer, ownPace, pace, paceArgs, paceProblem, publishChoices, publishLabel, publishes, readSchedulers, saveSpendOffset, schedulerRow, schedulerStatus, schedulerStopped, nextStart, startsNext, spelled, typedOffset, withAgentsDraft, withDraft, rowTitle, unlistedWords } from './schedulers.js'

const GEMSTACK = { id: 'p1', name: 'gemstack', gitHost: true }
const OTHER = { id: 'p2', name: 'other', gitHost: false }

/** What a row carries of who runs it when a test is about something else: made for Claude Code, and either agent can run it. */
const MADE = { home: 'claude-code', able: ['claude-code', 'codex'] } as const

describe('a scheduler row, from what status printed', () => {
  test("each scheduled command carries this machine's switch and publish pick, off until switched on here and commit until picked here, what its skill says it does, and the last tick's decision for it", () => {
    const row = schedulerRow(GEMSTACK, STATUS)
    expect(row).toMatchObject({ project: GEMSTACK, on: true, keepAlive: false, running: true, model: 'opus', spendOffset: 7, unreadable: [] })
    expect(row.commands).toEqual([
      // Switched on here; nobody picked a level.
      { command: 'post-merge-cleanup', every: '1d', on: true, publish: 'commit', description: 'Write up merged pull requests.', decision: STATUS.lastTick.decisions[0], home: 'claude-code', able: ['claude-code'] },
      // Nobody switched it on here; the pick made here is nothing.
      { command: 'work-queue', when: 'npx queue', waitsFor: 'when the queue holds a task', on: false, publish: 'nothing', description: 'Work one queued task.', decision: STATUS.lastTick.decisions[1], home: 'claude-code', able: ['claude-code'] },
    ])
    expect(row.lastTick).toEqual({ at: '2026-10-03T10:00:00.000Z', decisions: STATUS.lastTick.decisions })
  })

  test("a scheduled command carries the pace a person set for it on this machine", () => {
    const since = '2026-10-08T07:00:00.000Z'
    const row = schedulerRow(GEMSTACK, { ...STATUS, paces: { 'post-merge-cleanup': { every: '2d', at: '10:00', since }, 'work-queue': { work: true }, gone: { every: '1h', since } } })
    expect(row.commands.map(c => [c.command, c.pace])).toEqual([['post-merge-cleanup', { every: '2d', at: '10:00', since }], ['work-queue', { work: true }]])
  })

  test("a skill whose schedule cannot be read is named with the reason, as the answer lists it now; the last tick's line about it is no command's decision, and is not what names it", () => {
    const row = schedulerRow(GEMSTACK, {
      ...STATUS,
      unreadable: [{ skill: 'triage', reason: 'row 2: unknown key evry' }],
      lastTick: { ...STATUS.lastTick, decisions: [{ command: 'triage', outcome: 'unreadable schedule: row 2: unknown key evry' }, ...STATUS.lastTick.decisions] },
    })
    expect(row.unreadable).toEqual([{ skill: 'triage', reason: 'row 2: unknown key evry' }])
    expect(row.commands.map(c => c.decision?.outcome)).toEqual(['started 2026-10-03T10-00-00-000Z', 'switched off on this machine'])
    // Mended since the last tick: the tick's old line names nothing.
    expect(schedulerRow(GEMSTACK, { ...STATUS, lastTick: { ...STATUS.lastTick, decisions: [{ command: 'triage', outcome: 'unreadable schedule: row 2: unknown key evry' }] } }).unreadable).toEqual([])
  })

  test("the rows are the schedule the answer reads from the project's files, not what the last tick listed: a command saved since that tick is a row, one removed since is none, and a project no scheduler ever looked at has its rows", () => {
    const tick = { at: '2026-10-03T10:00:00.000Z', decisions: [{ command: 'gone', outcome: 'not due' }], schedule: [{ command: 'gone', every: '1d' }, { command: 'work-queue', when: 'npx queue' }] }
    const row = schedulerRow(GEMSTACK, { on: true, running: true, lastTick: tick, schedule: [{ command: 'work-queue', when: 'npx queue' }, { command: 'answer-comments', every: '15m', editable: true }] })
    expect(row.commands.map(c => c.command)).toEqual(['work-queue', 'answer-comments'])
    expect(schedulerRow(GEMSTACK, { on: false, running: false, schedule: [{ command: 'tidy', every: '1d', onThisMachine: true, editable: true }] }).commands).toEqual([{ command: 'tidy', every: '1d', on: false, publish: 'commit', onThisMachine: true, editable: true, ...MADE }])
    // What only the last tick lists is no row.
    expect(schedulerRow(GEMSTACK, { on: true, running: true, lastTick: tick }).commands).toEqual([])
  })

  test("a command the tick lists as this machine's is an automation kept here: its row is named without a slash, since nobody types it as a command", () => {
    const row = schedulerRow(GEMSTACK, { on: true, running: true, schedule: [{ command: 'answer-comments', when: 'gh api comments', onThisMachine: true }, { command: 'work-queue', when: 'npx queue', onThisMachine: 'yes' }] })
    expect(row.commands.map(c => [c.command, c.onThisMachine, rowTitle(c)])).toEqual([
      ['answer-comments', true, 'answer-comments'],
      ['work-queue', undefined, '/work-queue'],
    ])
  })

  test("a command the tick lists with its last run carries that run's id, its start and whether it failed; anything else said there is no run", () => {
    const at = '2026-10-03T09:00:00.000Z'
    const schedule = [
      { command: 'work-queue', when: 'npx queue', lastRun: { id: 'r1', at, failed: true } },
      { command: 'triage', every: '6h', lastRun: { id: 'r2', at, failed: 'yes' } },
      { command: 'plan', every: '6h', lastRun: { id: '', at } },
      { command: 'tidy', every: '1d', lastRun: { id: 'r4', at: 'yesterday' } },
      { command: 'sweep', every: '1d', lastRun: 'r5' },
      { command: 'never', every: '1d' },
    ]
    const row = schedulerRow(GEMSTACK, { on: true, running: true, lastTick: { at: '2026-10-03T10:00:00.000Z', decisions: [] }, schedule })
    expect(row.commands.map(c => [c.command, c.lastRun])).toEqual([
      ['work-queue', { id: 'r1', at, failed: true }],
      ['triage', { id: 'r2', at }],
      ['plan', undefined],
      ['tidy', undefined],
      ['sweep', undefined],
      ['never', undefined],
    ])
  })

  test('a row a person made with "New automation" is told from a skill of the project: its file reads as the tool writes one, or it is kept on this machine alone', () => {
    expect([isOwn({}), isOwn({ editable: true }), isOwn({ onThisMachine: true }), isOwn({ editable: true, onThisMachine: true })]).toEqual([false, true, true, true])
  })

  test("a command the tick lists as an automation the tool wrote is one the page can open again and remove; anything else the tick says there is not", () => {
    const row = schedulerRow(GEMSTACK, { on: true, running: true, schedule: [{ command: 'answer-comments', every: '15m', editable: true }, { command: 'tidy', every: '1d', onThisMachine: true, editable: true }, { command: 'work-queue', when: 'npx queue' }, { command: 'triage', every: '6h', editable: 'yes' }] })
    expect(row.commands.map(c => [c.command, c.editable])).toEqual([
      ['answer-comments', true],
      ['tidy', true],
      ['work-queue', undefined],
      ['triage', undefined],
    ])
  })

  test("what is not listed: a skill whose schedule cannot be read, and an automation kept on this machine, each said in its own words; the last tick's line about one is no decision of a command of that name; an entry that is not what the command promises is none", () => {
    const row = schedulerRow(GEMSTACK, {
      on: true,
      running: true,
      lastTick: {
        at: '2026-10-03T10:00:00.000Z',
        decisions: [
          { command: 'triage', outcome: 'unreadable schedule: unknown key evry' },
          { command: 'plan', outcome: 'unlisted automation: a skill of the project has this name too: rename or remove .agent-scheduler/automations/plan.md, then switch on what you want' },
          { command: 'plan', outcome: 'started 2026-10-03T10-00-00-000Z', run: '2026-10-03T10-00-00-000Z' },
        ],
      },
      schedule: [{ command: 'plan', every: '1d' }],
      unreadable: [
        { skill: 'triage', reason: 'unknown key evry' },
        { skill: 'plan', reason: 'a skill of the project has this name too: rename or remove .agent-scheduler/automations/plan.md, then switch on what you want', own: true },
        { skill: 'half' },
        { reason: 'no name' },
        { skill: 'odd', reason: 7 },
        'triage',
        null,
      ],
    })
    expect(row.unreadable).toEqual([
      { skill: 'triage', reason: 'unknown key evry' },
      { skill: 'plan', reason: 'a skill of the project has this name too: rename or remove .agent-scheduler/automations/plan.md, then switch on what you want', own: true },
    ])
    expect(row.unreadable.map(unlistedWords)).toEqual([
      'The schedule of the triage skill cannot be read, so it is not listed: unknown key evry',
      'The automation plan, kept on this machine, is not listed: a skill of the project has this name too: rename or remove .agent-scheduler/automations/plan.md, then switch on what you want',
    ])
    expect(row.commands[0]!.decision).toEqual({ command: 'plan', outcome: 'started 2026-10-03T10-00-00-000Z', run: '2026-10-03T10-00-00-000Z' })
  })

  test('an answer with no schedule lists no command; a field that is not what the command promises reads as absent', () => {
    expect(schedulerRow(GEMSTACK, { ok: true, on: false, keepAlive: false, model: 'opus', spendOffset: 7.14, running: false })).toEqual({ project: GEMSTACK, on: false, keepAlive: false, running: false, model: 'opus', spendOffset: 7.14, commands: [], unreadable: [] })
    const odd = schedulerRow(GEMSTACK, {
      on: 'yes',
      spendOffset: 'far',
      model: 3,
      switches: { a: 'yes' },
      publishes: { a: 'push' },
      paces: { a: { every: 'often' } },
      lastTick: { at: '2026-10-03T10:00:00.000Z', note: 'off', decisions: [{ command: 'a' }, 'x'] },
      schedule: [{ command: 'a', every: 6, waitsFor: ['x'], description: 7 }, { every: '1d' }, null],
      unreadable: 'none',
    })
    expect(schedulerRow(GEMSTACK, { on: true, running: true, schedule: 'all' }).commands).toEqual([])
    expect(odd).toEqual({ project: GEMSTACK, on: false, keepAlive: false, running: false, lastTick: { at: '2026-10-03T10:00:00.000Z', decisions: [], note: 'off' }, commands: [{ command: 'a', on: false, publish: 'commit', ...MADE }], unreadable: [] })
    expect(schedulerRow(GEMSTACK, null).commands).toEqual([])
  })
})

describe('reading and saving through the command', () => {
  test('status runs in every project; a project whose command fails is a row that says why', async () => {
    const { host, runCommand } = hostAnswering(projectId => (projectId === 'p1' ? { ok: true, output: STATUS } : { ok: false, error: 'not inside a git repository' }))
    const rows = await readSchedulers(host, [GEMSTACK, OTHER])
    expect(runCommand.mock.calls).toEqual([['p1', ['status']], ['p2', ['status']]])
    expect(rows[0]!.commands).toHaveLength(2)
    expect(rows[1]).toEqual({ project: OTHER, error: 'not inside a git repository', on: false, keepAlive: false, running: false, commands: [], unreadable: [] })
    expect(schedulerStatus(rows[1]!).label).toBe('not readable')
  })

  test('the offset in force is the loosest one; none when no project answered one', () => {
    const row = (spendOffset?: number) => ({ ...schedulerRow(GEMSTACK, {}), ...(spendOffset !== undefined ? { spendOffset } : {}) })
    expect(loosestSpendOffset([row(-5), row(12), row()])).toBe(12)
    expect(loosestSpendOffset([row(), row()])).toBeUndefined()
    expect(loosestSpendOffset([])).toBeUndefined()
  })

  test('the projects whose offset is not the one in force are named with their own; none when they agree or did not answer', () => {
    const row = (name: string, spendOffset?: number) => ({ ...schedulerRow({ id: name, name, gitHost: true }, {}), ...(spendOffset !== undefined ? { spendOffset } : {}) })
    expect(offsetsThatDiffer([row('a', 12), row('b', -5.04), row('c'), row('d', 12)])).toEqual([{ name: 'b', offset: -5 }])
    expect(offsetsThatDiffer([row('a', 4), row('b', 4)])).toEqual([])
    expect(offsetsThatDiffer([row('a')])).toEqual([])
  })

  test('a typed offset is a whole number held to the reach of the bar; text that is no number yet is none', () => {
    expect(typedOffset('7.6')).toBe(8)
    expect(typedOffset('-200')).toBe(-50)
    expect(typedOffset('200')).toBe(50)
    expect(typedOffset('0')).toBe(0)
    expect(typedOffset('-')).toBeUndefined()
    expect(typedOffset(' ')).toBeUndefined()
    expect(typedOffset('')).toBeUndefined()
  })

  test('the offset is saved in every project, a negative one after `--`; each failing project is named', async () => {
    const { host, runCommand } = hostAnswering(projectId => (projectId === 'p2' ? { ok: false, error: 'exit 2' } : { ok: true, output: { ok: true } }))
    expect(await saveSpendOffset(host, [GEMSTACK], -12.5)).toEqual({ ok: true })
    expect(runCommand).toHaveBeenLastCalledWith('p1', ['offset', '--', '-12.5'])
    expect(await saveSpendOffset(host, [GEMSTACK, OTHER], 3)).toEqual({ ok: false, error: 'other: exit 2' })
  })
})

describe('in words', () => {
  test('the status a row leads with: off, on but not running, on', () => {
    const row = schedulerRow(GEMSTACK, STATUS)
    expect(schedulerStatus(row)).toEqual({ label: 'on', tone: 'text-success' })
    expect(schedulerStatus({ ...row, running: false }).label).toBe('on, not running')
    expect(schedulerStatus({ ...row, on: false }).label).toBe('off')
  })

  test('the pace, as a sentence: an interval spelled out, what the check waits for, or both; a check with no plain line is "when its shell line prints something"', () => {
    const base = { command: 'a', on: true, publish: 'commit' as const, ...MADE }
    expect(pace({ ...base, every: '1d' })).toBe('Every 1 day')
    expect(pace({ ...base, when: 'npx queue' })).toBe('When its shell line prints something')
    expect(pace({ ...base, when: 'npx queue', waitsFor: 'when the queue holds a task' })).toBe('When the queue holds a task')
    expect(pace({ ...base, every: '6h', when: 'x' })).toBe('Every 6 hours at most, when its shell line prints something')
    expect(pace({ ...base, every: '15m', when: 'x', waitsFor: 'when a ticket has no plan' })).toBe('Every 15 minutes at most, when a ticket has no plan')
    expect([spelled('1m'), spelled('1h'), spelled('7d'), spelled('2w'), spelled('1mo'), spelled('soon'), spelled('0d'), spelled('d'), spelled('-3h'), spelled('06h')]).toEqual(['1 minute', '1 hour', '7 days', '2 weeks', '1 month', 'soon', '0d', 'd', '-3h', '6 hours'])
    // An interval of the skill's the tool would not have read is shown as written.
    expect(pace({ ...base, every: '2y' })).toBe('Every 2y')
  })

  test("the pace in force is this machine's where a person set one: its interval, a time of day, or whenever there is work; a pick that cannot be followed leaves the skill's", () => {
    const skill = { command: 'a', on: true, publish: 'commit' as const, ...MADE, every: '6h', when: 'x', waitsFor: 'when a ticket has no plan' }
    const since = '2026-10-08T07:00:00.000Z'
    expect(pace({ ...skill, pace: { every: '30m', since } })).toBe('Every 30 minutes at most, when a ticket has no plan')
    // Beside a check a time of day is "from": the command starts once the check finds work, which may be later that day.
    expect(pace({ ...skill, pace: { every: '2d', at: '10:00', since } })).toBe('Every 2 days from 10:00, when a ticket has no plan')
    expect(pace({ ...skill, pace: { every: '2w', since } })).toBe('Every 2 weeks at most, when a ticket has no plan')
    expect(pace({ ...skill, pace: { work: true } })).toBe('When a ticket has no plan')
    expect(pace({ command: 'a', on: true, publish: 'commit', ...MADE, every: '1d', pace: { every: '1mo', at: '9:05', since } })).toBe('Every 1 month at 09:05')
    // No check to ask: "whenever there is work" cannot be followed, the skill's interval stands.
    expect(pace({ command: 'a', on: true, publish: 'commit', ...MADE, every: '1d', pace: { work: true } })).toBe('Every 1 day')
    expect(ownPace({ ...skill, pace: { every: '30m', since } })).toBe(true)
    expect(ownPace({ ...skill, pace: { work: true } })).toBe(true)
    expect(ownPace(skill)).toBe(false)
    expect(ownPace({ command: 'a', on: true, publish: 'commit', ...MADE, every: '1d', pace: { work: true } })).toBe(false)
  })

  test('the Edit box\'s draft: it opens with the pace in force, and reads as the words of the `pace` command; a half-typed one is no pace yet', () => {
    const skill = { command: 'a', on: true, publish: 'commit' as const, ...MADE, every: '6h', when: 'x' }
    const since = '2026-10-08T07:00:00.000Z'
    expect(draftOf(skill)).toEqual({ kind: 'skill' })
    expect(draftOf({ ...skill, pace: { work: true } })).toEqual({ kind: 'work' })
    expect(draftOf({ ...skill, pace: { every: '2d', at: '10:00', since } })).toEqual({ kind: 'every', count: '2', unit: 'd', at: '10:00' })
    expect(draftOf({ ...skill, pace: { every: '30m', since } })).toEqual({ kind: 'every', count: '30', unit: 'm', at: '' })
    // A skill with a check and no interval already runs whenever there is work.
    expect(draftOf({ command: 'a', on: true, publish: 'commit', ...MADE, when: 'x', pace: { work: true } })).toEqual({ kind: 'skill' })

    expect(paceArgs({ kind: 'skill' })).toEqual(['skill'])
    expect(paceArgs({ kind: 'work' })).toEqual(['work'])
    expect(paceArgs({ kind: 'every', count: '2', unit: 'd', at: '10:00' })).toEqual(['2d', '10:00'])
    expect(paceArgs({ kind: 'every', count: ' 15 ', unit: 'm', at: '' })).toEqual(['15m'])
    expect(paceArgs({ kind: 'every', count: '1', unit: 'mo', at: '' })).toEqual(['1mo'])
    // A time left in the field beside minutes or hours is not sent: the page hides the field then.
    expect(paceArgs({ kind: 'every', count: '6', unit: 'h', at: '10:00' })).toEqual(['6h'])
    for (const count of ['', '0', '1.5', '-2', 'two', '10000', '1e2']) {
      expect(paceArgs({ kind: 'every', count, unit: 'd', at: '' }), count).toBeUndefined()
      expect(paceProblem({ kind: 'every', count, unit: 'd', at: '' }), count).toBe('Type a whole number, from 1 to 9999.')
    }
    expect(paceArgs({ kind: 'every', count: '2', unit: 'd', at: '25:00' })).toBeUndefined()
    // A time field left half typed has no text: the draft says so, and it is no pace until finished or cleared.
    expect(paceArgs({ kind: 'every', count: '2', unit: 'd', at: '', atHalfTyped: true })).toBeUndefined()
    expect(paceProblem({ kind: 'every', count: '2', unit: 'd', at: '', atHalfTyped: true })).toBe('Finish the time, like 10:00, or clear it.')
    // Beside minutes or hours there is no time field, so a half-typed time left behind does not count.
    expect(paceArgs({ kind: 'every', count: '2', unit: 'h', at: '', atHalfTyped: true })).toEqual(['2h'])
    expect(paceProblem({ kind: 'every', count: '2', unit: 'd', at: '10:00' })).toBeUndefined()
    expect(paceProblem({ kind: 'skill' })).toBeUndefined()
    // A state edited by hand: only `work: true` is "whenever there is work".
    expect(draftOf({ ...skill, pace: { work: false, every: '2d', since } as never })).toEqual({ kind: 'every', count: '2', unit: 'd', at: '' })

    // What the row would read as, saved.
    expect(pace(withDraft(skill, { kind: 'every', count: '2', unit: 'd', at: '10:00' }))).toBe('Every 2 days from 10:00, when its shell line prints something')
    expect(pace(withDraft({ ...skill, pace: { every: '30m', since } }, { kind: 'skill' }))).toBe('Every 6 hours at most, when its shell line prints something')
    expect(pace(withDraft(skill, { kind: 'work' }))).toBe('When its shell line prints something')
    expect(withDraft(skill, { kind: 'every', count: '', unit: 'd', at: '' })).toBe(skill)
  })

  test('a coming time, for a person: today, tomorrow, the weekday within a week, else the date', () => {
    const now = new Date(2026, 9, 8, 21, 30)
    expect(nextWords(new Date(2026, 9, 8, 23, 0), now)).toBe('today 23:00')
    expect(nextWords(new Date(2026, 9, 9, 10, 0), now)).toBe('tomorrow 10:00')
    expect(nextWords(new Date(2026, 9, 10, 9, 5), now)).toBe('Saturday 09:05')
    expect(nextWords(new Date(2026, 9, 14, 10, 0), now)).toBe('Wednesday 10:00')
    expect(nextWords(new Date(2026, 9, 15, 10, 0), now)).toBe('15 Oct 10:00')
    expect(nextWords(new Date(2026, 10, 7, 10, 0), now)).toBe('7 Nov 10:00')
    // Read off an old tick: the time has passed, and the scheduler has not looked since.
    expect(nextWords(new Date(2026, 9, 8, 10, 0), now)).toBe('as soon as the scheduler looks')
    expect(nextWords(new Date(2026, 9, 3, 10, 0), now)).toBe('as soon as the scheduler looks')
    const waiting = { command: 'a', on: true, publish: 'commit' as const, ...MADE, decision: { command: 'a', outcome: 'not due (next start from 2026-10-10 10:00, every 2d at 10:00)' } }
    expect(decided(waiting, now)).toBe('Next start Saturday 10:00')
    // Beside a shell line the time is where the wait ends, not the start: it still needs work.
    expect(decided({ ...waiting, when: 'npx x' }, now)).toBe('Next start Saturday 10:00, if there is work')
    expect(decided({ ...waiting, on: false }, now)).toBeUndefined()
  })

  test("how many agents at once: this machine's number, else the skill's, one when it says none; the Edit box's draft reads as the words of the `agents` command", () => {
    const base = { command: 'a', on: true, publish: 'commit' as const, ...MADE }
    expect(atOnce(base)).toBe(1)
    expect(atOnce({ ...base, skillAgents: 2 })).toBe(2)
    expect(atOnce({ ...base, skillAgents: 2, agents: 1 })).toBe(1)
    expect(atOnce({ ...base, agents: 3 })).toBe(3)
    expect([atOnceWords(1), atOnceWords(2), atOnceWords(10)]).toEqual(['One at a time', 'Up to 2 at once', 'Up to 10 at once'])
    // Worth saying when it is more than one, or a person set it, even to one.
    expect([saysAtOnce(base), saysAtOnce({ ...base, skillAgents: 2 }), saysAtOnce({ ...base, agents: 1 }), saysAtOnce({ ...base, skillAgents: 2, agents: 1 })]).toEqual([false, true, true, true])

    expect(agentsDraftOf(base)).toEqual({ kind: 'skill' })
    expect(agentsDraftOf({ ...base, agents: 3 })).toEqual({ kind: 'own', count: '3' })
    expect(agentsArgs({ kind: 'skill' })).toEqual(['skill'])
    expect(agentsArgs({ kind: 'own', count: ' 03 ' })).toEqual(['3'])
    for (const count of ['', '0', '1.5', '-2', 'two', '1e2', '100']) expect(agentsArgs({ kind: 'own', count }), count).toBeUndefined()
    expect(agentsArgs({ kind: 'own', count: '99' })).toEqual(['99'])
    expect(atOnce(withAgentsDraft({ ...base, skillAgents: 2 }, { kind: 'own', count: '5' }))).toBe(5)
    expect(atOnce(withAgentsDraft({ ...base, skillAgents: 2, agents: 5 }, { kind: 'skill' }))).toBe(2)
    const half = { ...base, agents: 5 }
    expect(withAgentsDraft(half, { kind: 'own', count: '' })).toBe(half)
  })

  test("a scheduled command carries its skill's number of agents at once when it is more than one, and the number a person set on this machine", () => {
    const row = schedulerRow(GEMSTACK, {
      ...STATUS,
      agents: { 'post-merge-cleanup': 3, 'work-queue': 0, gone: 2 },
      schedule: [{ command: 'post-merge-cleanup', every: '1d', agents: 2 }, { command: 'work-queue', when: 'npx queue', agents: 1 }],
    })
    expect(row.commands.map(c => [c.command, c.skillAgents, c.agents])).toEqual([['post-merge-cleanup', 2, 3], ['work-queue', undefined, undefined]])
  })

  test("a row carries the coding agent it is made for, the model its skill names, the agents that can run it, and this machine's picks of either; a row that says none of it reads as made for Claude Code, which either agent can run", () => {
    const schedule = [
      { command: 'update-tickets', every: '15m', agent: 'claude-code', model: 'haiku', modelAgent: 'claude-code', able: ['claude-code'] },
      { command: 'review', every: '1d', agent: 'codex', model: 'gpt-5.5', modelAgent: 'codex', able: ['claude-code', 'codex'] },
      // A pick of the agent the row is made for is no pick; a model picked for another agent than the one its runs are on is none.
      { command: 'audit', every: '1d', agent: 'claude-code', able: ['claude-code', 'codex'] },
      { command: 'codex-only', every: '1d', agent: 'codex', able: ['codex'] },
      // Not what the command promises: an agent nobody knows, a model that is no word, a list with strangers in it.
      { command: 'odd', every: '1d', agent: 'cursor', model: '', able: ['codex', 'cursor', 7] },
      { command: 'plain', every: '1d' },
    ]
    const row = schedulerRow(GEMSTACK, { on: true, running: true, model: 'opus', schedule, runsOn: { review: 'claude-code', 'update-tickets': 'cursor', audit: 'claude-code', gone: 'codex' }, models: { review: { agent: 'claude-code', model: 'sonnet' }, audit: { agent: 'codex', model: 'gpt-5.5' }, 'update-tickets': 'opus', 'codex-only': { agent: 'codex', model: ' ' }, plain: 7 } })
    expect(row.commands.map(c => [c.command, c.home, c.skillModel, c.skillModelAgent, c.able, c.runsOn, c.model])).toEqual([
      ['update-tickets', 'claude-code', 'haiku', 'claude-code', ['claude-code'], undefined, undefined],
      ['review', 'codex', 'gpt-5.5', 'codex', ['claude-code', 'codex'], 'claude-code', 'sonnet'],
      ['audit', 'claude-code', undefined, undefined, ['claude-code', 'codex'], undefined, undefined],
      ['codex-only', 'codex', undefined, undefined, ['codex'], undefined, undefined],
      ['odd', 'claude-code', undefined, undefined, ['codex'], undefined, undefined],
      ['plain', 'claude-code', undefined, undefined, ['claude-code', 'codex'], undefined, undefined],
    ])
  })

  test("what a row's runs are on: the agent picked here, else the one it is made for; the model picked here, else its skill's on the agent the skill is made for, else the scheduler's own on Claude Code, and none on another agent; said by the names the agents list", () => {
    const agents = [
      { value: 'claude-code', label: 'Claude Code', models: [{ value: 'opus', label: 'Opus 5.5' }, { value: 'haiku', label: 'Haiku 5.5' }] },
      { value: 'codex', label: 'Codex', models: [{ value: 'gpt-5.5', label: 'GPT-5.5' }] },
    ]
    const base = { command: 'a', on: true, publish: 'commit' as const, ...MADE }
    expect([agentOf(base), agentOf({ ...base, runsOn: 'codex' }), agentOf({ ...base, home: 'codex' }), agentOf({ ...base, home: 'codex', runsOn: 'claude-code' })]).toEqual(['claude-code', 'codex', 'codex', 'claude-code'])
    // Nobody picked and the skill names none: the scheduler's own, on Claude Code.
    expect([modelOf(base, 'opus'), modelOf(base, undefined), runsOnWords(base, 'opus', agents)]).toEqual(['opus', undefined, 'Claude Code, Opus 5.5'])
    // The skill names its model, for the agent it is made for.
    const cheap = { ...base, skillModel: 'haiku', skillModelAgent: 'claude-code' as const }
    expect([modelOf(cheap, 'opus'), runsOnWords(cheap, 'opus', agents)]).toEqual(['haiku', 'Claude Code, Haiku 5.5'])
    // Switched to Codex here: the skill's model was Claude's, so Codex's own default, and no model is said.
    expect([modelOf({ ...cheap, runsOn: 'codex' }, 'opus'), runsOnWords({ ...cheap, runsOn: 'codex' }, 'opus', agents)]).toEqual([undefined, 'Codex'])
    // A model picked here wins, on whichever agent.
    expect(runsOnWords({ ...cheap, model: 'opus' }, 'sonnet', agents)).toBe('Claude Code, Opus 5.5')
    expect(runsOnWords({ ...cheap, runsOn: 'codex', model: 'gpt-5.5' }, 'opus', agents)).toBe('Codex, GPT-5.5')
    // Made for Codex with a model of Codex's, and switched to Claude Code here: the scheduler's own.
    const forCodex = { ...base, home: 'codex' as const, skillModel: 'gpt-5.5', skillModelAgent: 'codex' as const }
    // A skill only in Codex's folder that names a model and no agent: the model is Claude Code's, so Codex's own default.
    expect(runsOnWords({ ...base, home: 'codex', skillModel: 'haiku', skillModelAgent: 'claude-code' }, 'opus', agents)).toBe('Codex')
    // Tried in the panel on another agent, the model picked here does not go along.
    expect([modelOf({ ...cheap, model: 'opus' }, 'sonnet', 'codex'), modelOf({ ...cheap, model: 'opus' }, 'sonnet', 'claude-code')]).toEqual([undefined, 'opus'])
    expect([runsOnWords(forCodex, 'opus', agents), runsOnWords({ ...forCodex, runsOn: 'claude-code' }, 'opus', agents)]).toEqual(['Codex, GPT-5.5', 'Claude Code, Opus 5.5'])
    // A model its agent does not list, or a list not answered yet, is named by its id.
    expect([modelLabel(agents, 'claude-code', 'haiku'), modelLabel(agents, 'claude-code', 'claude-fable-5'), modelLabel(agents, 'codex', 'haiku'), modelLabel([], 'codex', 'gpt-5.5')]).toEqual(['Haiku 5.5', 'claude-fable-5', 'haiku', 'gpt-5.5'])
    expect(runsOnWords(base, 'sonnet', [])).toBe('Claude Code, sonnet')
  })

  test("how far a scheduled command publishes, by this machine's pick", () => {
    const base = { command: 'a', on: true, ...MADE }
    expect(publishes({ ...base, publish: 'nothing' })).toBe('As its skill says')
    // A row a person made has no skill to follow: its prompt says.
    expect([publishes({ ...base, publish: 'nothing', editable: true }), publishes({ ...base, publish: 'nothing', onThisMachine: true }), publishes({ ...base, publish: 'commit', editable: true })]).toEqual(['As its prompt says', 'As its prompt says', 'May commit, pushes nothing'])
    expect([publishLabel('nothing', false), publishLabel('nothing', true), publishLabel('pr', true)]).toEqual(['As the skill says', 'As the prompt says', 'Open PR'])
    expect(publishes({ ...base, publish: 'commit' })).toBe('May commit, pushes nothing')
    expect(publishes({ ...base, publish: 'branch' })).toBe('May publish its branch')
    expect(publishes({ ...base, publish: 'pr' })).toBe('May open a pull request')
    expect(publishes({ ...base, publish: 'merge' })).toBe('May open a pull request that merges on green')
  })

  test("what the scheduler last decided for a command, for a person: No work, when it starts next while its wait is not over, how many are running, else the tool's own words; nothing where the row says it in another place, switched off or just started", () => {
    const on = { command: 'a', on: true, publish: 'commit' as const, ...MADE }
    const said = (outcome: string, over: object = {}) => decided({ ...on, ...over, decision: { command: 'a', outcome } })
    expect(said('not due')).toBe('No work')
    // A wait that is not over is said as the time left, counted from the row's last start as of now.
    const twoHoursAgo = { id: 'r', at: new Date(Date.now() - 2 * 3_600_000).toISOString() }
    expect(said('not due (last start 2h ago, every 6h)', { every: '6h', lastRun: twoHoursAgo })).toBe('Next start in 4h')
    expect(said('not due (last start 2h ago, every 6h)', { every: '6h', when: 'npx x', lastRun: twoHoursAgo })).toBe('Next start in 4h, if there is work')
    expect(said('not due (last start less than a minute ago, every 15m)', { every: '15m', lastRun: { id: 'r', at: new Date().toISOString() } })).toBe('Next start in 15 min')
    expect(said('cap reached (1 in flight: 2026-10-03T10-00-00-000Z on other-box)')).toBe('One is already running')
    expect(said('cap reached (3 in flight: a on x, b on y, c on z)')).toBe('3 are already running')
    // A reason only the tool knows stays in the tool's words.
    expect(said('quota: the week is 90% used')).toBe('Quota: the week is 90% used')
    expect(said('check failed: not found: queue')).toBe('Check failed: not found: queue')
    expect(said('not ready: `claude` is not logged in.')).toBe('Not ready: `claude` is not logged in.')
    // The row says when it last ran: a start is not said twice.
    expect(said('started 2026-10-03T10-00-00-000Z')).toBeUndefined()
    // Switched on a moment ago: the last tick still said off, and no tick has decided yet.
    expect(said('switched off on this machine')).toBeUndefined()
    expect(decided(on)).toBeUndefined()
    // Switched off here, whatever the last tick said: the row says Off itself.
    expect(said('not due', { on: false })).toBeUndefined()
    expect(decided({ ...on, on: false })).toBeUndefined()
    // A row its coding agent cannot run says so whatever its switch, and whatever the last tick said: switching it on would start nothing. Worked out from where its skill is, as the files say it now.
    const noSkill = { ...on, able: ['claude-code'] as const, runsOn: 'codex' as const }
    expect(decided(noSkill)).toBe('Cannot start on Codex: its skill is not in .agents/skills')
    expect(decided({ ...noSkill, on: false, decision: { command: 'a', outcome: 'not due' } })).toBe('Cannot start on Codex: its skill is not in .agents/skills')
    expect(cannotRun(noSkill)).toBe('Cannot start on Codex: its skill is not in .agents/skills')
    // Made for an agent whose folder does not hold its skill, with no pick here.
    expect([cannotRun({ home: 'codex', able: ['claude-code'] }), cannotRun({ home: 'claude-code', able: ['codex'] })]).toEqual(['Cannot start on Codex: its skill is not in .agents/skills', 'Cannot start on Claude Code: its skill is not in .claude/skills'])
    expect([cannotRun(MADE), cannotRun({ ...MADE, runsOn: 'codex' }), cannotRun({ home: 'codex', able: ['claude-code'], runsOn: 'claude-code' })]).toEqual([undefined, undefined, undefined])
    // The tick's own line for it, which "Run now" answers, reads the same; every folder it names is left out.
    const elsewhere = 'not a command of Codex: its skill is only under .claude/skills, not .agents/skills'
    expect(outcomeWords('not a command of Claude Code: its skill is only under .agents/skills and .cursor/skills, not .claude/skills')).toBe('Cannot start on Claude Code: its skill is not in .claude/skills')
    // A command that was due and whose skill is not yet where a run's checkout starts: in the remote's words, saying when origin was not reached, or, with no remote, as not committed. Switched off, nothing.
    const unpublished = "not on origin/main: a run's checkout starts from origin/main, and the command's skill is not there"
    expect(said(unpublished)).toBe('Cannot start yet: its skill is not on origin/main')
    expect(said(unpublished, { on: false })).toBeUndefined()
    expect(said("not on origin/main as this clone last saw it: a run's checkout starts from origin/main, and the command's skill is not there")).toBe('Cannot start yet: its skill is not on origin/main, as this machine last saw it')
    expect(said("not on HEAD: a run's checkout starts from HEAD, and the command's skill is not there")).toBe('Cannot start yet: its skill is not committed')
    // The same words for what "Run now" answered, which is a decision with no row's switch to read.
    expect([outcomeWords('not due'), outcomeWords(unpublished), outcomeWords(elsewhere), outcomeWords('agent-data could not be pulled: offline'), outcomeWords(undefined)]).toEqual(['No work', 'Cannot start yet: its skill is not on origin/main', 'Cannot start on Codex: its skill is not in .agents/skills', 'Agent-data could not be pulled: offline', undefined])
  })

  test('the publish menu: every pick with a git host package, no level, Commit and Publish branch without; the pick in force is listed even when not offered', () => {
    expect(publishChoices(true, 'pr')).toEqual(['nothing', 'commit', 'branch', 'pr', 'merge'])
    expect(publishChoices(false, 'commit')).toEqual(['nothing', 'commit', 'branch'])
    expect(publishChoices(false, 'pr')).toEqual(['nothing', 'commit', 'branch', 'pr'])
  })
})

describe('when a row that is on starts next', () => {
  const now = new Date(2026, 9, 8, 12, 0)
  const ago = (ms: number): { id: string; at: string } => ({ id: 'r', at: new Date(now.getTime() - ms).toISOString() })
  const HOUR = 3_600_000
  const work = { command: 'plan', on: true, publish: 'commit', ...MADE, every: '6h', when: 'npx x', waitsFor: 'when a ticket has no plan' } as const
  const timed = { command: 'report', on: true, publish: 'commit', ...MADE, every: '1d' } as const

  test('a row with a shell line, its wait not over: how long is left, and that it still needs work', () => {
    expect(nextStart({ ...work, lastRun: ago(3 * HOUR) }, now)).toBe('Next start in 3h, if there is work')
    expect(nextStart({ ...work, lastRun: ago(5 * HOUR + 48 * 60_000) }, now)).toBe('Next start in 12 min, if there is work')
    expect(nextStart({ ...work, every: '7d', lastRun: ago(24 * HOUR) }, now)).toBe('Next start in 6 days, if there is work')
  })

  test('a row with a shell line, its wait over or never started: it starts when there is work, which the scheduler asks every minute', () => {
    expect(nextStart({ ...work, lastRun: ago(7 * HOUR) }, now)).toBe('Starts when there is work')
    expect(nextStart(work, now)).toBe('Starts when there is work')
  })

  test('"No wait" picked here, or a skill that names no interval: it starts when there is work, whenever it last started', () => {
    expect(nextStart({ ...work, pace: { work: true }, lastRun: ago(60_000) }, now)).toBe('Starts when there is work')
    const { every: _every, ...unpaced } = work
    expect(nextStart({ ...unpaced, lastRun: ago(60_000) }, now)).toBe('Starts when there is work')
  })

  test('a row that runs by time alone says no "if there is work": the time left, then the scheduler\'s next look', () => {
    expect(nextStart({ ...timed, lastRun: ago(HOUR) }, now)).toBe('Next start in 23h')
    expect(nextStart({ ...timed, lastRun: ago(25 * HOUR) }, now)).toBe("Starts at the scheduler's next look")
    expect(nextStart(timed, now)).toBe("Starts at the scheduler's next look")
  })

  test('a pace set on this machine stands in for the skill\'s; with a time of day the next start is that time, as a day and an hour', () => {
    expect(nextStart({ ...work, pace: { every: '1h', since: '' }, lastRun: ago(3 * HOUR) }, now)).toBe('Starts when there is work')
    const since = new Date(2026, 9, 1, 9, 0).toISOString()
    expect(nextStart({ ...work, pace: { every: '1d', at: '10:00', since }, lastRun: { id: 'r', at: new Date(2026, 9, 8, 10, 5).toISOString() } }, now)).toBe('Next start tomorrow 10:00, if there is work')
    expect(nextStart({ ...timed, pace: { every: '2d', at: '10:00', since }, lastRun: { id: 'r', at: new Date(2026, 9, 8, 10, 5).toISOString() } }, now)).toBe('Next start Saturday 10:00')
  })

  test("the line a row says: what the last look said of its pace or its work is said by the pace as of now; a reason only the tool knows is said in its place", () => {
    const row = { ...work, lastRun: ago(3 * HOUR) }
    const said = (outcome?: string): string => startsNext({ ...row, ...(outcome !== undefined ? { decision: { command: 'plan', outcome } } : {}) }, now)
    expect(said()).toBe('Next start in 3h, if there is work')
    expect(said('not due (last start 3h ago, every 6h)')).toBe('Next start in 3h, if there is work')
    expect(said('not due')).toBe('Next start in 3h, if there is work')
    expect(said('started 2026-10-08T09-00-00-000Z')).toBe('Next start in 3h, if there is work')
    expect(said('cap reached (1 in flight, cap 1)')).toBe('One is already running')
    expect(said('quota: 96% of the week used')).toBe('Quota: 96% of the week used')
    expect(said('check failed: jq: not found')).toBe('Check failed: jq: not found')
    // A row its coding agent cannot run says so whatever the pace says.
    expect(startsNext({ ...row, runsOn: 'codex', able: ['claude-code'] }, now)).toBe('Cannot start on Codex: its skill is not in .agents/skills')
  })

  test('why nothing starts by itself in a project: its scheduler off, or on with no process; nothing while it runs', () => {
    expect(schedulerStopped({ on: true, running: true })).toBeUndefined()
    expect(schedulerStopped({ on: false, running: false })).toBe('The scheduler is off')
    expect(schedulerStopped({ on: true, running: false })).toBe('The scheduler is on, but not running')
  })
})
