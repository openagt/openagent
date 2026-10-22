import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DriverQuota } from '@openagt/agent-driver'
import type { RunCard } from '@openagt/skill-logs'
import type { RunnerMark } from '@openagt/agent-runner'
import { DEFAULT_STATE, type State } from './state.js'
import { parseInterval, type Interval } from './pace.js'
import { FOUND_OPENING, FOUND_OPENING_OWN, RESUMED_OPENING, skillSchedule, type ScheduledCommand } from './schedule.js'
import { glance, runCheck, startNow, tick, type TickDeps } from './tick.js'

// The tick's decisions with every reading injected: what it reads, in which order, and the one
// line each outcome leaves in the state. The wiring to a real project is scheduler.ts's.

const NOW = new Date('2026-09-16T14:01:00.000Z')

/** When this machine switched its commands on: two hours before the tick. */
const ON = '2026-09-16T12:00:00.250Z'

/** A week that resets four days out, with the account's week at `percentUsed`. */
function quota(percentUsed: number): DriverQuota {
  const resets = new Date(NOW.getTime() + 4 * 24 * 60 * 60 * 1000)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][resets.getUTCMonth()]
  return { available: true, windows: [{ label: 'Current week (all models)', kind: 'week', percentUsed, resetsAtText: `${month} ${resets.getUTCDate()} at 7am (UTC)` }] }
}

function running(id: string, command: string, host = 'other-box'): RunCard {
  return { id, startedAt: '2026-09-16T13:00:00.000Z', status: 'running', intent: `/${command}`, caller: { runner: { host } } }
}

/** An interval as a skill writes it: `6h`. */
const every = (text: string): Interval => parseInterval(text)!

/** A scheduled command with a check and a cap of one, its skill in Claude Code's folder alone, unless said otherwise. */
function command(name: string, over: Partial<ScheduledCommand> = { when: 'npx queue' }): ScheduledCommand {
  const dir = over.dir ?? CLAUDE
  return { name, cap: 1, dir, dirs: [dir], ...over }
}

const CLAUDE = '.claude/skills'
const CODEX = '.agents/skills'

/** What the tick lists of a skill in Claude Code's folder alone beside what the skill says: the agent it is made for, and the agents that can run it. */
const ON_CLAUDE = { agent: 'claude-code', able: ['claude-code'] } as const

/** The same for an automation kept on this machine: made for Claude Code, and any agent can run it. */
const ANY_AGENT = { agent: 'claude-code', able: ['claude-code', 'codex'] } as const

interface Seen {
  markers: RunCard[]
  withdrawn: string[]
  spawned: { id: string; prompt: string; startedAt: string; driver: string; model?: string; publish?: string; attached?: string; branch?: string; for?: string; account?: string }[]
  checks: string[]
  /** What each check was given as `$LAST_RUN`, in the order of `checks`. */
  since: string[]
  /** The runs a row resumed: which, what it was told, and the row. */
  resumed: { id: string; text: string; by: string; account?: string }[]
}

/** Every command switched on on this machine, unless the state says otherwise: a command nobody switched on starts nothing. */
function deps(over: Partial<TickDeps> & { stateOver?: Partial<State>; commands?: ScheduledCommand[]; inFlightCards?: RunCard[]; seen?: Seen } = {}): { deps: TickDeps; seen: Seen } {
  const seen: Seen = over.seen ?? { markers: [], withdrawn: [], spawned: [], checks: [], since: [], resumed: [] }
  let ids = 0
  const cards = over.inFlightCards ?? []
  const commands = over.commands ?? [command('work-queue')]
  const d: TickDeps = {
    state: { ...DEFAULT_STATE, on: true, spendOffset: 0, switches: Object.fromEntries(commands.map(c => [c.name, ON])), ...over.stateOver },
    schedule: { commands, unreadable: [] },
    host: 'this-box',
    now: () => NOW,
    pull: async () => ({ ok: true }),
    sweep: async () => {},
    // Every scheduled command's skill is where a run's checkout starts, unless a test says otherwise.
    atStart: async () => ({ ref: 'origin/main', reached: true, there: true }),
    check: async (shell, lastRun) => {
      seen.checks.push(shell)
      seen.since.push(lastRun)
      return { ok: true, stdout: '["one entry"]', stderr: '' }
    },
    // Nobody touches a switch while a tick runs, unless a test says otherwise.
    stillOn: async () => true,
    lastStart: async () => undefined,
    // A run counts for the command its prompt names: a skill's with its slash, an automation's kept on this machine without.
    inFlight: async command => [...cards, ...seen.markers].filter(c => c.status === 'running' && (c.intent === `/${command}` || c.intent === command)),
    ready: async () => ({ problems: [], warnings: [] }),
    quota: async () => quota(10),
    mint: () => `2026-09-16T14-01-00-00${ids++}Z`,
    writeMarker: async card => {
      seen.markers.push(card)
      return { ok: true, changed: true, pushed: true }
    },
    withdrawMarker: async id => {
      seen.markers.splice(seen.markers.findIndex(c => c.id === id), 1)
      seen.withdrawn.push(id)
    },
    spawn: async run => {
      seen.spawned.push(run)
    },
    findRun: async () => undefined,
    busy: async () => false,
    resume: async run => {
      seen.resumed.push(run)
    },
    ...over,
  }
  return { deps: d, seen }
}

test('an interval: never started is due; a start inside the interval is not due, with the age and the interval, and runs no check; a start past it is due', async () => {
  const commands = [command('triage-quick', { every: every('6h') }), command('update-tickets', { every: every('1h'), when: 'gh issue list' })]
  const never = deps({ commands })
  const first = await tick(never.deps)
  assert.deepEqual(first.decisions.map(d => d.outcome.replace(/ 2026.*$/, '')), ['started', 'started'])
  assert.deepEqual(never.seen.checks, ['gh issue list'], 'the interval passed, so the check decided')

  const starts: Record<string, string> = { 'triage-quick': '2026-09-16T11:30:00.000Z', 'update-tickets': '2026-09-16T13:59:30.000Z' }
  const recent = deps({ commands, lastStart: async name => starts[name] })
  const second = await tick(recent.deps)
  assert.deepEqual(second.decisions, [
    { command: 'triage-quick', outcome: 'not due (last start 2h ago, every 6h)' },
    { command: 'update-tickets', outcome: 'not due (last start 1m ago, every 1h)' },
  ])
  assert.deepEqual(recent.seen.checks, [], 'no check runs while the interval holds')
  assert.equal(recent.seen.markers.length, 0)

  const old = deps({ commands, lastStart: async () => '2026-09-15T14:00:00.000Z' })
  const third = await tick(old.deps)
  assert.deepEqual(third.decisions.map(d => d.outcome.replace(/ 2026.*$/, '')), ['started', 'started'])
  assert.deepEqual(old.seen.checks, ['gh issue list'])
})

test("this machine's pace stands in for the skill's: its own interval, or whenever there is work; a pace too large to be one leaves the skill's; the recorded schedule still says the skill's", async () => {
  const commands = [command('update-tickets', { every: every('15m'), when: 'gh issue list' }), command('plan-tickets', { every: every('6h'), when: 'npx tickets list' }), command('triage quick', { every: every('6h') })]
  // All three last started 20 minutes ago.
  const lastStart = async (): Promise<string> => new Date(NOW.getTime() - 20 * 60_000).toISOString()
  const skills = deps({ commands, lastStart })
  assert.deepEqual((await tick(skills.deps)).decisions.map(d => d.outcome.replace(/ 2026.*$/, '')), ['started', 'not due (last start 20m ago, every 6h)', 'not due (last start 20m ago, every 6h)'])

  const since = '2026-09-01T00:00:00.000Z'
  const mine = deps({ commands, lastStart, stateOver: { switches: { 'update-tickets': ON, 'plan-tickets': ON, 'triage quick': ON }, paces: { 'update-tickets': { every: '1h', since }, 'plan-tickets': { work: true }, 'triage quick': { every: '10m', since } } } })
  const record = await tick(mine.deps)
  assert.deepEqual(record.decisions.map(d => d.outcome.replace(/ 2026.*$/, '')), ['not due (last start 20m ago, every 1h)', 'started', 'started'])
  // Slowed down, its check never ran; "whenever there is work" asked the check alone.
  assert.deepEqual(mine.seen.checks, ['npx tickets list'])
  assert.deepEqual(record.schedule.map(row => [row.command, row.every]), [['update-tickets', '15m'], ['plan-tickets', '6h'], ['triage quick', '6h']])

  // A count no date can hold must never read as "due on every tick": it is no pace, and the skill's stands.
  const huge = deps({ commands, lastStart, stateOver: { switches: { 'plan-tickets': ON }, paces: { 'plan-tickets': { every: '100000000d', at: '10:00', since } } } })
  assert.deepEqual((await tick(huge.deps)).decisions.filter(d => d.command === 'plan-tickets'), [{ command: 'plan-tickets', outcome: 'not due (last start 20m ago, every 6h)' }])
})

test('a pace with a time of day: not due before that time, with the time it is due from; due from then on, and a missed time starts once', async () => {
  const commands = [command('post-merge-cleanup', { every: every('1h'), when: 'gh pr list' })]
  // The machine's own local time: the 16th at 09:00, last started on the 14th at 10:02.
  const local = (day: number, hour: number, minute = 0): Date => new Date(2026, 8, day, hour, minute)
  const paces = { 'post-merge-cleanup': { every: '2d', at: '10:00', since: local(1, 8).toISOString() } }
  const early = deps({ commands, now: () => local(16, 9), lastStart: async () => local(14, 10, 2).toISOString(), stateOver: { switches: { 'post-merge-cleanup': ON }, paces } })
  assert.deepEqual((await tick(early.deps)).decisions, [{ command: 'post-merge-cleanup', outcome: 'not due (next start from 2026-09-16 10:00, every 2d at 10:00)' }])
  assert.deepEqual(early.seen.checks, [], 'no check runs before the time')

  const onTime = deps({ commands, now: () => local(16, 10), lastStart: async () => local(14, 10, 2).toISOString(), stateOver: { switches: { 'post-merge-cleanup': ON }, paces } })
  assert.match((await tick(onTime.deps)).decisions[0]!.outcome, /^started /)
  assert.deepEqual(onTime.seen.checks, ['gh pr list'], 'from the time on, the check decides')

  // The scheduler was not running on the 16th at 10:00: on the 17th at 08:00 the missed time is due, once.
  const late = deps({ commands, now: () => local(17, 8), lastStart: async () => local(14, 10, 2).toISOString(), stateOver: { switches: { 'post-merge-cleanup': ON }, paces } })
  assert.match((await tick(late.deps)).decisions[0]!.outcome, /^started /)
  const after = deps({ commands, now: () => local(17, 10, 5), lastStart: async () => local(17, 8).toISOString(), stateOver: { switches: { 'post-merge-cleanup': ON }, paces } })
  assert.deepEqual((await tick(after.deps)).decisions, [{ command: 'post-merge-cleanup', outcome: 'not due (next start from 2026-09-19 10:00, every 2d at 10:00)' }])
})

test('a due command under its cap with quota to spare is marked on the branch, then spawned, and the state says so', async () => {
  const { deps: d, seen } = deps()
  const record = await tick(d)
  assert.deepEqual(record.decisions, [{ command: 'work-queue', outcome: 'started 2026-09-16T14-01-00-000Z', run: '2026-09-16T14-01-00-000Z' }])
  assert.deepEqual(seen.checks, ['npx queue'])
  assert.equal(seen.markers.length, 1)
  const marker = seen.markers[0]!
  assert.equal(marker.status, 'running')
  assert.equal(marker.intent, '/work-queue')
  // On Claude Code, on the scheduler's own model: neither its skill nor a person names another.
  assert.deepEqual([marker.driver, marker.model], ['claude-code', 'opus'])
  // Nobody picked a publish level on this machine: the run commits its work.
  assert.deepEqual(marker.caller, { runner: { host: 'this-box', publish: 'commit' }, host: 'this-box', publish: 'commit' })
  // The run is handed what its check printed; its prompt stays the command alone, as the marker's does.
  assert.deepEqual(seen.spawned, [{ id: marker.id, prompt: '/work-queue', startedAt: NOW.toISOString(), driver: 'claude-code', model: 'opus', publish: 'commit', attached: `${FOUND_OPENING}\n["one entry"]` }])
})

test("a command that would start and whose skill is not where a run's checkout starts is not started, and says where it is missing; it is asked only then, after the check and the cap, before the coding agent and the quota are read", async () => {
  const commands = [command('work-queue'), command('answer-comments', { when: 'gh api comments' }), command('triage quick', { every: every('6h') }), command('watch-competitor', { when: 'curl reddit' }), command('plan-tickets', { every: every('6h') })]
  const asked: string[] = []
  const order: string[] = []
  // On origin's default branch: the work-queue skill and the triage skill. The skills of the two commands a person wrote are in this checkout only.
  const there = new Set(['.claude/skills/work-queue/SKILL.md', '.claude/skills/triage/SKILL.md'])
  const { deps: d, seen } = deps({
    commands,
    atStart: async file => (asked.push(file), order.push('start point'), { ref: 'origin/main', reached: true, there: there.has(file) }),
    ready: async () => (order.push('ready'), { problems: [], warnings: [] }),
    // The last ran an hour ago, so its pace says wait: nothing is asked for it.
    lastStart: async name => (name === 'plan-tickets' ? new Date(NOW.getTime() - 60 * 60_000).toISOString() : undefined),
    stateOver: { switches: { 'work-queue': ON, 'answer-comments': ON, 'triage quick': ON, 'plan-tickets': ON } },
  })
  const record = await tick(d)
  assert.deepEqual(record.decisions.map(d => [d.command, d.outcome.replace(/^started .*/, 'started')]), [
    ['work-queue', 'started'],
    ['answer-comments', "not on origin/main: a run's checkout starts from origin/main, and the command's skill is not there"],
    ['triage quick', 'started'],
    ['watch-competitor', 'switched off on this machine'],
    ['plan-tickets', 'not due (last start 1h ago, every 6h)'],
  ])
  assert.deepEqual(asked, ['.claude/skills/work-queue/SKILL.md', '.claude/skills/answer-comments/SKILL.md', '.claude/skills/triage/SKILL.md'], 'only for a command about to start: the file of its skill, the folder of a command with a word being its first word')
  assert.deepEqual(seen.checks, ['npx queue', 'gh api comments'], 'its check ran first: a command with no work is not asked about')
  assert.equal(order[0], 'start point', 'before the coding agent is probed')
  assert.equal(seen.spawned.length, 2)
  // The cap comes first: a command with a run in flight is not asked about.
  const capped = deps({ commands: [command('answer-comments')], inFlightCards: [running('r1', 'answer-comments')], atStart: async () => assert.fail('asked for a command at its cap') })
  assert.match((await tick(capped.deps)).decisions[0]!.outcome, /^cap reached/)
})

test("a skill that is missing where a run's checkout starts says how the start point was read: origin that could not be reached, a repository with no remote", async () => {
  const offline = deps({ commands: [command('answer-comments')], atStart: async () => ({ ref: 'origin/main', reached: false, there: false }) })
  assert.deepEqual((await tick(offline.deps)).decisions, [{ command: 'answer-comments', outcome: "not on origin/main as this clone last saw it: a run's checkout starts from origin/main, and the command's skill is not there" }])
  const local = deps({ commands: [command('answer-comments')], atStart: async () => ({ ref: 'HEAD', reached: true, there: false }) })
  assert.deepEqual((await tick(local.deps)).decisions, [{ command: 'answer-comments', outcome: "not on HEAD: a run's checkout starts from HEAD, and the command's skill is not there" }])
  // Origin not reached and the skill there as last seen: the run starts, and its own fetch decides.
  const stale = deps({ commands: [command('answer-comments')], atStart: async () => ({ ref: 'origin/main', reached: false, there: true }) })
  assert.match((await tick(stale.deps)).decisions[0]!.outcome, /^started /)
})

test("an automation kept on this machine starts like any command: its run's prompt is its name, and it is handed its text, then what its check printed; no skill folder is asked for, and nothing is asked of where a run's checkout starts; the tick lists it as this machine's", async () => {
  const text = '/answer each new comment below.\n\n- Be short.'
  const own = { dir: '.scheduler/automations', dirs: ['.scheduler/automations'], text, description: 'Answer each new comment below.' }
  const commands = [command('answer-comments', { when: 'gh api comments', ...own, editable: true }), command('daily-notes', { every: every('1d'), ...own }), command('work-queue')]
  const { deps: d, seen } = deps({ commands, atStart: async file => (file === '.claude/skills/work-queue/SKILL.md' ? { ref: 'origin/main', reached: true, there: true } : assert.fail(`asked where ${file} is`)) })
  const record = await tick(d)
  assert.deepEqual(record.decisions.map(d => [d.command, d.outcome.replace(/^started .*/, 'started')]), [['answer-comments', 'started'], ['daily-notes', 'started'], ['work-queue', 'started']])
  assert.deepEqual(seen.spawned.map(s => [s.prompt, s.attached]), [
    ['answer-comments', `${text}\n\n${FOUND_OPENING_OWN}\n["one entry"]`],
    // Started by its pace alone: its text, and nothing of a check.
    ['daily-notes', text],
    ['/work-queue', `${FOUND_OPENING}\n["one entry"]`],
  ])
  assert.equal(seen.markers[0]!.intent, 'answer-comments', 'its record holds its name, which is what its runs are counted by')
  assert.deepEqual(record.schedule, [
    // The one whose file still reads as the tool wrote it is listed as one the tool can save again and remove.
    { command: 'answer-comments', when: 'gh api comments', description: 'Answer each new comment below.', onThisMachine: true, editable: true, ...ANY_AGENT },
    { command: 'daily-notes', every: '1d', description: 'Answer each new comment below.', onThisMachine: true, ...ANY_AGENT },
    { command: 'work-queue', when: 'npx queue', ...ON_CLAUDE },
  ])
  // Its own run in flight counts against its number at once, like a skill's.
  const again = await tick({ ...d, mint: () => '2026-09-16T14-02-00-000Z' })
  assert.match(again.decisions[0]!.outcome, /^cap reached \(1 in flight/)
})

test('an automation kept on this machine that is not listed is named apart from a skill whose schedule cannot be read', async () => {
  const { deps: d } = deps({ commands: [] })
  d.schedule = { commands: [], unreadable: [{ skill: 'triage', reason: 'unknown key evry' }, { skill: 'plan', reason: 'it has no schedule', own: true }] }
  assert.deepEqual((await tick(d)).decisions, [
    { command: 'triage', outcome: 'unreadable schedule: unknown key evry' },
    { command: 'plan', outcome: 'unlisted automation: it has no schedule' },
  ])
})

test('a check is given the time its command last started, to the whole second, or the time it was switched on on this machine when that is later or it never started', async () => {
  const commands = [command('answer-comments', { when: 'gh api comments' }), command('watch-competitor', { when: 'curl reddit' }), command('update-tickets', { when: 'npx tickets meta', every: every('15m') })]
  // The third last started a week before this machine switched it on: off means off, so it asks from the switch.
  const started: Record<string, string> = { 'answer-comments': '2026-09-16T13:40:07.912Z', 'update-tickets': '2026-09-09T13:30:00.000Z' }
  const { deps: d, seen } = deps({ commands, lastStart: async name => started[name] })
  await tick(d)
  assert.deepEqual(seen.checks.map((shell, i) => [shell, seen.since[i]]), [
    ['gh api comments', '2026-09-16T13:40:07Z'],
    // Never started: what is new since a person switched it on, not since the beginning of time.
    ['curl reddit', '2026-09-16T12:00:00Z'],
    ['npx tickets meta', '2026-09-16T12:00:00Z'],
  ])
})

test("a run's start is the moment its command was asked about, before its check ran, on its marker and for its process alike: the next check's last start is that moment, not the seconds later the run began", async () => {
  // A clock that moves a second each time it is read: the check and the readings after it take time.
  let reads = 0
  const now = (): Date => new Date(NOW.getTime() + 1000 * reads++)
  const { deps: d, seen } = deps({ commands: [command('answer-comments', { when: 'gh api comments' })], now })
  let checkedAt = ''
  d.check = async () => ((checkedAt = now().toISOString()), { ok: true, stdout: '[1]', stderr: '' })
  const record = await tick(d)
  const started = seen.spawned[0]!.startedAt
  assert.ok(started < checkedAt, `the start ${started} is before the check ran at ${checkedAt}`)
  assert.ok(record.at <= started, 'and not before the tick began')
  assert.equal(seen.markers[0]!.startedAt, started, 'the marker names the same start')
})

test('a run handed a cut output is told the time its check was given, so its agent can ask again for what was cut', async () => {
  const { deps: d, seen } = deps({ commands: [command('answer-comments', { when: 'gh api comments' })], check: async () => ({ ok: true, stdout: 'x'.repeat(9000), stderr: '' }), lastStart: async () => '2026-09-16T13:40:07.912Z' })
  await tick(d)
  assert.match(seen.spawned[0]!.attached!, /; it asked what is new since 2026-09-16T13:40:07Z\)$/)
})

test('a check reads the time it is given as $LAST_RUN, run through the shell at the repository root', async () => {
  const printed = await runCheck(process.cwd(), 'printf "%s|%s|%s" "$LAST_RUN" "$(basename "$PWD")" "$HOME"', 10_000, '2026-10-09T10:00:00Z')
  // The rest of the environment comes along: a check needs its PATH, its HOME and its logins.
  assert.deepEqual(printed, { ok: true, stdout: `2026-10-09T10:00:00Z|${process.cwd().split('/').at(-1)}|${process.env['HOME']}`, stderr: '' })
  // One that runs out of its time says so, whatever it had printed; one that fails says its own error.
  assert.deepEqual(await runCheck(process.cwd(), 'echo half; echo oops >&2; sleep 5', 300, 'x'), { ok: false, stdout: 'half\n', stderr: 'it took longer than 0.3 seconds' })
  assert.deepEqual(await runCheck(process.cwd(), 'echo oops >&2; exit 3', 10_000, 'x'), { ok: false, stdout: '', stderr: 'oops\n' })
})

test('a run is handed what its check printed, and only a run a check started: a command its pace alone starts is handed nothing', async () => {
  const commands = [command('answer-comments', { when: 'gh api comments' }), command('plan-tickets', { every: every('6h') }), command('update-tickets', { when: 'npx tickets meta', every: every('15m') })]
  const printed: Record<string, string> = { 'gh api comments': '\n[{"url":"https://example.test/1","by":"someone"}]\n', 'npx tickets meta': 'first import' }
  const { deps: d, seen } = deps({ commands, check: async shell => ({ ok: true, stdout: printed[shell]!, stderr: '' }) })
  await tick(d)
  assert.deepEqual(seen.spawned.map(s => [s.prompt, s.attached]), [
    ['/answer-comments', `${FOUND_OPENING}\n[{"url":"https://example.test/1","by":"someone"}]`],
    ['/plan-tickets', undefined],
    ['/update-tickets', `${FOUND_OPENING}\nfirst import`],
  ])
})

test("this machine's publish pick goes on the marker and to the spawned run: commit where nobody picked, no level for nothing; the recorded schedule says what the skills say, with what each skill says it does", async () => {
  const commands = [command('work-queue', { when: 'npx queue', waitsFor: 'when the queue holds a task', description: 'Work one queued task.' }), command('triage quick', { every: every('6h') }), command('plan-tickets', { every: every('6h') })]
  const { deps: d, seen } = deps({ commands, stateOver: { switches: { 'work-queue': ON, 'triage quick': ON, 'plan-tickets': ON }, publishes: { 'work-queue': 'nothing', 'triage quick': 'merge' } } })
  const record = await tick(d)
  assert.deepEqual(seen.markers.map(m => m.caller), [
    { runner: { host: 'this-box' }, host: 'this-box' },
    { runner: { host: 'this-box', publish: 'merge' }, host: 'this-box', publish: 'merge' },
    { runner: { host: 'this-box', publish: 'commit' }, host: 'this-box', publish: 'commit' },
  ])
  assert.deepEqual(seen.spawned.map(s => [s.prompt, s.publish]), [['/work-queue', undefined], ['/triage quick', 'merge'], ['/plan-tickets', 'commit']])
  assert.deepEqual(record.schedule, [
    { command: 'work-queue', when: 'npx queue', waitsFor: 'when the queue holds a task', description: 'Work one queued task.', ...ON_CLAUDE },
    { command: 'triage quick', every: '6h', ...ON_CLAUDE },
    { command: 'plan-tickets', every: '6h', ...ON_CLAUDE },
  ])
})

test('a command with a word after its folder name: the whole name is what the switch, the interval, the marker and the decision carry, and the prompt is the name with a slash', async () => {
  const commands = [command('triage quick', { every: every('6h') }), command('triage consensual', { every: every('7d') })]
  const started: Record<string, string> = { 'triage consensual': '2026-09-15T14:00:00.000Z' }
  const { deps: d, seen } = deps({ commands, lastStart: async name => started[name], stateOver: { switches: { 'triage quick': ON } } })
  const record = await tick(d)
  assert.deepEqual(record.decisions, [
    { command: 'triage quick', outcome: 'started 2026-09-16T14-01-00-000Z', run: '2026-09-16T14-01-00-000Z' },
    { command: 'triage consensual', outcome: 'switched off on this machine' },
  ])
  assert.equal(seen.markers[0]!.intent, '/triage quick')
  assert.deepEqual(seen.spawned, [{ id: '2026-09-16T14-01-00-000Z', prompt: '/triage quick', startedAt: NOW.toISOString(), driver: 'claude-code', model: 'opus', publish: 'commit' }])
  assert.deepEqual(record.schedule, [
    { command: 'triage quick', every: '6h', ...ON_CLAUDE },
    { command: 'triage consensual', every: '7d', ...ON_CLAUDE },
  ])

  // The interval is the whole name's: the consensual start is not the quick one's.
  const paced = deps({ commands, lastStart: async name => started[name] })
  const second = await tick(paced.deps)
  assert.deepEqual(second.decisions.map(dec => dec.outcome.replace(/ 2026.*$/, '')), ['started', 'not due (last start 1d ago, every 7d)'])
})

test('off: the pull and the sweep still run, nothing is decided', async () => {
  let swept = false
  const { deps: d, seen } = deps({ stateOver: { on: false }, sweep: async () => { swept = true } })
  const record = await tick(d)
  assert.equal(record.note, 'off')
  assert.equal(swept, true)
  assert.deepEqual(record.decisions, [])
  assert.deepEqual(seen.checks, [])
})

test('every command starts switched off: it is not started, and says so, until a person switches it on on this machine', async () => {
  const commands = [command('work-queue'), command('post-merge-cleanup', { every: every('1d') })]
  const nobody = deps({ commands, stateOver: { switches: {} } })
  const record = await tick(nobody.deps)
  assert.deepEqual(record.decisions, [
    { command: 'work-queue', outcome: 'switched off on this machine' },
    { command: 'post-merge-cleanup', outcome: 'switched off on this machine' },
  ])
  // Switched off, its check never ran.
  assert.deepEqual(nobody.seen.checks, [])
  // The tick lists what the skills say, whatever this machine switched.
  assert.deepEqual(record.schedule, [
    { command: 'work-queue', when: 'npx queue', ...ON_CLAUDE },
    { command: 'post-merge-cleanup', every: '1d', ...ON_CLAUDE },
  ])

  const switched = deps({ commands, stateOver: { switches: { 'post-merge-cleanup': ON } } })
  const after = await tick(switched.deps)
  assert.deepEqual(after.decisions.map(d => [d.command, d.outcome.split(' ')[0]]), [['work-queue', 'switched'], ['post-merge-cleanup', 'started']])
  assert.deepEqual(switched.seen.checks, [])

  // A state edited by hand: anything but a time is off.
  const edited = deps({ commands, stateOver: { switches: { 'work-queue': 'yes' as never } } })
  assert.equal((await tick(edited.deps)).decisions[0]!.outcome, 'switched off on this machine')
})

test('a pull that fails ends the tick with the reason: a stale branch must not start anything', async () => {
  const { deps: d, seen } = deps({ pull: async () => ({ ok: false, error: 'origin is unreachable' }) })
  const record = await tick(d)
  assert.equal(record.note, 'agent-data could not be pulled: origin is unreachable')
  assert.deepEqual(seen.spawned, [])
})

test('no skill schedules a command: no decisions, and the note says so', async () => {
  const { deps: d } = deps({ commands: [] })
  const record = await tick(d)
  assert.equal(record.note, 'no skill of this project schedules a command')
  assert.deepEqual(record.schedule, [])
})

test('the checks in order: not a command of its coding agent, check failed, not due, cap reached, quota', async () => {
  // Its skill is only in the folder another coding agent reads, and a person picked Claude Code for it here: Claude Code would be handed a command it finds no skill for.
  const picked = { switches: { 'work-queue': ON }, runsOn: { 'work-queue': 'claude-code' as const } }
  const elsewhere = deps({ commands: [command('work-queue', { when: 'npx queue', dir: CODEX })], stateOver: picked })
  assert.deepEqual((await tick(elsewhere.deps)).decisions, [{ command: 'work-queue', outcome: 'not a command of Claude Code: its skill is only under .agents/skills, not .claude/skills' }])
  assert.deepEqual(elsewhere.seen.checks, [], 'a command that cannot run is not checked')
  assert.deepEqual(elsewhere.seen.spawned, [])
  // Said before the switch: a person reads why switching it on would start nothing.
  const unswitched = deps({ commands: elsewhere.deps.schedule.commands, stateOver: { ...picked, switches: {} } })
  assert.match((await tick(unswitched.deps)).decisions[0]!.outcome, /^not a command of Claude Code/)
  // The other way round, by what its skill says: made for Codex, and only in Claude Code's folder. Every folder that holds it is named.
  const forCodex = deps({ commands: [command('work-queue', { when: 'npx queue', agent: 'codex' }), command('review', { when: 'x', agent: 'codex', dirs: [CLAUDE, '.cursor/skills'] })] })
  assert.deepEqual((await tick(forCodex.deps)).decisions.map(d => d.outcome), ['not a command of Codex: its skill is only under .claude/skills, not .agents/skills', 'not a command of Codex: its skill is only under .claude/skills and .cursor/skills, not .agents/skills'])

  const failed = deps({ check: async () => ({ ok: false, stdout: '', stderr: 'npm ERR! missing script\nnot found: queue' }) })
  assert.deepEqual((await tick(failed.deps)).decisions, [{ command: 'work-queue', outcome: 'check failed: not found: queue' }])

  const notDue = deps({ check: async () => ({ ok: true, stdout: '[]\n', stderr: '' }) })
  assert.deepEqual((await tick(notDue.deps)).decisions, [{ command: 'work-queue', outcome: 'not due' }])

  const capped = deps({ inFlightCards: [running('2026-09-16T13-00-00-000Z', 'work-queue')] })
  let quotaRead = false
  capped.deps.quota = async () => { quotaRead = true; return quota(10) }
  assert.deepEqual((await tick(capped.deps)).decisions, [{ command: 'work-queue', outcome: 'cap reached (1 in flight: 2026-09-16T13-00-00-000Z on other-box)' }])
  assert.equal(quotaRead, false, 'the quota is read only when everything else says start')
  assert.deepEqual(capped.seen.markers, [])

  const spent = deps({ quota: async () => quota(90) })
  const decisions = (await tick(spent.deps)).decisions
  assert.equal(decisions.length, 1)
  assert.match(decisions[0]!.outcome, /^quota: Current week \(all models\) is 90% used, at or past day 4 of the week's \d+%$/)
  assert.deepEqual(spent.seen.spawned, [])
})

test('a coding agent that cannot start starts nothing: said once per tick, before the quota is read, and nothing is marked', async () => {
  let reads = 0
  let quotaRead = false
  const { deps: d, seen } = deps({
    commands: [command('a', { when: 'x' }), command('b', { when: 'y' })],
    ready: async () => { reads++; return { problems: ['`claude` is not logged in. Run `claude auth login`, then start again.'], warnings: [] } },
    quota: async () => { quotaRead = true; return quota(10) },
  })
  assert.deepEqual((await tick(d)).decisions, [
    { command: 'a', outcome: 'not ready: `claude` is not logged in. Run `claude auth login`, then start again.' },
    { command: 'b', outcome: 'not ready: `claude` is not logged in. Run `claude auth login`, then start again.' },
  ])
  assert.equal(reads, 1)
  assert.equal(quotaRead, false)
  assert.deepEqual(seen.markers, [])

  const capped = deps({ inFlightCards: [running('2026-09-16T13-00-00-000Z', 'work-queue')], ready: async () => { reads++; return { problems: [], warnings: [] } } })
  await tick(capped.deps)
  assert.equal(reads, 1, 'the agent is asked only when everything cheaper says start')
})

test("an unreadable quota stands the tick down: not knowing is not 'nothing used'", async () => {
  const { deps: d } = deps({ quota: async () => ({ available: false, reason: 'timeout' }) })
  assert.deepEqual((await tick(d)).decisions, [{ command: 'work-queue', outcome: 'quota: the quota could not be read, so there is no way to tell what is spare' }])
})

test("a marker that lands past the cap is withdrawn: the first `cap` ids in time order are the runs", async () => {
  // Another machine's marker landed between this tick's count and its write, with an earlier id.
  const cards: RunCard[] = []
  const { deps: d, seen } = deps({ inFlightCards: cards })
  const write = d.writeMarker
  d.writeMarker = async card => {
    cards.push(running('2026-09-16T14-00-59-000Z', 'work-queue'))
    return write(card)
  }
  const record = await tick(d)
  assert.deepEqual(seen.withdrawn, ['2026-09-16T14-01-00-000Z'])
  assert.deepEqual(seen.spawned, [])
  assert.deepEqual(record.decisions, [{ command: 'work-queue', outcome: 'cap reached (1 in flight: 2026-09-16T14-00-59-000Z on other-box)' }])
})

test('with a cap of two, the marker within the cap keeps its place even when a later one lands too', async () => {
  const cards: RunCard[] = []
  const { deps: d, seen } = deps({ commands: [command('work-queue', { when: 'npx queue', cap: 2 })], inFlightCards: cards })
  const write = d.writeMarker
  d.writeMarker = async card => {
    cards.push(running('2026-09-16T14-01-30-000Z', 'work-queue'))
    return write(card)
  }
  await tick(d)
  assert.deepEqual(seen.withdrawn, [])
  assert.equal(seen.spawned.length, 1)
})

test("this machine's number of agents at once stands in for the skill's, against every machine's runs: a second one starts under a number of two, none under a number of one where the skill allows two; a marker is ranked by this machine's number", async () => {
  const one = running('2026-09-16T13-00-00-000Z', 'work-queue')
  // The skill says one at a time; this machine's person says two: with one in flight on another machine, a second starts here.
  const more = deps({ inFlightCards: [one], stateOver: { switches: { 'work-queue': ON }, agents: { 'work-queue': 2 } } })
  assert.match((await tick(more.deps)).decisions[0]!.outcome, /^started /)
  assert.equal(more.seen.spawned.length, 1)
  // Two in flight: this machine's number is reached.
  const full = deps({ inFlightCards: [one, running('2026-09-16T13-30-00-000Z', 'work-queue', 'third-box')], stateOver: { switches: { 'work-queue': ON }, agents: { 'work-queue': 2 } } })
  assert.deepEqual((await tick(full.deps)).decisions, [{ command: 'work-queue', outcome: 'cap reached (2 in flight: 2026-09-16T13-00-00-000Z on other-box, 2026-09-16T13-30-00-000Z on third-box)' }])

  // The skill allows two; this machine's person says one: with one in flight anywhere, nothing starts here.
  const fewer = deps({ commands: [command('work-queue', { when: 'npx queue', cap: 2 })], inFlightCards: [one], stateOver: { switches: { 'work-queue': ON }, agents: { 'work-queue': 1 } } })
  assert.match((await tick(fewer.deps)).decisions[0]!.outcome, /^cap reached \(1 in flight/)
  assert.deepEqual(fewer.seen.markers, [])
  // The recorded schedule says the skill's number, and only when it is more than one.
  assert.deepEqual((await tick(fewer.deps)).schedule, [{ command: 'work-queue', when: 'npx queue', agents: 2, ...ON_CLAUDE }])
  assert.deepEqual((await tick(more.deps)).schedule, [{ command: 'work-queue', when: 'npx queue', ...ON_CLAUDE }])

  // Another machine's marker lands first: under this machine's number of two its own marker ranks second and stays.
  const cards: RunCard[] = []
  const raced = deps({ inFlightCards: cards, stateOver: { switches: { 'work-queue': ON }, agents: { 'work-queue': 2 } } })
  const write = raced.deps.writeMarker
  raced.deps.writeMarker = async card => {
    cards.push(running('2026-09-16T14-00-59-000Z', 'work-queue'))
    return write(card)
  }
  await tick(raced.deps)
  assert.deepEqual(raced.seen.withdrawn, [])
  assert.equal(raced.seen.spawned.length, 1)

  // The other way: the skill allows two, this machine's person says one, and another machine's marker lands first: this machine's is withdrawn.
  const fewerCards: RunCard[] = []
  const lost = deps({ commands: [command('work-queue', { when: 'npx queue', cap: 2 })], inFlightCards: fewerCards, stateOver: { switches: { 'work-queue': ON }, agents: { 'work-queue': 1 } } })
  const writeLost = lost.deps.writeMarker
  lost.deps.writeMarker = async card => {
    fewerCards.push(running('2026-09-16T14-00-59-000Z', 'work-queue'))
    return writeLost(card)
  }
  const record = await tick(lost.deps)
  assert.deepEqual(lost.seen.withdrawn, ['2026-09-16T14-01-00-000Z'])
  assert.deepEqual(lost.seen.spawned, [])
  assert.match(record.decisions[0]!.outcome, /^cap reached \(1 in flight/)
})

test('a marker whose push failed twice is withdrawn and nothing is spawned', async () => {
  const { deps: d, seen } = deps({ writeMarker: async () => ({ ok: false, committed: true, error: 'the agent-data branch could not be pushed: rejected' }) })
  const record = await tick(d)
  assert.deepEqual(record.decisions, [{ command: 'work-queue', outcome: 'another machine got there first: the agent-data branch could not be pushed: rejected' }])
  assert.deepEqual(seen.withdrawn, ['2026-09-16T14-01-00-000Z'])
  assert.deepEqual(seen.spawned, [])
})

test("a skill's unreadable schedule is named in the state and the readable commands still run", async () => {
  const { deps: d, seen } = deps()
  d.schedule = { commands: d.schedule.commands, unreadable: [{ skill: 'triage', reason: 'row 2: unknown key evry' }] }
  const record = await tick(d)
  assert.deepEqual(record.decisions.map(x => [x.command, x.outcome.replace(/ 2026.*$/, '')]), [['triage', 'unreadable schedule: row 2: unknown key evry'], ['work-queue', 'started']])
  assert.equal(seen.spawned.length, 1)

  // Nothing readable at all: the unreadable one is still named, not hidden behind "no skill schedules a command".
  const only = deps({ commands: [] })
  only.deps.schedule = { commands: [], unreadable: [{ skill: 'triage', reason: 'the front matter is not YAML' }] }
  const alone = await tick(only.deps)
  assert.equal(alone.note, undefined)
  assert.deepEqual(alone.decisions, [{ command: 'triage', outcome: 'unreadable schedule: the front matter is not YAML' }])

  // With the scheduler off, or the branch not pulled, it is named all the same: nothing else says why the commands are missing.
  const off = deps({ stateOver: { on: false } })
  off.deps.schedule = only.deps.schedule
  const idle = await tick(off.deps)
  assert.equal(idle.note, 'off')
  assert.deepEqual(idle.decisions, alone.decisions)
  const stale = deps({ pull: async () => ({ ok: false, error: 'origin is unreachable' }) })
  stale.deps.schedule = only.deps.schedule
  assert.deepEqual((await tick(stale.deps)).decisions, alone.decisions)
})

test("a row on Codex, by this machine's pick or because its skill says so: its run is on Codex with no model named, its skill is asked for in Codex's own folder, Codex is asked whether it can start, and Claude's quota is never read", async () => {
  const both = [CLAUDE, CODEX]
  const commands = [command('update-tickets', { when: 'gh issue list', dirs: both }), command('review', { every: every('1d'), dirs: both, agent: 'codex' }), command('work-queue', { dirs: both })]
  const asked: string[] = []
  const probed: string[] = []
  let quotaReads = 0
  const { deps: d, seen } = deps({
    commands,
    stateOver: { switches: { 'update-tickets': ON, review: ON }, runsOn: { 'update-tickets': 'codex' } },
    atStart: async file => (asked.push(file), { ref: 'origin/main', reached: true, there: true }),
    ready: async agent => (probed.push(agent), { problems: [], warnings: [] }),
    // No quota left at all: a run on Claude Code would stand down.
    quota: async () => (quotaReads++, quota(100)),
  })
  const record = await tick(d)
  assert.deepEqual(record.decisions.map(x => x.outcome.replace(/^started .*/, 'started')), ['started', 'started', 'switched off on this machine'])
  assert.deepEqual(seen.spawned.map(({ prompt, driver, model }) => [prompt, driver, model]), [['/update-tickets', 'codex', undefined], ['/review', 'codex', undefined]])
  // No model is named to Codex: the scheduler's own is a Claude model, and Codex starts on its own default.
  assert.deepEqual(seen.spawned.map(run => 'model' in run), [false, false])
  assert.deepEqual(seen.markers.map(m => [m.driver, 'model' in m]), [['codex', false], ['codex', false]])
  assert.deepEqual(asked, ['.agents/skills/update-tickets/SKILL.md', '.agents/skills/review/SKILL.md'])
  assert.deepEqual(probed, ['codex'], 'each agent is asked once per tick, and only the ones a run would be on')
  assert.equal(quotaReads, 0)
  // What the skills say is listed, not this machine's picks: the agent each is made for, its model when it names one, and who can run it.
  assert.deepEqual(record.schedule.map(c => [c.command, c.agent, c.model, c.able]), [['update-tickets', 'claude-code', undefined, ['claude-code', 'codex']], ['review', 'codex', undefined, ['claude-code', 'codex']], ['work-queue', 'claude-code', undefined, ['claude-code', 'codex']]])

  // A model for Codex, named by the skill or picked here, goes with the run.
  const named = deps({ commands: [command('review', { every: every('1d'), dirs: both, agent: 'codex', model: 'gpt-5.5' }), command('audit', { every: every('1d'), dirs: both, agent: 'codex', model: 'gpt-5.5' })], stateOver: { switches: { review: ON, audit: ON }, models: { audit: { agent: 'codex', model: 'gpt-5.6-luna' } } } })
  await tick(named.deps)
  assert.deepEqual(named.seen.spawned.map(({ driver, model }) => [driver, model]), [['codex', 'gpt-5.5'], ['codex', 'gpt-5.6-luna']])
  assert.deepEqual(named.seen.markers.map(m => [m.driver, m.model]), [['codex', 'gpt-5.5'], ['codex', 'gpt-5.6-luna']])
})

test("a skill that is only in Codex's folder runs on Codex where nobody says otherwise; one Codex cannot start on says so like any agent, and a row on Claude Code beside it still starts", async () => {
  const commands = [command('codex-only', { when: 'x', dir: CODEX }), command('work-queue')]
  const { deps: d, seen } = deps({ commands })
  await tick(d)
  assert.deepEqual(seen.spawned.map(({ prompt, driver, model }) => [prompt, driver, model]), [['/codex-only', 'codex', undefined], ['/work-queue', 'claude-code', 'opus']])
  assert.deepEqual((await tick(d)).schedule.map(c => [c.command, c.agent, c.able]), [['codex-only', 'codex', ['codex']], ['work-queue', 'claude-code', ['claude-code']]])

  const probed: string[] = []
  const loggedOut = deps({ commands: [...commands, command('review', { when: 'y', dir: CODEX })], ready: async agent => (probed.push(agent), { problems: agent === 'codex' ? ['`codex` is not logged in.'] : [], warnings: [] }) })
  assert.deepEqual((await tick(loggedOut.deps)).decisions.map(x => x.outcome.replace(/^started .*/, 'started')), ['not ready: `codex` is not logged in.', 'started', 'not ready: `codex` is not logged in.'])
  assert.deepEqual(probed, ['codex', 'claude-code'], 'each agent once, however many of its rows would start')
})

test("the model a run on Claude Code starts on: this machine's pick, else the one its skill names, else the scheduler's own; a skill's model is for the agent the skill is made for, and for no other", async () => {
  const both = [CLAUDE, CODEX]
  const commands = [
    command('update-tickets', { when: 'a', model: 'haiku' }),
    command('plan-tickets', { when: 'b', model: 'haiku' }),
    command('work-queue', { when: 'c' }),
    // Made for Codex with a Codex model, and switched to Claude Code here: the skill's model is not Claude's.
    command('review', { when: 'd', dirs: both, agent: 'codex', model: 'gpt-5.5' }),
    // Made for Claude Code with a Claude model, and switched to Codex here: no model is named to Codex.
    command('audit', { when: 'e', dirs: both, model: 'haiku' }),
  ]
  const { deps: d, seen } = deps({ commands, stateOver: { model: 'sonnet', switches: Object.fromEntries(commands.map(c => [c.name, ON])), models: { 'plan-tickets': { agent: 'claude-code', model: 'opus' } }, runsOn: { review: 'claude-code', audit: 'codex' } } })
  const record = await tick(d)
  assert.deepEqual(seen.spawned.map(({ prompt, driver, model }) => [prompt, driver, model]), [
    ['/update-tickets', 'claude-code', 'haiku'],
    ['/plan-tickets', 'claude-code', 'opus'],
    ['/work-queue', 'claude-code', 'sonnet'],
    ['/review', 'claude-code', 'sonnet'],
    ['/audit', 'codex', undefined],
  ])
  assert.deepEqual(seen.markers.map(m => m.model), ['haiku', 'opus', 'sonnet', 'sonnet', undefined])
  assert.deepEqual(record.schedule.map(c => [c.command, c.model]), [['update-tickets', 'haiku'], ['plan-tickets', 'haiku'], ['work-queue', undefined], ['review', 'gpt-5.5'], ['audit', 'haiku']])
})

test('a model picked while a command ran on another agent is not sent to the agent it runs on now: a skill that reached Claude Code\'s folder since starts on the scheduler\'s model, and one that came to name Codex on Codex\'s own', async () => {
  const both = ['.claude/skills', '.agents/skills']
  // Picked for Codex when the skill was only in Codex's folder; picked for Claude Code before the skill named Codex.
  const commands = [command('review', { every: every('1d'), dirs: both }), command('audit', { every: every('1d'), dirs: both, agent: 'codex' })]
  const { deps: d, seen } = deps({ commands, stateOver: { model: 'sonnet', switches: { review: ON, audit: ON }, models: { review: { agent: 'codex', model: 'gpt-5.5' }, audit: { agent: 'claude-code', model: 'opus' } } } })
  await tick(d)
  assert.deepEqual(seen.spawned.map(run => [run.prompt, run.driver, run.model]), [['/review', 'claude-code', 'sonnet'], ['/audit', 'codex', undefined]])
  assert.deepEqual(seen.markers.map(card => [card.driver, card.model]), [['claude-code', 'sonnet'], ['codex', undefined]])
})

test("Claude's quota is read once per tick however many models its rows start on, and each row is held by its own model's week beside the account's", async () => {
  let reads = 0
  const week = quota(10)
  const withSonnet: DriverQuota = { available: true, windows: [...(week.available ? week.windows : []), { label: 'Current week (Sonnet)', kind: 'week-model', percentUsed: 99 }] }
  const commands = [command('a', { when: 'x', model: 'opus' }), command('b', { when: 'y', model: 'sonnet' }), command('c', { when: 'z', model: 'haiku' })]
  const { deps: d, seen } = deps({ commands, quota: async () => (reads++, withSonnet) })
  const record = await tick(d)
  assert.deepEqual(record.decisions.map(x => x.outcome.replace(/^started .*/, 'started').replace(/^(quota: Current week \(Sonnet\) is 99% used).*/, '$1')), ['started', 'quota: Current week (Sonnet) is 99% used', 'started'])
  assert.deepEqual(seen.spawned.map(run => run.model), ['opus', 'haiku'])
  assert.equal(reads, 1)
})

test('the quota is read once per tick, however many commands start', async () => {
  let reads = 0
  const { deps: d, seen } = deps({ commands: [command('a', { when: 'x' }), command('b', { when: 'y' })], quota: async () => { reads++; return quota(1) } })
  await tick(d)
  assert.equal(seen.spawned.length, 2)
  assert.equal(reads, 1)
})

test('the schedule is listed as the skills say it, switched on or off, with the scheduler off and when the pull failed; nothing is swept then', async () => {
  const commands = [command('work-queue'), command('update-tickets', { when: 'gh issue list' })]
  const said = [{ command: 'work-queue', when: 'npx queue', ...ON_CLAUDE }, { command: 'update-tickets', when: 'gh issue list', ...ON_CLAUDE }]
  const off = deps({ commands, stateOver: { switches: {} } })
  assert.deepEqual((await tick(off.deps)).schedule, said)
  const stopped = await tick({ ...off.deps, state: { ...off.deps.state, on: false } })
  assert.deepEqual([stopped.note, stopped.schedule], ['off', said])
  const order: string[] = []
  const stale = deps({ commands, pull: async () => ({ ok: false, error: 'offline' }), sweep: async () => void order.push('sweep') })
  const unpulled = await tick(stale.deps)
  assert.deepEqual([unpulled.note, unpulled.schedule, order], ['agent-data could not be pulled: offline', said, []])
  // A command the tick starts is listed as before: its runs are the records' to say.
  const started = await tick(deps({ commands }).deps)
  assert.deepEqual(started.schedule, said)
})

test('a run asked for by hand starts whatever the switch, the pace and the quota: the check still decides, and the run is handed what it printed', async () => {
  const paced = command('update-tickets', { every: every('1h'), when: 'gh issue list' })
  // Switched off, started a minute ago, and no quota left: a tick would start nothing.
  const over = { commands: [paced], stateOver: { switches: {} }, lastStart: async () => '2026-09-16T13:59:00.000Z', quota: async () => quota(100), stillOn: async () => false, stopped: () => true }
  const asked = deps(over)
  const started = await startNow(asked.deps, paced)
  assert.deepEqual(started, { ok: true, run: { id: asked.seen.spawned[0]!.id, at: NOW.toISOString() } })
  assert.deepEqual(asked.seen.checks, ['gh issue list'])
  // What is new for the check: since the command last started.
  assert.deepEqual(asked.seen.since, ['2026-09-16T13:59:00Z'])
  assert.match(asked.seen.spawned[0]!.attached ?? '', /one entry/)
  assert.equal(asked.seen.markers.length, 1)

  // A check that finds nothing starts nothing, in the tick's own words.
  const quiet = deps({ ...over, check: async () => ({ ok: true, stdout: '[]', stderr: '' }) })
  assert.deepEqual(await startNow(quiet.deps, paced), { ok: false, outcome: 'not due' })
  assert.equal(quiet.seen.markers.length, 0)
  const broken = deps({ ...over, check: async () => ({ ok: false, stdout: '', stderr: 'gh: not found' }) })
  assert.deepEqual(await startNow(broken.deps, paced), { ok: false, outcome: 'check failed: gh: not found' })

  // Never started and switched off: the check asks what is new since a day ago. Switched on later than the last start: since then.
  const never = deps({ ...over, lastStart: async () => undefined })
  await startNow(never.deps, paced)
  assert.deepEqual(never.seen.since, ['2026-09-15T14:01:00Z'])
  const switched = deps({ ...over, stateOver: { switches: { 'update-tickets': '2026-09-16T13:59:30.000Z' } } })
  await startNow(switched.deps, paced)
  assert.deepEqual(switched.seen.since, ['2026-09-16T13:59:30Z'])
})

test('a run asked for by hand is held by what holds a tick apart from the switch, the pace and the quota: the cap, where a checkout starts, the coding agent, the pull, the skill folder; nothing is swept', async () => {
  const queue = command('work-queue')
  const off = { stateOver: { switches: {} } }
  const full = deps({ ...off, inFlightCards: [running('r1', 'work-queue')] })
  assert.deepEqual(await startNow(full.deps, queue), { ok: false, outcome: 'cap reached (1 in flight: r1 on other-box)' })
  const unpublished = deps({ ...off, atStart: async () => ({ ref: 'origin/main', reached: true, there: false }) })
  assert.deepEqual(await startNow(unpublished.deps, queue), { ok: false, outcome: "not on origin/main: a run's checkout starts from origin/main, and the command's skill is not there" })
  const loggedOut = deps({ ...off, ready: async () => ({ problems: ['Claude Code is not logged in.'], warnings: [] }) })
  assert.deepEqual(await startNow(loggedOut.deps, queue), { ok: false, outcome: 'not ready: Claude Code is not logged in.' })
  const swept: string[] = []
  const offline = deps({ ...off, pull: async () => ({ ok: false, error: 'offline' }), sweep: async () => void swept.push('sweep') })
  assert.deepEqual(await startNow(offline.deps, queue), { ok: false, outcome: 'agent-data could not be pulled: offline' })
  assert.deepEqual(offline.seen.checks, [])
  const elsewhere = command('codex-only', { dir: CODEX })
  assert.deepEqual(await startNow(deps({ stateOver: { switches: {}, runsOn: { 'codex-only': 'claude-code' } } }).deps, elsewhere), { ok: false, outcome: 'not a command of Claude Code: its skill is only under .agents/skills, not .claude/skills' })
  const fine = deps({ ...off, sweep: async () => void swept.push('sweep') })
  assert.equal((await startNow(fine.deps, queue)).ok, true)
  assert.deepEqual(swept, [])
  // Not ready within its time, counted from before the pull: given up before anything is written, so no record says running for a run that never was.
  let at = 0
  const slow = deps({ ...off, check: async () => ((at += 20_001), { ok: true, stdout: '["one entry"]', stderr: '' }) })
  assert.deepEqual(await startNow(slow.deps, queue, () => at), { ok: false, outcome: 'took longer than 20 seconds to get ready, so nothing was started: ask again' })
  assert.deepEqual([slow.seen.markers.length, slow.seen.spawned.length], [0, 0])
  at = 0
  const inTime = deps({ ...off, check: async () => ((at += 20_000), { ok: true, stdout: '["one entry"]', stderr: '' }) })
  assert.equal((await startNow(inTime.deps, queue, () => at)).ok, true)
  // A run that could not be started leaves no marker behind, and one whose marker was swept away before it began is not started.
  const unstartable = deps({ ...off, spawn: async () => Promise.reject(new Error('no such file')) })
  assert.deepEqual(await startNow(unstartable.deps, queue), { ok: false, outcome: 'could not start: no such file' })
  assert.deepEqual([unstartable.seen.markers.length, unstartable.seen.withdrawn.length], [0, 1])
  const sweptAway = deps(off)
  const closed = await startNow({ ...sweptAway.deps, inFlight: async () => [] }, queue)
  assert.deepEqual(closed, { ok: false, outcome: 'not started: its record was closed before the run began' })
  assert.deepEqual([sweptAway.seen.spawned.length, sweptAway.seen.withdrawn.length], [0, 1])
  // By hand the row's agent and model are the tick's: this machine's picks, else what its skill says.
  const onCodex = deps({ stateOver: { switches: {}, runsOn: { review: 'codex' }, models: { review: { agent: 'codex', model: 'gpt-5.5' } } }, atStart: async file => ({ ref: 'origin/main', reached: true, there: file === '.agents/skills/review/SKILL.md' }) })
  assert.equal((await startNow(onCodex.deps, command('review', { every: every('1d'), dirs: [CLAUDE, CODEX] }))).ok, true)
  assert.deepEqual(onCodex.seen.spawned.map(({ prompt, driver, model }) => [prompt, driver, model]), [['/review', 'codex', 'gpt-5.5']])
  const cheap = deps(off)
  await startNow(cheap.deps, command('update-tickets', { when: 'x', model: 'haiku' }))
  assert.deepEqual(cheap.seen.spawned.map(({ driver, model }) => [driver, model]), [['claude-code', 'haiku']])
  // The quota is not even read, and the publish pick of this machine goes with the run as on a tick.
  let reads = 0
  const picked = deps({ stateOver: { switches: {}, publishes: { 'work-queue': 'pr' } }, quota: async () => (reads++, quota(100)) })
  await startNow(picked.deps, queue)
  assert.deepEqual([reads, picked.seen.spawned[0]!.publish], [0, 'pr'])
})

test('a stop that came in during the tick starts nothing: no marker, no spawn, the decision says so', async () => {
  const { deps: d, seen } = deps({ stopped: () => true })
  const record = await tick(d)
  assert.deepEqual(record.decisions, [{ command: 'work-queue', outcome: 'not started: the scheduler was stopped' }])
  assert.equal(seen.markers.length, 0)
  assert.equal(seen.spawned.length, 0)
  assert.deepEqual(seen.checks, ['npx queue'], 'the readings before it still ran')
})

test('a command switched off, or removed, while the tick ran its check and its readings is not started: the switch is asked again last, for that command alone', async () => {
  const commands = [command('work-queue'), command('update-tickets', { when: 'gh issue list' })]
  const asked: string[] = []
  const { deps: d, seen } = deps({
    commands,
    stillOn: async name => {
      asked.push(name)
      return name !== 'work-queue'
    },
  })
  const record = await tick(d)
  assert.deepEqual(record.decisions.map(d => [d.command, d.outcome.replace(/^started .*/, 'started')]), [['work-queue', 'switched off on this machine'], ['update-tickets', 'started']])
  assert.deepEqual(seen.spawned.map(s => s.prompt), ['/update-tickets'])
  assert.deepEqual(seen.markers.map(m => m.intent), ['/update-tickets'], 'no marker was written for the one that went off')
  assert.deepEqual(asked, ['work-queue', 'update-tickets'])
  // Asked only when a run would start: a command that is not due is not asked about.
  const quiet = deps({ check: async () => ({ ok: true, stdout: '[]', stderr: '' }), stillOn: async () => assert.fail('asked for a command that is not due') })
  assert.deepEqual((await tick(quiet.deps)).decisions, [{ command: 'work-queue', outcome: 'not due' }])
})

// A row with each, read from a pretend skill whose check prints the runs to continue and the new runs to start.

/** The pretend skill: one row with each, its check printing what a test gives it. */
function replyRow(over: Partial<ScheduledCommand> = {}): ScheduledCommand {
  const md = ['---', 'name: reply', 'disable-model-invocation: true', 'schedule:', '  each: true', '  when: npx pretend replies', '  waits-for: when someone answered on a run\'s pull request', '---', 'Answer them.'].join('\n')
  const read = skillSchedule('reply', md, CLAUDE)
  assert.deepEqual(read.unreadable, [])
  return { ...read.commands[0]!, ...over }
}

/** An ended run of this machine, on Claude Code unless said otherwise. */
function ended(id: string, over: Partial<RunCard> = {}, host = 'this-box'): RunCard {
  return { id, startedAt: '2026-09-16T10:00:00.000Z', endedAt: '2026-09-16T11:00:00.000Z', status: 'done', intent: '/work-queue', driver: 'claude-code', model: 'opus', caller: { runner: { host } }, ...over }
}

/** What the pretend check prints: each run with its words. */
const printing = (...runs: [run: string, text: string][]): Pick<TickDeps, 'check'> => ({ check: async () => ({ ok: true, stdout: JSON.stringify(runs.map(([run, text]) => ({ run, text }))), stderr: '' }) })

const records = (...cards: RunCard[]): Pick<TickDeps, 'findRun'> => ({ findRun: async id => cards.find(c => c.id === id) })

test('a row with each continues the run its check names: the command and the words, the row named as who resumed it; nothing is marked or spawned, and the run is the decision\'s', async () => {
  const reply = replyRow()
  const { deps: d, seen } = deps({ commands: [reply], ...printing(['r1', 'Someone asked: why this name?']), ...records(ended('r1')) })
  const record = await tick(d)
  assert.deepEqual(record.decisions, [{ command: 'reply', outcome: 'resumed r1', run: 'r1' }])
  assert.deepEqual(seen.resumed, [{ id: 'r1', text: `/reply\n\n${RESUMED_OPENING}\nSomeone asked: why this name?`, by: 'reply' }])
  assert.deepEqual([seen.markers, seen.spawned], [[], []])

  assert.equal(record.schedule[0]!.each, true)
})

test('a row with each asks each run\'s own coding agent whether it can start, and Claude\'s quota for the run\'s own model: a run that cannot go now says why, and the others go', async () => {
  const both = replyRow({ dirs: [CLAUDE, CODEX], cap: 3 })
  const asked: string[] = []
  const week = quota(10)
  const sonnetSpent: DriverQuota = { available: true, windows: [...(week.available ? week.windows : []), { label: 'Current week (Sonnet)', kind: 'week-model', percentUsed: 99 }] }
  const { deps: d, seen } = deps({
    commands: [both],
    ...printing(['on-sonnet', 'a'], ['on-codex', 'b'], ['on-opus', 'c']),
    ...records(ended('on-sonnet', { model: 'sonnet' }), ended('on-codex', { driver: 'codex', model: 'gpt-5' }), ended('on-opus')),
    ready: async agent => (asked.push(agent), { problems: [], warnings: [] }),
    quota: async () => sonnetSpent,
  })
  const record = await tick(d)
  assert.deepEqual(record.decisions.map(x => x.outcome.replace(/^(.*quota: Current week \(Sonnet\) is 99% used).*/, '$1')), ['run on-sonnet not resumed: quota: Current week (Sonnet) is 99% used', 'resumed on-codex', 'resumed on-opus'])
  assert.deepEqual(seen.resumed.map(r => r.id), ['on-codex', 'on-opus'])
  // Each agent asked once per tick.
  assert.deepEqual(asked, ['claude-code', 'codex'])

  const codexDown = deps({ commands: [both], ...printing(['on-codex', 'b'], ['on-opus', 'c']), ...records(ended('on-codex', { driver: 'codex' }), ended('on-opus')), ready: async agent => ({ problems: agent === 'codex' ? ['codex is not logged in.'] : [], warnings: [] }) })
  assert.deepEqual((await tick(codexDown.deps)).decisions.map(x => x.outcome), ['run on-codex not resumed: not ready: codex is not logged in.', 'resumed on-opus'])
})

test('a row with each leaves alone a run of another machine, one still running or whose process holds its lock, one it has no record of, one agent-runner did not start, and one on an agent its skill is not there for', async () => {
  const { deps: d, seen } = deps({
    commands: [replyRow({ cap: 3 })],
    ...printing(['elsewhere', 'x'], ['going', 'x'], ['locked', 'x'], ['unknown', 'x'], ['by-hand', 'x'], ['on-codex', 'x'], ['fine', 'x']),
    ...records(ended('elsewhere', {}, 'other-box'), { ...ended('going'), status: 'running' }, ended('locked'), { ...ended('by-hand'), caller: {} }, ended('on-codex', { driver: 'codex' }), ended('fine')),
    busy: async id => id === 'locked',
  })
  const record = await tick(d)
  assert.deepEqual(
    record.decisions.map(x => x.outcome),
    [
      'run elsewhere not resumed: it ran on other-box, which alone holds its conversation',
      'run going not resumed: it is still running',
      'run locked not resumed: it is still running',
      'run unknown not resumed: no record of it',
      'run by-hand not resumed: agent-runner did not start it',
      'run on-codex not resumed: not a command of Codex: its skill is only under .claude/skills, not .agents/skills',
      'resumed fine',
    ],
  )
  assert.deepEqual(seen.resumed.map(r => r.id), ['fine'])
})

test("a row with each is held by its cap: the runs it resumed that are still running, those it resumed in this tick with them; a run of another row does not count", async () => {
  const resumedEarlier: RunCard = { ...ended('earlier'), status: 'running', caller: { runner: { host: 'this-box', resumed: { by: 'reply', at: '2026-09-16T13:00:00.000Z' } } } }
  const inFlight: TickDeps['inFlight'] = async command => (command === 'reply' ? [resumedEarlier] : [])
  const full = deps({ commands: [replyRow()], ...printing(['r1', 'x']), ...records(ended('r1')), inFlight })
  assert.deepEqual((await tick(full.deps)).decisions.map(x => x.outcome), ['run r1 not resumed: cap reached (1 in flight: earlier on this-box)'])
  assert.deepEqual(full.seen.resumed, [])

  const two = deps({ commands: [replyRow({ cap: 2 })], ...printing(['r1', 'x'], ['r2', 'y'], ['r3', 'z']), ...records(ended('r1'), ended('r2'), ended('r3')), inFlight: async () => [] })
  assert.deepEqual((await tick(two.deps)).decisions.map(x => x.outcome), ['resumed r1', 'resumed r2', 'run r3 not resumed: cap reached (2 in flight: r1, r2)'])
})

test('a row with each: a run named twice is resumed once with both its words; a check that prints no such list says why; one that prints nothing is not due', async () => {
  const twice = deps({ commands: [replyRow()], check: async () => ({ ok: true, stdout: '[{"run":"r1","text":"first"},{"run":"r1","text":"second"}]', stderr: '' }), ...records(ended('r1')) })
  await tick(twice.deps)
  assert.deepEqual(twice.seen.resumed.map(r => r.text), [`/reply\n\n${RESUMED_OPENING}\nfirst\n\nsecond`])

  const odd = deps({ commands: [replyRow()], check: async () => ({ ok: true, stdout: '{"r1":"hello"}', stderr: '' }) })
  assert.deepEqual((await tick(odd.deps)).decisions.map(x => x.outcome), ['check printed no list of runs: the check printed no list'])
  const half = deps({ commands: [replyRow()], check: async () => ({ ok: true, stdout: '[{"run":"r1"}]', stderr: '' }) })
  assert.deepEqual((await tick(half.deps)).decisions.map(x => x.outcome), ['check printed no list of runs: an item of the list is no { "run": "<id>", "text": "…" } and no { "for": "<what>", "text": "…" }, with "branch" only beside "for"'])
  const quiet = deps({ commands: [replyRow()], check: async () => ({ ok: true, stdout: '[]', stderr: '' }) })
  assert.deepEqual((await tick(quiet.deps)).decisions.map(x => x.outcome), ['not due'])
})

test('a row with each is switched like any row: off, its check is not run; switched off while the tick ran, nothing is resumed; a stop starts nothing', async () => {
  const off = deps({ commands: [replyRow()], stateOver: { switches: {} }, ...printing(['r1', 'x']), ...records(ended('r1')) })
  assert.deepEqual((await tick(off.deps)).decisions.map(x => x.outcome), ['switched off on this machine'])
  assert.deepEqual(off.seen.checks, [])

  const flipped = deps({ commands: [replyRow()], stillOn: async () => false, ...printing(['r1', 'x']), ...records(ended('r1')) })
  assert.deepEqual((await tick(flipped.deps)).decisions.map(x => x.outcome), ['run r1 not resumed: switched off on this machine'])
  const stopped = deps({ commands: [replyRow()], stopped: () => true, ...printing(['r1', 'x']), ...records(ended('r1')) })
  assert.deepEqual((await tick(stopped.deps)).decisions.map(x => x.outcome), ['run r1 not resumed: not started: the scheduler was stopped'])
  assert.deepEqual([...flipped.seen.resumed, ...stopped.seen.resumed], [])
})

test('a row with each, asked by hand: whatever its switch and the quota; the answer is the first run it resumed, or every reason none went', async () => {
  const over = { commands: [replyRow()], stateOver: { switches: {} }, quota: async () => quota(100), stillOn: async () => false }
  const asked = deps({ ...over, ...printing(['gone', 'x'], ['r1', 'y']), ...records(ended('r1')) })
  assert.deepEqual(await startNow(asked.deps, replyRow()), { ok: true, run: { id: 'r1', at: NOW.toISOString() }, resumed: true })
  const none = deps({ ...over, ...printing(['gone', 'x'], ['going', 'y']), ...records({ ...ended('going'), status: 'running' }) })
  assert.deepEqual(await startNow(none.deps, replyRow()), { ok: false, outcome: 'run gone not resumed: no record of it; run going not resumed: it is still running' })
})

test('a row with each runs its real check through the shell: the run id it prints is the run resumed', async () => {
  const reply = replyRow({ when: `printf '[{"run":"%s","text":"since %s"}]' r1 "$LAST_RUN"` })
  const { deps: d, seen } = deps({ commands: [reply], check: (shell, lastRun) => runCheck(process.cwd(), shell, 10_000, lastRun), ...records(ended('r1')) })
  await tick(d)
  assert.deepEqual(seen.resumed, [{ id: 'r1', text: `/reply\n\n${RESUMED_OPENING}\nsince 2026-09-16T12:00:00Z`, by: 'reply' }])
})

/** What the pretend check prints: each new run with what it is for, and its branch when one is given. */
const asking = (...starts: [what: string, text: string, branch?: string][]): Pick<TickDeps, 'check'> => ({ check: async () => ({ ok: true, stdout: JSON.stringify(starts.map(([what, text, branch]) => ({ for: what, text, ...(branch !== undefined ? { branch } : {}) }))), stderr: '' }) })

test('a row with each starts a run for each new thing its check names: on the row\'s agent and model, handed the item\'s words, on the branch it names, its marker naming what it is for', async () => {
  const { deps: d, seen } = deps({ commands: [replyRow({ cap: 3 })], stateOver: { publishes: { reply: 'pr' } }, ...asking(['https://x/issues/5', '@rom: /agent add a README'], ['https://x/pull/6', '@rom: /agent fix it', 'dark-mode']) })
  const record = await tick(d)
  assert.deepEqual(record.decisions.map(x => [x.outcome, x.run]), [
    ['started 2026-09-16T14-01-00-000Z', '2026-09-16T14-01-00-000Z'],
    ['started 2026-09-16T14-01-00-001Z', '2026-09-16T14-01-00-001Z'],
  ])
  assert.deepEqual(seen.markers.map(c => [c.intent, (c.caller?.['runner'] as RunnerMark).for, c.caller?.['for']]), [
    ['/reply', 'https://x/issues/5', 'https://x/issues/5'],
    ['/reply', 'https://x/pull/6', 'https://x/pull/6'],
  ])
  assert.deepEqual(
    seen.spawned.map(({ prompt, attached, branch, for: what, publish }) => ({ prompt, attached, branch, for: what, publish })),
    [
      { prompt: '/reply', attached: `${FOUND_OPENING}\n@rom: /agent add a README`, branch: undefined, for: 'https://x/issues/5', publish: 'pr' },
      { prompt: '/reply', attached: `${FOUND_OPENING}\n@rom: /agent fix it`, branch: 'dark-mode', for: 'https://x/pull/6', publish: 'pr' },
    ],
  )
})

test('a row with each resumes first, then starts: its cap counts the runs it resumed in this tick, and a run the row\'s agent cannot run says so', async () => {
  const one = deps({ commands: [replyRow()], check: async () => ({ ok: true, stdout: JSON.stringify([{ for: 'https://x/issues/5', text: 'a' }, { run: 'r1', text: 'b' }]), stderr: '' }), ...records(ended('r1')) })
  assert.deepEqual((await tick(one.deps)).decisions.map(x => x.outcome), ['resumed r1', 'no run for https://x/issues/5: cap reached (1 in flight: r1)'])
  assert.deepEqual([one.seen.markers, one.seen.withdrawn, one.seen.spawned], [[], [], []], 'no marker written for a run the cap holds back')

  const onCodex = deps({ commands: [replyRow()], stateOver: { runsOn: { reply: 'codex' } }, ...asking(['https://x/issues/5', 'a']) })
  assert.deepEqual((await tick(onCodex.deps)).decisions.map(x => x.outcome), ['no run for https://x/issues/5: not a command of Codex: its skill is only under .claude/skills, not .agents/skills'])
})

test('a row with each starts one run for a thing across every machine: a marker for it that landed first keeps it, and this machine\'s is withdrawn', async () => {
  const theirs: RunCard = { id: '2026-09-16T14-00-59-000Z', startedAt: NOW.toISOString(), status: 'running', intent: '/reply', caller: { runner: { host: 'other-box', for: 'https://x/issues/5' } } }
  const lost = deps({ commands: [replyRow({ cap: 3 })], inFlightCards: [theirs], ...asking(['https://x/issues/5', 'a'], ['https://x/issues/6', 'b']) })
  assert.deepEqual((await tick(lost.deps)).decisions.map(x => x.outcome), ['no run for https://x/issues/5: another machine got there first: run 2026-09-16T14-00-59-000Z is for https://x/issues/5', 'started 2026-09-16T14-01-00-001Z'])
  assert.deepEqual(lost.seen.withdrawn, ['2026-09-16T14-01-00-000Z'])
  assert.deepEqual(lost.seen.spawned.map(r => r.for), ['https://x/issues/6'])
})

test('a check is told when its command was switched on on this machine, as $SWITCHED_ON, and a day ago for one asked by hand that is off', async () => {
  const told: string[] = []
  const check: TickDeps['check'] = async (_shell, _lastRun, switchedOn) => (told.push(switchedOn), { ok: true, stdout: '[]', stderr: '' })
  // Started since: what is new for $LAST_RUN, not when it was switched on.
  await tick(deps({ commands: [replyRow()], check, lastStart: async () => '2026-09-16T13:00:00.000Z' }).deps)
  await startNow(deps({ commands: [replyRow()], stateOver: { switches: {} }, check }).deps, replyRow())
  assert.deepEqual(told, ['2026-09-16T12:00:00Z', '2026-09-15T14:01:00Z'])
  assert.equal((await runCheck(process.cwd(), 'printf "%s" "$SWITCHED_ON"', 10_000, 'x', '2026-09-16T12:00:00Z')).stdout, '2026-09-16T12:00:00Z')
})

test('between ticks, only the rows that may be checked more often and are due again are decided, with no pull and no sweep; a scheduler off decides none', async () => {
  const often = replyRow({ checkEvery: { ms: 15_000, text: '15s' } })
  const minutely = { ...replyRow(), name: 'other' }
  const asked: string[] = []
  const { deps: d, seen } = deps({ commands: [often, minutely], ...printing(['r1', 'Why this name?']), ...records(ended('r1')) })
  let pulled = 0
  const looked = await glance({ ...d, pull: async () => (pulled++, { ok: true }) }, command => (asked.push(command.name), true))
  assert.deepEqual(looked, [{ command: 'reply', outcome: 'resumed r1', run: 'r1' }])
  assert.deepEqual(asked, ['reply'], 'a row that says nothing waits for the tick')
  assert.equal(pulled, 0, 'the tick pulls and sweeps')
  assert.deepEqual(seen.resumed.map(r => r.id), ['r1'])
  assert.deepEqual(await glance(d, () => false), [], 'not due again yet')
  assert.deepEqual(await glance({ ...d, state: { ...d.state, on: false } }, () => true), [])
})

test('with several Claude accounts unattended work goes on the first with room, and the run or the resume is told which; with every one past its line nothing starts, and the line says each', async () => {
  const dani = { name: 'Dani', token: 'sk-ant-oat01-dani', windows: [{ window: 'seven_day', percentUsed: 10, resetsAt: NOW.getTime() + 4 * 24 * 60 * 60 * 1000 }] }
  const started = deps({ quota: async () => quota(90), accounts: async () => [{ name: 'Rom' }, dani] })
  assert.match((await tick(started.deps)).decisions[0]!.outcome, /^started /)
  assert.equal(started.seen.spawned[0]!.account, 'Dani')

  const own = deps({ quota: async () => quota(10), accounts: async () => [{ name: 'Rom' }, dani] })
  await tick(own.deps)
  assert.equal(own.seen.spawned[0]!.account, 'Rom')

  const resumed = deps({ commands: [replyRow()], ...printing(['r1', 'why?']), ...records(ended('r1')), quota: async () => quota(90), accounts: async () => [{ name: 'Rom' }, dani] })
  await tick(resumed.deps)
  assert.equal(resumed.seen.resumed[0]!.account, 'Dani')

  const spent = deps({ quota: async () => quota(90), accounts: async () => [{ name: 'Rom' }, { ...dani, limitedUntil: NOW.getTime() + 60 * 60_000 }] })
  const [decision] = (await tick(spent.deps)).decisions
  assert.match(decision!.outcome, /^quota: every Claude account is past its line \(Rom: Current week \(all models\) is 90% used, .*; Dani is at its limit, free again in 1 h\)$/)
  assert.deepEqual(spent.seen.spawned, [])
})

test('with one Claude account the gate is as it always was, and no run is told an account', async () => {
  const one = deps({ quota: async () => quota(10), accounts: async () => [{ name: 'Rom', limitedUntil: NOW.getTime() + 60 * 60_000 }] })
  await tick(one.deps)
  assert.equal(one.seen.spawned.length, 1)
  assert.equal('account' in one.seen.spawned[0]!, false)
})

test('a project whose runs use one added account alone: unattended work is gated by that account, never by the person\'s own quota, and the run is told it', async () => {
  const dani = { name: 'Dani', token: 'sk-ant-oat01-dani', windows: [{ window: 'seven_day', percentUsed: 10, resetsAt: NOW.getTime() + 4 * 24 * 60 * 60 * 1000 }] }
  const room = deps({ quota: async () => quota(99), accounts: async () => [dani] })
  await tick(room.deps)
  assert.equal(room.seen.spawned[0]!.account, 'Dani')
  const full = deps({ quota: async () => quota(10), accounts: async () => [{ ...dani, limitedUntil: NOW.getTime() + 60 * 60_000 }] })
  assert.match((await tick(full.deps)).decisions[0]!.outcome, /^quota: every Claude account is past its line \(Dani is at its limit/)
})
