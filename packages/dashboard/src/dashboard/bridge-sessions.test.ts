import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentMeta } from '../store/index.js'
import { bridgeSessionsFrom } from './bridge-sessions.js'

const NOW = new Date('2026-07-26T20:00:00.000Z')
const NONE_QUEUED: string[] = []

function agent(over: Partial<AgentMeta>): AgentMeta {
  return {
    id: 'r',
    startedAt: '2026-07-26T19:00:00.000Z',
    status: 'done',
    intent: 'x',
    ...over,
  } as AgentMeta
}

test('only web runs that carry a cloud session are offered (#1237)', () => {
  const got = bridgeSessionsFrom(
    [
      agent({ id: 'a', target: 'web', sessionId: 'session_A' }),
      agent({ id: 'b', target: 'local', sessionId: 'session_B' }),
      agent({ id: 'c', target: 'actions', sessionId: 'session_C' }),
      // A web agent whose hand-off never landed has nothing to open.
      agent({ id: 'd', target: 'web' }),
    ],
    NOW,
    NONE_QUEUED,
  )
  assert.deepEqual(got, [{ id: 'session_A', url: 'https://claude.ai/code/session_A', answerQueued: false }])
})

test('status is not the filter, because every web run reads done (#1231)', () => {
  // #1231 ends a web agent at the hand-off, so `done` says nothing about whether its session is
  // parked. Filtering on status would offer nothing at all.
  const got = bridgeSessionsFrom([agent({ target: 'web', sessionId: 'session_A', status: 'done' })], NOW, NONE_QUEUED)
  assert.equal(got.length, 1)
})

test('anything older than the window is dropped (#1237)', () => {
  const got = bridgeSessionsFrom(
    [
      agent({ id: 'old', target: 'web', sessionId: 'session_OLD', startedAt: '2026-07-25T00:00:00.000Z' }),
      agent({ id: 'new', target: 'web', sessionId: 'session_NEW', startedAt: '2026-07-26T19:30:00.000Z' }),
    ],
    NOW,
    NONE_QUEUED,
  )
  assert.deepEqual(got.map(s => s.id), ['session_NEW'])
})

test('newest first, and every one of them: the Driver tab serves the whole list (#1332)', () => {
  const agents = Array.from({ length: 8 }, (_, i) =>
    agent({ id: `r${i}`, target: 'web', sessionId: `session_${i}`, startedAt: `2026-07-26T19:${String(10 + i).padStart(2, '0')}:00.000Z` }),
  )
  const got = bridgeSessionsFrom(agents, NOW, NONE_QUEUED)
  // One tab reads claude.ai's list and visits only the sessions that need it, so the count no
  // longer costs a tab each and the old cap of three is gone.
  assert.deepEqual(
    got.map(s => s.id),
    ['session_7', 'session_6', 'session_5', 'session_4', 'session_3', 'session_2', 'session_1', 'session_0'],
  )
})

test('a session with an answer queued says so, since it is visited whatever the list says (#1332)', () => {
  const got = bridgeSessionsFrom(
    [agent({ id: 'a', target: 'web', sessionId: 'session_A' }), agent({ id: 'b', target: 'web', sessionId: 'session_B' })],
    NOW,
    ['session_B'],
  )
  assert.deepEqual(
    got.map(s => [s.id, s.answerQueued]),
    [
      ['session_A', false],
      ['session_B', true],
    ],
  )
})

test('a session with an answer queued is served even outside the window or with no run at all (#1332)', () => {
  const got = bridgeSessionsFrom(
    [agent({ id: 'old', target: 'web', sessionId: 'session_OLD', startedAt: '2026-07-25T20:00:00.000Z' })],
    NOW,
    ['session_OLD', 'session_NOBODYS'],
  )
  assert.deepEqual(got, [
    { id: 'session_OLD', url: 'https://claude.ai/code/session_OLD', answerQueued: true },
    { id: 'session_NOBODYS', url: 'https://claude.ai/code/session_NOBODYS', answerQueued: true },
  ])
})

test('the same session listed by two runs is offered once (#1237)', () => {
  const got = bridgeSessionsFrom(
    [
      agent({ id: 'a', target: 'web', sessionId: 'session_SAME', startedAt: '2026-07-26T19:30:00.000Z' }),
      agent({ id: 'b', target: 'web', sessionId: 'session_SAME', startedAt: '2026-07-26T19:10:00.000Z' }),
    ],
    NOW,
    NONE_QUEUED,
  )
  assert.equal(got.length, 1)
})

test('an unparseable start time is skipped rather than treated as now (#1237)', () => {
  assert.deepEqual(bridgeSessionsFrom([agent({ target: 'web', sessionId: 'session_X', startedAt: 'not a date' })], NOW, NONE_QUEUED), [])
})
