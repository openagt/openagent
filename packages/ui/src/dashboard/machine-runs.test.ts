import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentMeta } from '../store/index.js'
import { MachineRunsKept, RunChanges, withMachineRuns, type OwnRuns } from './machine-runs.js'

const run = (id: string, status: AgentMeta['status'], host: string, more: Partial<AgentMeta> = {}): AgentMeta => ({ id, status, host, startedAt: `2026-10-25T10:${id}:00.000Z`, updatedAt: `2026-10-25T10:${id}:00.000Z`, ...more })

test('a computer answers every run of its own first, then only the ones that changed since that answer', () => {
  const changes = new RunChanges()
  const first = changes.answer('/p', [run('01', 'running', 'laptop'), run('02', 'done', 'laptop')])
  assert.deepEqual(first.runs.map(r => r.id), ['01', '02'])
  assert.deepEqual(first.ids, ['01', '02'])
  // Nothing changed: nothing is sent again, and every id still is.
  const same = changes.answer('/p', [run('01', 'running', 'laptop'), run('02', 'done', 'laptop')], first.at)
  assert.deepEqual(same.runs, [])
  assert.deepEqual(same.ids, ['01', '02'])
  // The first run ended and the second was deleted: only the first is sent, and the second's id is gone.
  const next = changes.answer('/p', [run('01', 'done', 'laptop')], same.at)
  assert.deepEqual(next.runs.map(r => [r.id, r.status]), [['01', 'done']])
  assert.deepEqual(next.ids, ['01'])
  // Nothing changed, the count stayed; then what a list shows changed after it: a run ended, and one went.
  assert.equal(same.at, first.at)
  assert.equal(changes.shownSince('/p', same.at), true)
  assert.equal(changes.shownSince('/p', next.at), false)
  // A count from another OpenAgent, or none, is answered with every run.
  assert.equal(new RunChanges().answer('/p', [run('01', 'done', 'laptop')], next.at).runs.length, 1)
  assert.equal(changes.answer('/p', [run('01', 'done', 'laptop')], 'nonsense').runs.length, 1)
})

test('a step of a run is a change to answer, and no change a list shows', () => {
  const changes = new RunChanges()
  const first = changes.answer('/p', [run('01', 'running', 'laptop')])
  const step = changes.answer('/p', [run('01', 'running', 'laptop', { updatedAt: '2026-10-25T10:05:00.000Z', cost: 0.4 })], first.at)
  assert.notEqual(step.at, first.at)
  assert.deepEqual(step.runs.map(r => r.cost), [0.4])
  assert.equal(changes.shownSince('/p', first.at), false)
  changes.answer('/p', [run('01', 'running', 'laptop', { title: 'Fix the login', cost: 0.4 })], step.at)
  assert.equal(changes.shownSince('/p', step.at), true)
  // From another OpenAgent's count, everything is new.
  assert.equal(changes.shownSince('/p', 'other.1'), true)
})

test("a machine's word on its own runs wins over their records, and a run of its own with no record yet is listed", () => {
  const records = [run('03', 'running', 'laptop'), run('01', 'running', 'rom-thinkpad')]
  const rows = withMachineRuns(records, [{ host: 'laptop', answered: true, runs: [run('03', 'done', 'laptop'), run('02', 'running', 'laptop')] }])
  assert.deepEqual(
    rows.map(r => [r.id, r.status]),
    [
      ['03', 'done'],
      ['02', 'running'],
      // Another computer's run is as its record says: no machine answers for it.
      ['01', 'running'],
    ],
  )
})

test("a machine's run that is going by its record alone is unknown: its machine did not say so just now", () => {
  const records = [run('02', 'running', 'laptop'), run('01', 'waiting', 'laptop'), run('00', 'done', 'laptop')]
  // The machine answered, and does not have the run going: the record is old.
  const answered = withMachineRuns(records, [{ host: 'laptop', answered: true, runs: [], seenAt: '2026-10-25T11:00:00.000Z' }])
  assert.deepEqual(answered.map(r => r.status), ['unknown', 'unknown', 'done'])
  // The machine does not answer: what it said last is kept, and nothing of it is going.
  const offline = withMachineRuns([run('01', 'running', 'laptop')], [{ host: 'laptop', answered: false, runs: [run('02', 'running', 'laptop'), run('01', 'done', 'laptop')], seenAt: '2026-10-25T11:00:00.000Z' }])
  assert.deepEqual(
    offline.map(r => [r.id, r.status, r.seenAt]),
    [
      ['02', 'unknown', '2026-10-25T11:00:00.000Z'],
      ['01', 'done', undefined],
    ],
  )
})

test("a machine's word is taken only for its own runs: not for a run it names another computer's, nor for another computer's run of the same id", () => {
  const rows = withMachineRuns([run('01', 'running', 'server')], [{ host: 'laptop', answered: true, runs: [run('01', 'done', 'server')] }])
  assert.deepEqual(rows.map(r => [r.id, r.status, r.host]), [['01', 'running', 'server']])
  const same = withMachineRuns([run('01', 'running', 'server')], [{ host: 'laptop', answered: true, runs: [run('01', 'done', 'laptop')] }])
  assert.deepEqual(same.map(r => [r.id, r.status, r.host]), [['01', 'running', 'server']])
})

test("a machine's runs are followed with one call it holds: what changes a list is told at once, a step is only kept", async () => {
  let now = 1_000_000
  const calls: { since: string | undefined; answer: (said: OwnRuns) => void; fail: (err: Error) => void }[] = []
  const pauses: number[] = []
  const seen: string[] = []
  const kept = new MachineRunsKept(
    (_machine, _address, since) => new Promise((answer, fail) => calls.push({ since, answer, fail })),
    (_machine, at) => seen.push(at),
    () => now,
    async ms => void pauses.push(ms),
  )
  let told = 0
  kept.listen('github.com/me/p', () => told++)
  const until = async (done: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !done(); i++) await new Promise(resolve => setImmediate(resolve))
    assert.ok(done(), 'it never happened')
  }
  const laptop = { url: 'http://127.0.0.1:4310', host: 'laptop' }
  // The first answer is waited for; a run that names another computer is not the machine's to say.
  const reading = kept.of([laptop], 'github.com/me/p')
  await until(() => calls.length === 1)
  calls[0]!.answer({ at: 'a.1', runs: [run('01', 'running', 'laptop'), run('03', 'done', 'elsewhere')], ids: ['01'] })
  const [first] = await reading
  assert.deepEqual([first!.runs.map(r => r.id), first!.answered, first!.seenAt, told], [['01'], true, new Date(now).toISOString(), 1])
  // Asked again at once from where it left off, a call the machine holds: a page reading meanwhile is answered with what is kept.
  await until(() => calls.length === 2)
  assert.equal(calls[1]!.since, 'a.1')
  await kept.of([laptop], 'github.com/me/p')
  assert.equal(calls.length, 2)
  // A step of the run (its cost) is kept, and told to no one.
  calls[1]!.answer({ at: 'a.2', runs: [run('01', 'running', 'laptop', { cost: 0.3 })], ids: ['01'] })
  await until(() => calls.length === 3)
  assert.equal(told, 1)
  assert.equal((await kept.of([laptop], 'github.com/me/p'))[0]!.runs[0]!.cost, 0.3)
  // It answered at once with nothing a list shows: it does not hold the call, and is asked again later.
  assert.equal(pauses.at(-1), 5_000)
  // The run waits on the person: told.
  calls[2]!.answer({ at: 'a.3', runs: [run('01', 'waiting', 'laptop')], ids: ['01'] })
  await until(() => told === 2)
  // The run is gone: told.
  await until(() => calls.length === 4)
  calls[3]!.answer({ at: 'a.4', runs: [], ids: [] })
  await until(() => told === 3)
  // It does not answer: what it said last stands, it is said not to have answered, and it is left a while.
  await until(() => calls.length === 5)
  calls[4]!.fail(new Error('This computer is not connected.'))
  await until(() => told === 4)
  const [off] = await kept.of([laptop], 'github.com/me/p')
  assert.deepEqual([off!.answered, off!.seenAt, pauses.at(-1)], [false, new Date(now).toISOString(), 10_000])
  assert.equal(seen.length, 4)
  // No page asked for a minute: it is followed no more once its call is answered.
  await until(() => calls.length === 6)
  now += 61_000
  calls[5]!.answer({ at: 'a.5', runs: [], ids: [] })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(calls.length, 6)
})

test('a machine renamed while it is followed: its runs under the new name are taken, and it is asked again for all of them', async () => {
  const calls: { since: string | undefined; answer: (said: unknown) => void }[] = []
  const kept = new MachineRunsKept(
    (_machine, _address, since) => new Promise(answer => calls.push({ since, answer })),
    () => {},
    () => 1_000,
    async () => {},
  )
  const until = async (done: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !done(); i++) await new Promise(resolve => setImmediate(resolve))
    assert.ok(done(), 'it never happened')
  }
  const run = { id: 'r1', status: 'running', startedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', host: 'new-name', title: 'Named' }
  const url = 'http://127.0.0.1:4310'
  const first = kept.of([{ url, host: 'old-name' }], 'github.com/me/p')
  await until(() => calls.length === 1)
  // Under the name it was asked with, a run under the new name is another computer's.
  calls[0]!.answer({ at: 'a.1', runs: [run], ids: ['r1'] })
  assert.deepEqual((await first)[0]!.runs, [])
  await until(() => calls.length === 2)
  assert.equal(calls[1]!.since, 'a.1')
  // The list asks with the new name while the machine holds the call: its answer counts, and the next ask starts over.
  const [renamed] = await kept.of([{ url, host: 'new-name' }], 'github.com/me/p')
  assert.equal(renamed!.host, 'new-name')
  calls[1]!.answer({ at: 'a.2', runs: [run], ids: ['r1'] })
  await until(() => calls.length === 3)
  assert.equal(calls[2]!.since, undefined)
  const [now] = await kept.of([{ url, host: 'new-name' }], 'github.com/me/p')
  assert.deepEqual(now!.runs.map(r => r.title), ['Named'])
  kept.stop()
  calls[2]!.answer({ at: 'a.3', runs: [run], ids: ['r1'] })
})

test('a machine never asked yet is known by when it was last seen as kept with it', async () => {
  const kept = new MachineRunsKept(async () => {
    throw new Error('off')
  })
  const [off] = await kept.of([{ url: 'http://127.0.0.1:4310', host: 'laptop', seenAt: '2026-10-25T09:00:00.000Z' }], 'github.com/me/p')
  assert.equal(off!.answered, false)
  assert.equal(off!.seenAt, '2026-10-25T09:00:00.000Z')
})
