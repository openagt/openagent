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
  // A count from another OpenAgent, or none, is answered with every run.
  assert.equal(new RunChanges().answer('/p', [run('01', 'done', 'laptop')], next.at).runs.length, 1)
  assert.equal(changes.answer('/p', [run('01', 'done', 'laptop')], 'nonsense').runs.length, 1)
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

test('what a machine said is kept a few seconds, asked again behind the page, and held while it does not answer', async () => {
  let now = 1_000_000
  const asked: (string | undefined)[] = []
  let answer: () => Promise<OwnRuns> = async () => ({ at: 'a.2', runs: [run('01', 'running', 'laptop'), run('02', 'done', 'laptop'), run('03', 'done', 'elsewhere')], ids: ['01', '02'] })
  const seen: string[] = []
  const kept = new MachineRunsKept(
    async (_machine, _address, since) => {
      asked.push(since)
      return answer()
    },
    (_machine, at) => seen.push(at),
    () => now,
  )
  const laptop = { url: 'http://127.0.0.1:4310', host: 'laptop' }
  // The first ask is waited for; a run that names another computer is not the machine's to say.
  const [first] = await kept.of([laptop], 'github.com/me/p')
  assert.deepEqual(first!.runs.map(r => r.id), ['01', '02'])
  assert.equal(first!.answered, true)
  assert.equal(first!.seenAt, new Date(now).toISOString())
  assert.equal(seen.length, 1)
  // Within a few seconds the answer stands: the machine is not asked again.
  now += 1_000
  await kept.of([laptop], 'github.com/me/p')
  assert.deepEqual(asked, [undefined])
  // Later it is asked from where it left off, and what changed goes in; a run it no longer has goes out.
  now += 10_000
  answer = async () => ({ at: 'a.3', runs: [run('01', 'done', 'laptop')], ids: ['01'] })
  await kept.of([laptop], 'github.com/me/p')
  await new Promise(resolve => setImmediate(resolve))
  const [later] = await kept.of([laptop], 'github.com/me/p')
  assert.deepEqual(asked, [undefined, 'a.2'])
  assert.deepEqual(later!.runs.map(r => [r.id, r.status]), [['01', 'done']])
  // It does not answer: what it said last stands, and it is said not to have answered, with when it was seen.
  now += 10_000
  answer = async () => {
    throw new Error('This computer is not connected.')
  }
  await kept.of([laptop], 'github.com/me/p')
  await new Promise(resolve => setImmediate(resolve))
  const [off] = await kept.of([laptop], 'github.com/me/p')
  assert.equal(off!.answered, false)
  assert.deepEqual(off!.runs.map(r => r.id), ['01'])
  assert.equal(off!.seenAt, new Date(now - 10_000).toISOString())
})

test('a machine never asked yet is known by when it was last seen as kept with it', async () => {
  const kept = new MachineRunsKept(async () => {
    throw new Error('off')
  })
  const [off] = await kept.of([{ url: 'http://127.0.0.1:4310', host: 'laptop', seenAt: '2026-10-25T09:00:00.000Z' }], 'github.com/me/p')
  assert.equal(off!.answered, false)
  assert.equal(off!.seenAt, '2026-10-25T09:00:00.000Z')
})
