import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentMeta } from '../store/index.js'
import { moduleAgents } from './module-agents.js'

const run = (id: string, startedAt: string, more: Partial<AgentMeta> = {}): AgentMeta => ({ id, status: 'done', startedAt, updatedAt: startedAt, cwd: `/work/${id}`, ...more }) as AgentMeta

const RUNS = [
  run('old', '2026-08-01T10:00:00.000Z', { intent: 'an old ask', branch: 'agent-old', runner: 'claude', sessionId: 's1' } as Partial<AgentMeta>),
  run('holder', '2026-09-01T10:00:00.000Z', { status: 'waiting', host: 'macbook' }),
  run('recent', '2026-10-20T10:00:00.000Z', { person: 'ada@example.com', cost: 1.5 }),
  run('newest', '2026-10-21T10:00:00.000Z'),
]

test('a module is sent only the runs it asked for, each in the fields a module reads', () => {
  assert.deepEqual(
    moduleAgents(RUNS).map(agent => agent.id),
    ['old', 'holder', 'recent', 'newest'],
    'nothing asked: every run',
  )
  assert.deepEqual(moduleAgents(RUNS, { ids: ['holder', 'gone'] }), [{ id: 'holder', status: 'waiting', startedAt: '2026-09-01T10:00:00.000Z' }])
  assert.deepEqual(
    moduleAgents(RUNS, { since: '2026-09-26T00:00:00.000Z' }),
    [
      { id: 'recent', status: 'done', startedAt: '2026-10-20T10:00:00.000Z', person: 'ada@example.com', cost: 1.5 },
      { id: 'newest', status: 'done', startedAt: '2026-10-21T10:00:00.000Z' },
    ],
  )
  assert.deepEqual(moduleAgents(RUNS, { ids: ['old', 'recent'], since: '2026-09-26T00:00:00.000Z' }).map(agent => agent.id), ['recent'], 'both asked: a run must be both')
  // The record's own fields (its checkout, its session, its runner) are no module's.
  assert.deepEqual(moduleAgents(RUNS, { ids: ['old'] }), [{ id: 'old', status: 'done', startedAt: '2026-08-01T10:00:00.000Z', name: 'agent-old', ask: 'an old ask' }])
})

test("a run's pull request reaches a module with how the git host last said it stands, so a merged run reads as the sidebar's", () => {
  const pr = { number: 48, url: 'https://example.com/pull/48' }
  assert.deepEqual(moduleAgents([run('merged', '2026-10-20T10:00:00.000Z', { pr, prState: 'merged' })])[0]!.pr, { ...pr, state: 'merged' })
  assert.deepEqual(moduleAgents([run('unread', '2026-10-20T10:00:00.000Z', { pr })])[0]!.pr, pr, 'not read yet: no state')
})
