import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { AnswersKept, QUEUE_KEPT_MS, interventionsOf, namedHere, withMachinesQueue } from './machine-interventions.js'
import type { Intervention } from './interventions.js'

const item = (over: Partial<Intervention>): Intervention => ({ projectId: 'shop', projectName: 'shop', kind: 'pr', title: 't', ...over })

test('what a computer said as its Human Queue keeps only what reads as items, in the fields an item has', () => {
  const read = interventionsOf({
    items: [
      { projectId: 'p', projectName: 'p', kind: 'pr', title: 'ok', url: 'https://github.com/a/b/pull/1', number: 1, extra: 'dropped' },
      { projectId: 'p', projectName: 'p', kind: 'pr', title: 'a link that is no page', url: 'javascript:alert(1)' },
      { projectId: 'p', projectName: 'p', kind: 'deploy', title: 'no such kind' },
      { projectId: 'p', kind: 'pr', title: 'no project name' },
      { projectId: 'p', projectName: 'p', kind: 'unpushed', title: 'counts', commits: -1, files: 1.5, createdAt: 'not a date' },
      'not an item',
    ],
    whole: ['p', 3],
  })
  assert.deepEqual(read, {
    items: [
      { projectId: 'p', projectName: 'p', kind: 'pr', title: 'ok', url: 'https://github.com/a/b/pull/1', number: 1 },
      { projectId: 'p', projectName: 'p', kind: 'pr', title: 'a link that is no page' },
      { projectId: 'p', projectName: 'p', kind: 'unpushed', title: 'counts' },
    ],
    whole: ['p'],
  })
  assert.deepEqual(interventionsOf('nonsense'), { items: [], whole: [] })
})

test('a computer\'s items are named by the projects here, a run\'s marked with its computer, one of no project here dropped', () => {
  const here: Record<string, string> = { 'shop-b': 'shop-a', 'other-b': 'other-b~m1' }
  const named = namedHere(
    { items: [item({ projectId: 'shop-b', kind: 'awaiting', agentId: 'r1' }), item({ projectId: 'other-b', url: 'https://x/1' }), item({ projectId: 'gone' })], whole: ['shop-b', 'gone'] },
    id => here[id],
    { name: 'MacBook', kind: 'computer' },
  )
  assert.deepEqual(named, {
    items: [item({ projectId: 'shop-a', kind: 'awaiting', agentId: 'r1', computer: { name: 'MacBook', kind: 'computer' } }), item({ projectId: 'other-b~m1', url: 'https://x/1' })],
    whole: ['shop-a'],
  })
})

test('the Human Queue with the other computers\': named as listed here, once each, newest first; of a PR both list, the run\'s', () => {
  const own = {
    items: [item({ url: 'https://x/1', title: 'by hand here', createdAt: '2026-10-27T09:00:00Z' }), item({ kind: 'uncommitted', agentId: 'mine', createdAt: '2026-10-27T08:00:00Z' })],
    whole: ['shop'],
  }
  const theirs = {
    said: [
      {
        items: [
          item({ url: 'https://x/1', title: 'the run that opened it', agentId: 'theirs', computer: { name: 'MacBook', kind: 'computer' }, createdAt: '2026-10-27T09:00:00Z' }),
          item({ kind: 'awaiting', projectId: 'other~m1', projectName: 'as there', agentId: 'r2', awaitId: 'q', computer: { name: 'MacBook', kind: 'computer' }, createdAt: '2026-10-27T10:00:00Z' }),
          item({ projectId: 'not-listed', url: 'https://x/9' }),
        ],
        whole: ['shop', 'other~m1'],
      },
    ],
    unread: [],
  }
  const names = new Map([
    ['shop', 'shop'],
    ['other~m1', 'other'],
  ])
  const merged = withMachinesQueue(own, theirs, names)
  assert.deepEqual(
    merged.items.map(one => [one.projectName, one.title, one.computer?.name]),
    [
      ['other', 't', 'MacBook'],
      ['shop', 'the run that opened it', 'MacBook'],
      ['shop', 't', undefined],
    ],
  )
  assert.deepEqual(merged.whole, ['shop', 'other~m1'])
})

test('a project another computer has that did not answer is not read whole: its items there are not known', () => {
  const merged = withMachinesQueue({ items: [], whole: ['shop'] }, { said: [], unread: ['shop', 'other~m1'] }, new Map([['shop', 'shop']]))
  assert.deepEqual(merged, { items: [], whole: [] })
})

test('a machine is asked again only once what it said is old, answered with that meanwhile; a failed ask keeps nothing', async () => {
  let now = 0
  let answer: () => Promise<string> = async () => 'first'
  let asks = 0
  const kept = new AnswersKept<{ id: string }, string>(
    async () => {
      asks++
      return answer()
    },
    () => now,
  )
  const machine = { id: 'm' }
  assert.deepEqual([...(await kept.of([machine]))], [['m', 'first']])
  now = QUEUE_KEPT_MS - 1
  answer = async () => 'second'
  assert.deepEqual([...(await kept.of([machine]))], [['m', 'first']])
  assert.equal(asks, 1)
  // Old now: answered with what it said last, while it is asked again behind.
  now = QUEUE_KEPT_MS
  assert.deepEqual([...(await kept.of([machine]))], [['m', 'first']])
  await new Promise(done => setImmediate(done))
  assert.deepEqual([...(await kept.of([machine]))], [['m', 'second']])
  // It stops answering: what it said is not taken as still so.
  now = 2 * QUEUE_KEPT_MS
  answer = async () => {
    throw new Error('off')
  }
  await kept.of([machine])
  await new Promise(done => setImmediate(done))
  assert.deepEqual([...(await kept.of([machine]))], [])
})

test('a machine never answered is waited for a little, not for long', async () => {
  const kept = new AnswersKept<{ id: string }, string>(() => new Promise(() => {}))
  const started = Date.now()
  assert.deepEqual([...(await kept.of([{ id: 'm' }]))], [])
  assert.ok(Date.now() - started < 5_000)
})
