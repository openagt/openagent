import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { markerCard, recordRun, writeMarker } from '@openagt/agent-runner'
import { listRuns } from '@openagt/skill-logs'
import { commandOf, inFlight, lastRuns, lastStart } from './records.js'
import { parseInterval } from './pace.js'
import type { Schedule } from './schedule.js'
import { removeRepo, testRepo } from './test-repo.js'

// The runs a command has, counted off agent-runner's records on the real branch, every machine's.

const mark = { host: 'this-box', pid: 4242 }
const NONE: Schedule = { commands: [], unreadable: [] }

/** A schedule of skills' commands, by name. */
const skills = (...names: string[]): Schedule => ({ commands: names.map(name => ({ name, cap: 1, dir: '.claude/skills', dirs: ['.claude/skills'] })), unreadable: [] })

test("a run whose prompt is the name of an automation kept on this machine counts for that automation, whatever its text was when it ran, and on this machine alone: another person's automation of the same name is another one", async () => {
  const repo = await testRepo()
  try {
    const schedule: Schedule = { commands: [{ name: 'answer-comments', text: 'Answer each new comment below, in two lines.', cap: 1, dir: '.agent-scheduler/automations', dirs: ['.agent-scheduler/automations'] }], unreadable: [] }
    await writeMarker(repo, markerCard({ id: 'o1', startedAt: '2026-09-16T14:01:00.000Z', prompt: 'answer-comments', driver: 'claude-code', model: 'opus', mark }))
    await recordRun(repo, { id: 'o0', startedAt: '2026-09-16T09:00:00.000Z', status: 'done', intent: 'answer-comments', caller: { runner: { host: 'this-box' } } }, [])
    // A plain prompt that happens to be the automation's text, one that starts with its name, and the name typed as a command, are other runs.
    await recordRun(repo, { id: 'x0', startedAt: '2026-09-16T15:00:00.000Z', status: 'done', intent: 'Answer each new comment below, in two lines.', caller: { runner: { host: 'this-box' } } }, [])
    await recordRun(repo, { id: 'x1', startedAt: '2026-09-16T15:10:00.000Z', status: 'running', intent: 'answer-comments is broken, fix it', caller: { runner: { host: 'this-box' } } }, [])
    await recordRun(repo, { id: 'x2', startedAt: '2026-09-16T15:20:00.000Z', status: 'running', intent: '/answer-comments', caller: { runner: { host: 'this-box' } } }, [])
    // A teammate keeps an automation of the same name on their machine: theirs.
    await recordRun(repo, { id: 't0', startedAt: '2026-09-16T16:00:00.000Z', status: 'running', intent: 'answer-comments', caller: { runner: { host: 'their-box' } } }, [])
    assert.equal(await lastStart(repo, 'answer-comments', schedule, 'this-box'), '2026-09-16T14:01:00.000Z')
    assert.deepEqual((await inFlight(repo, 'answer-comments', schedule, 'this-box')).map(c => c.id), ['o1'])
    assert.equal(await lastStart(repo, 'answer-comments', schedule, 'their-box'), '2026-09-16T16:00:00.000Z')
    // Where the name is a skill's command, a run with no slash is no run of it, on any machine.
    assert.equal(await lastStart(repo, 'answer-comments', skills('answer-comments'), 'this-box'), '2026-09-16T15:20:00.000Z', 'only the one typed as a command')
  } finally {
    await removeRepo(repo)
  }
})

test("each command's last run, with its id and its start: the latest run of a command, and it says failed only when that run failed, so a later run that is going, ended well, was stopped or waits takes the failure's place; an automation kept on this machine counts this machine's runs alone", async () => {
  const repo = await testRepo()
  try {
    const schedule: Schedule = { commands: [...skills('work-queue', 'update-tickets', 'triage', 'plan-tickets', 'never-ran').commands, { name: 'tidy', text: 'Tidy up.', cap: 1, dir: '.agent-scheduler/automations', dirs: ['.agent-scheduler/automations'] }], unreadable: [] }
    const run = (id: string, startedAt: string, status: 'done' | 'failed' | 'stopped' | 'waiting' | 'running', intent: string, host = 'this-box') => recordRun(repo, { id, startedAt, status, intent, caller: { runner: { host } } }, [])
    // Failed last, after a good one: said, with the failed run's id.
    await run('q1', '2026-09-16T09:00:00.000Z', 'done', '/work-queue')
    await run('q2', '2026-09-16T10:00:00.000Z', 'failed', '/work-queue')
    // Failed, then a later run of each other kind: no longer the last.
    await run('u1', '2026-09-16T09:00:00.000Z', 'failed', '/update-tickets')
    await run('u2', '2026-09-16T10:00:00.000Z', 'done', '/update-tickets')
    await run('t1', '2026-09-16T09:00:00.000Z', 'failed', '/triage')
    await run('t2', '2026-09-16T10:00:00.000Z', 'running', '/triage', 'their-box')
    await run('p1', '2026-09-16T09:00:00.000Z', 'failed', '/plan-tickets')
    await run('p2', '2026-09-16T10:00:00.000Z', 'stopped', '/plan-tickets')
    // An automation kept here: its own failed run counts, a teammate's later good run of that name does not.
    await run('o1', '2026-09-16T09:00:00.000Z', 'failed', 'tidy')
    await run('o2', '2026-09-16T10:00:00.000Z', 'done', 'tidy', 'their-box')
    // A failed run of no command, and a record written by hand with no time: neither is anyone's last run.
    await run('x1', '2026-09-16T11:00:00.000Z', 'failed', 'fix the tests')
    await run('q3', 'later', 'done', '/work-queue')
    const at = '2026-09-16T10:00:00.000Z'
    const shared = { 'work-queue': { id: 'q2', at, failed: true }, 'update-tickets': { id: 'u2', at }, triage: { id: 't2', at }, 'plan-tickets': { id: 'p2', at } }
    assert.deepEqual(await lastRuns(repo, schedule, 'this-box'), { ...shared, tidy: { id: 'o1', at: '2026-09-16T09:00:00.000Z', failed: true } })
    assert.deepEqual(await lastRuns(repo, schedule, 'their-box'), { ...shared, tidy: { id: 'o2', at } })
    assert.deepEqual(await lastRuns(repo, NONE, 'this-box'), {})
  } finally {
    await removeRepo(repo)
  }
})

test('a record whose start is not a time is not counted as a start: a record written by hand cannot stop the tick', async () => {
  const repo = await testRepo()
  try {
    await recordRun(repo, { id: 'b0', startedAt: '2026-09-16T09:00:00.000Z', status: 'done', intent: '/answer-comments', caller: { runner: { host: 'this-box' } } }, [])
    await recordRun(repo, { id: 'b1', startedAt: 'yesterday', status: 'done', intent: '/answer-comments', caller: { runner: { host: 'this-box' } } }, [])
    assert.equal(await lastStart(repo, 'answer-comments', skills('answer-comments'), 'this-box'), '2026-09-16T09:00:00.000Z')
  } finally {
    await removeRepo(repo)
  }
})

test("the last start of a skill's command is its newest card on any machine, whatever became of the run; a command never started has none", async () => {
  const repo = await testRepo()
  try {
    await writeMarker(repo, markerCard({ id: 'a1', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/work-queue', driver: 'claude-code', model: 'opus', mark }))
    await recordRun(repo, { id: 'a0', startedAt: '2026-09-16T09:00:00.000Z', status: 'done', intent: '/work-queue', caller: { runner: { host: 'other-box' } } }, [])
    await recordRun(repo, { id: 'a2', startedAt: '2026-09-16T14:02:00.000Z', status: 'failed', intent: '/work-queue', caller: { runner: { host: 'other-box' } } }, [])
    await recordRun(repo, { id: 'd1', startedAt: '2026-09-16T15:00:00.000Z', status: 'running', intent: 'a dashboard run' }, [])
    assert.equal(await lastStart(repo, 'work-queue', skills('work-queue', 'triage-quick'), 'this-box'), '2026-09-16T14:02:00.000Z')
    assert.equal(await lastStart(repo, 'triage-quick', skills('work-queue', 'triage-quick'), 'this-box'), undefined)
  } finally {
    await removeRepo(repo)
  }
})

test("in flight counts the running cards of one skill's command, whatever the machine; a card agent-runner did not write is not counted", async () => {
  const repo = await testRepo()
  try {
    await writeMarker(repo, markerCard({ id: 'a1', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/work-queue', driver: 'claude-code', model: 'opus', mark }))
    await writeMarker(repo, markerCard({ id: 'a2', startedAt: '2026-09-16T14:02:00.000Z', prompt: '/work-queue', driver: 'claude-code', model: 'opus', mark: { ...mark, host: 'other-box' } }))
    await writeMarker(repo, markerCard({ id: 'b1', startedAt: '2026-09-16T14:03:00.000Z', prompt: '/triage', driver: 'claude-code', model: 'opus', mark }))
    await recordRun(repo, { id: 'd1', startedAt: '2026-09-16T13:00:00.000Z', status: 'running', intent: 'a dashboard run' }, [])
    const schedule = skills('work-queue', 'triage')
    assert.deepEqual((await inFlight(repo, 'work-queue', schedule, 'this-box')).map(c => c.id).sort(), ['a1', 'a2'])
    assert.deepEqual((await inFlight(repo, 'triage', schedule, 'this-box')).map(c => c.id), ['b1'])
    assert.equal((await listRuns(repo)).length, 4)
  } finally {
    await removeRepo(repo)
  }
})

test("a run counts for the skill's command its prompt names with a slash, else for the one its first word is; a prompt that names no scheduled command, a prompt with no slash, and a run agent-runner did not start count for none", () => {
  const schedule: Schedule = { commands: [{ name: 'triage quick', every: parseInterval('6h')!, cap: 1, dir: '.claude/skills', dirs: ['.claude/skills'] }, { name: 'triage', every: parseInterval('7d')!, cap: 1, dir: '.claude/skills', dirs: ['.claude/skills'] }, { name: 'work-queue', when: 'npx queue', cap: 1, dir: '.claude/skills', dirs: ['.claude/skills'] }, { name: 'post-merge-cleanup', every: parseInterval('1h')!, cap: 1, dir: '.claude/skills', dirs: ['.claude/skills'] }], unreadable: [] }
  const card = (intent: string) => markerCard({ id: 'x', startedAt: '2026-09-16T14:01:00.000Z', prompt: intent, driver: 'claude-code', mark })
  const of = (intent: string, among: Schedule = schedule) => commandOf(card(intent), among, 'this-box')
  assert.equal(of('/triage quick'), 'triage quick')
  assert.equal(of('/triage'), 'triage')
  assert.equal(of('/triage other'), 'triage', 'a word no row has: the skill\'s own command')
  assert.equal(of('/work-queue now'), 'work-queue')
  assert.equal(of('/post-merge-cleanup 2026-09-16T14-01-00-000Z'), 'post-merge-cleanup', 'a follow-up counts for its own command')
  assert.equal(of('Read the docs'), undefined)
  assert.equal(of('work-queue'), undefined, 'no slash: no skill\'s command')
  assert.equal(of('work-queue is stuck, look at it'), undefined)
  assert.equal(of('/review the open pull requests'), undefined, 'a command nothing schedules')
  assert.equal(of('/triage quick', NONE), undefined)
  assert.equal(commandOf({ id: 'd1', startedAt: '2026-09-16T13:00:00.000Z', status: 'running', intent: '/triage quick' }, schedule, 'this-box'), undefined)
})

test('a run a row resumed counts for that row from its resume on, on the machine that resumed it: in flight while it runs, its resume as the row\'s last start and last run; it still counts for the command it was started for', async () => {
  const repo = await testRepo()
  try {
    const schedule = skills('work-queue', 'reply')
    const resumed = (by: string, at: string, host = 'this-box') => ({ runner: { host, resumed: { by, at } } })
    await recordRun(repo, { id: 'w1', startedAt: '2026-09-16T09:00:00.000Z', status: 'running', intent: '/work-queue', caller: resumed('reply', '2026-09-16T12:00:00.000Z') }, [])
    await recordRun(repo, { id: 'w2', startedAt: '2026-09-16T10:00:00.000Z', status: 'failed', intent: '/work-queue', caller: resumed('reply', '2026-09-16T11:00:00.000Z') }, [])
    // Resumed on another machine, and resumed by hand since (no row on its mark): neither is this row's.
    await recordRun(repo, { id: 'w3', startedAt: '2026-09-16T10:30:00.000Z', status: 'running', intent: '/work-queue', caller: resumed('reply', '2026-09-16T13:00:00.000Z', 'their-box') }, [])
    await recordRun(repo, { id: 'w4', startedAt: '2026-09-16T10:40:00.000Z', status: 'running', intent: '/work-queue', caller: { runner: { host: 'this-box' } } }, [])
    assert.deepEqual((await inFlight(repo, 'reply', schedule, 'this-box')).map(c => c.id), ['w1'])
    assert.equal(await lastStart(repo, 'reply', schedule, 'this-box'), '2026-09-16T12:00:00.000Z')
    const last = await lastRuns(repo, schedule, 'this-box')
    assert.deepEqual(last['reply'], { id: 'w1', at: '2026-09-16T12:00:00.000Z' })
    // The command it was started for keeps counting it, by its own start.
    assert.deepEqual(last['work-queue'], { id: 'w4', at: '2026-09-16T10:40:00.000Z' })
    assert.deepEqual((await inFlight(repo, 'work-queue', schedule, 'this-box')).map(c => c.id).sort(), ['w1', 'w3', 'w4'])
    assert.equal(await lastStart(repo, 'reply', schedule, 'their-box'), '2026-09-16T13:00:00.000Z')
  } finally {
    await removeRepo(repo)
  }
})
