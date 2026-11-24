import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { fakeApp } from '@openagt/hooks/testing'
import { NEEDS_ANSWER, webAttention } from './attention.js'
import { bridgeQuestions, resetBridgeQuestions } from './bridge-store.js'
import { recorded, removeRepo, testRepo } from './test-support.js'

// What waits on the person: a web run whose cloud session is parked on them.

const NOW = new Date('2026-11-19T12:00:00.000Z')
const question = (sessionId: string, title: string) => ({ sessionId, title, options: [{ label: 'Yes' }, { label: 'No' }], receivedAt: '2026-11-19T11:00:00.000Z' })

test('a session parked on its person waits on them under its run: on the question the bridge holds, or on words its list says it awaits; not once a pick is on its way (#1554, #1332, #2394)', async () => {
  resetBridgeQuestions()
  const repo = await testRepo()
  try {
    await recorded(repo, '2026-11-19T10-00-00-000Z', { title: 'Add a flag' }, { sessionId: 'session_01A' })
    await recorded(repo, '2026-11-19T10-00-01-000Z', { intent: 'Fix the build' }, { sessionId: 'session_01B' })
    await recorded(repo, '2026-11-19T10-00-02-000Z', {}, { sessionId: 'session_01C' })
    const store = bridgeQuestions()
    store.record(question('session_01A', 'Which flag?'))
    store.recordStatus({ sessionId: 'session_01B', status: 'awaiting', at: '2026-11-19T11:30:00.000Z' })
    store.record(question('session_01C', 'Ship it?'))
    assert.ok(typeof store.queueAnswer('session_01C', ['Yes']) !== 'string')
    // A session no run of the project's names is another project's.
    store.record(question('session_01Z', 'Elsewhere?'))
    const attention = webAttention({ now: () => NOW })
    assert.deepEqual(await attention({ project: { id: 'shop', name: 'shop', dir: repo } }, fakeApp()), [
      { kind: 'waiting', scope: 'run', run: '2026-11-19T10-00-00-000Z', id: '2026-11-19T10-00-00-000Z:Which flag?', words: NEEDS_ANSWER, title: 'Add a flag', detail: 'Which flag?', since: '2026-11-19T11:00:00.000Z', mark: 'question' },
      { kind: 'waiting', scope: 'run', run: '2026-11-19T10-00-01-000Z', id: '2026-11-19T10-00-01-000Z:awaiting', words: NEEDS_ANSWER, title: 'Fix the build', detail: 'It asks in its session on claude.ai.', since: '2026-11-19T11:30:00.000Z', mark: 'question' },
    ])
    assert.deepEqual(await attention({}, fakeApp()), [], 'no project, nothing of its runs')
  } finally {
    await removeRepo(repo)
    resetBridgeQuestions()
  }
})

test('with no session parked anywhere, no record is read (#2394)', async () => {
  resetBridgeQuestions()
  const attention = webAttention({ now: () => NOW, logs: { read: () => assert.fail('no record is read') } as never })
  assert.deepEqual(await attention({ project: { id: 'shop', name: 'shop', dir: '/nowhere' } }, fakeApp()), [])
})
