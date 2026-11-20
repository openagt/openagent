import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { RunCard } from '@openagt/skill-logs'
import { bridgeSessionsFrom } from './bridge-sessions.js'
import { webRunOf, type WebRun } from './web-runs.js'

const NOW = new Date('2026-07-26T20:00:00.000Z')
const NONE_QUEUED: string[] = []

/** A web run, its session `sessionId` when one is named. */
function agent({ sessionId, ...over }: Partial<RunCard> & { sessionId?: string }): WebRun {
  return webRunOf({ id: 'r', startedAt: '2026-07-26T19:00:00.000Z', status: 'running', intent: 'x', ...over, caller: { target: 'web', ...(sessionId ? { sessionId } : {}) } })!
}

test('only the web runs whose hand-off made a cloud session are offered (#1237)', () => {
  const got = bridgeSessionsFrom(
    [
      agent({ id: 'a', sessionId: 'session_A' }),
      // A web run whose hand-off never landed has nothing to open.
      agent({ id: 'd' }),
    ],
    NOW,
    NONE_QUEUED,
  )
  assert.deepEqual(got, [{ id: 'session_A', url: 'https://claude.ai/code/session_A', answerQueued: false }])
})

test('status is not the filter: a run the window ended may still have its session parked (#1231)', () => {
  const got = bridgeSessionsFrom([agent({ sessionId: 'session_A', status: 'done' })], NOW, NONE_QUEUED)
  assert.equal(got.length, 1)
})

test('anything older than the window is dropped (#1237)', () => {
  const got = bridgeSessionsFrom(
    [
      agent({ id: 'old', sessionId: 'session_OLD', startedAt: '2026-07-25T00:00:00.000Z' }),
      agent({ id: 'new', sessionId: 'session_NEW', startedAt: '2026-07-26T19:30:00.000Z' }),
    ],
    NOW,
    NONE_QUEUED,
  )
  assert.deepEqual(got.map(s => s.id), ['session_NEW'])
})

test('newest first, and every one of them: the Driver tab serves the whole list (#1332)', () => {
  const agents = Array.from({ length: 8 }, (_, i) =>
    agent({ id: `r${i}`, sessionId: `session_${i}`, startedAt: `2026-07-26T19:${String(10 + i).padStart(2, '0')}:00.000Z` }),
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
    [agent({ id: 'a', sessionId: 'session_A' }), agent({ id: 'b', sessionId: 'session_B' })],
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
    [agent({ id: 'old', sessionId: 'session_OLD', startedAt: '2026-07-25T20:00:00.000Z' })],
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
      agent({ id: 'a', sessionId: 'session_SAME', startedAt: '2026-07-26T19:30:00.000Z' }),
      agent({ id: 'b', sessionId: 'session_SAME', startedAt: '2026-07-26T19:10:00.000Z' }),
    ],
    NOW,
    NONE_QUEUED,
  )
  assert.equal(got.length, 1)
})

test('an unparseable start time is skipped rather than treated as now (#1237)', () => {
  assert.deepEqual(bridgeSessionsFrom([agent({ sessionId: 'session_X', startedAt: 'not a date' })], NOW, NONE_QUEUED), [])
})
