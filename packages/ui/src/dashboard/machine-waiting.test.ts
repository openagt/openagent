import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { AnswersKept, QUEUE_KEPT_MS, waitingOf, namedHere, withMachinesQueue } from './machine-waiting.js'
import type { Waiting } from './waiting.js'

const item = (over: Partial<Waiting>): Waiting => ({ kind: 'waiting', module: 'github', scope: 'project', words: 'Needs merge', projectId: 'shop', projectName: 'shop', title: 't', ...over })
const request = (url: string, over: Partial<Waiting> = {}) => item({ id: url, fix: { label: 'Open PR', href: url }, ...over })

test('what a computer said waits on the person keeps only what reads as items, in the fields an item has', () => {
  const read = waitingOf({
    items: [
      { kind: 'waiting', projectId: 'p', projectName: 'p', module: 'github', scope: 'project', id: 'u1', words: 'Needs merge', title: 'ok', detail: '#1', mark: 'pull-request', fix: { label: 'Open PR #1', href: 'https://github.com/a/b/pull/1' }, extra: 'dropped' },
      { kind: 'waiting', projectId: 'p', projectName: 'p', module: 'github', scope: 'project', words: 'Needs merge', title: 'a link that is no page', fix: { label: 'Open', href: 'javascript:alert(1)' } },
      // What fixes it there is an action of that computer's module: pressed here, it would be done here.
      { kind: 'waiting', projectId: 'p', projectName: 'p', module: 'tickets', scope: 'project', words: 'Needs triage', fix: { label: 'Triage', action: 'triage' } },
      { kind: 'setup', projectId: 'p', projectName: 'p', module: 'browser', scope: 'computer', words: 'Chrome is missing' },
      { kind: 'waiting', projectId: 'p', projectName: 'p', module: 'x', scope: 'galaxy', words: 'no such scope' },
      { kind: 'waiting', projectId: 'p', module: 'x', scope: 'project', words: 'no project name' },
      { kind: 'waiting', projectId: 'p', projectName: 'p', module: 'git-branches', scope: 'run', run: 'r1', words: 'Needs push', mark: 'rocket', since: 'not a date' },
      'not an item',
    ],
    whole: ['p', 3],
  })
  assert.deepEqual(read, {
    items: [
      { kind: 'waiting', projectId: 'p', projectName: 'p', module: 'github', scope: 'project', id: 'u1', words: 'Needs merge', title: 'ok', detail: '#1', mark: 'pull-request', fix: { label: 'Open PR #1', href: 'https://github.com/a/b/pull/1' } },
      { kind: 'waiting', projectId: 'p', projectName: 'p', module: 'github', scope: 'project', words: 'Needs merge', title: 'a link that is no page' },
      { kind: 'waiting', projectId: 'p', projectName: 'p', module: 'tickets', scope: 'project', words: 'Needs triage' },
      { kind: 'waiting', projectId: 'p', projectName: 'p', module: 'git-branches', scope: 'run', run: 'r1', words: 'Needs push' },
    ],
    whole: ['p'],
  })
  assert.deepEqual(waitingOf('nonsense'), { items: [], whole: [] })
})

test('a computer\'s items are named by the projects here, a run\'s marked with its computer, one of no project here dropped', () => {
  const here: Record<string, string> = { 'shop-b': 'shop-a', 'other-b': 'other-b~m1' }
  const asks = item({ module: 'ask', scope: 'run', run: 'r1', words: 'Needs answer' })
  const named = namedHere(
    { items: [{ ...asks, projectId: 'shop-b' }, request('https://x/1', { projectId: 'other-b' }), item({ projectId: 'gone' })], whole: ['shop-b', 'gone'] },
    id => here[id],
    { name: 'MacBook', kind: 'computer' },
  )
  assert.deepEqual(named, {
    items: [{ ...asks, projectId: 'shop-a', computer: { name: 'MacBook', kind: 'computer' } }, request('https://x/1', { projectId: 'other-b~m1' })],
    whole: ['shop-a'],
  })
})

test('what waits here with what the other computers say: named as listed here, once each, newest first; of a PR both list, the run\'s', () => {
  const own = {
    items: [request('https://x/1', { title: 'by hand here', since: '2026-10-27T09:00:00Z' }), item({ module: 'git-branches', scope: 'run', run: 'mine', id: 'uncommitted:mine', words: 'Needs commit', since: '2026-10-27T08:00:00Z' })],
    whole: ['shop'],
  }
  const theirs = {
    said: [
      {
        items: [
          request('https://x/1', { scope: 'run', run: 'theirs', title: 'the run that opened it', computer: { name: 'MacBook', kind: 'computer' }, since: '2026-10-27T09:00:00Z' }),
          item({ module: 'ask', scope: 'run', run: 'r2', id: 'r2:q', words: 'Needs answer', projectId: 'other~m1', projectName: 'as there', computer: { name: 'MacBook', kind: 'computer' }, since: '2026-10-27T10:00:00Z' }),
          request('https://x/9', { projectId: 'not-listed' }),
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
  // The wait's own timer does not hold the process, as a daemon's must not: the test does, meanwhile.
  const held = setInterval(() => {}, 1_000)
  try {
    const started = Date.now()
    assert.deepEqual([...(await kept.of([{ id: 'm' }]))], [])
    assert.ok(Date.now() - started < 5_000)
  } finally {
    clearInterval(held)
  }
})
