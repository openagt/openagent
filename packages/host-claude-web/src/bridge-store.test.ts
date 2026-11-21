import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { BridgeQuestions } from './bridge-store.js'
import type { BridgeQuestion } from './bridge-endpoints.js'

const SESSION = 'session_01Test'

const question = (title = 'Pick one'): BridgeQuestion => ({
  sessionId: SESSION,
  title,
  options: [{ label: 'Alpha' }, { label: 'Beta' }],
  recommended: 'Beta',
  receivedAt: '2026-07-26T18:00:00.000Z',
})

test('an answer can only be a label the parked question offered (#1237)', () => {
  const store = new BridgeQuestions()
  assert.equal(store.queueAnswer(SESSION, ['Alpha']), 'that session has no parked question')
  store.record(question())
  assert.equal(store.queueAnswer(SESSION, ['rm -rf /']), 'every label must be one of the question options')
  assert.equal(store.queueAnswer(SESSION, ['Alpha', 'rm -rf /']), 'every label must be one of the question options')
  // A single-select takes exactly one: none and several are both refused.
  assert.equal(store.queueAnswer(SESSION, []), 'pick exactly one option')
  assert.equal(store.queueAnswer(SESSION, ['Alpha', 'Beta']), 'pick exactly one option')
  const queued = store.queueAnswer(SESSION, ['Alpha'])
  assert.ok(typeof queued === 'object')
  assert.equal(queued.state, 'queued')
  assert.deepEqual(store.pendingAnswer(SESSION)?.labels, ['Alpha'])
})

test('what gets typed is the continuation a local gate re-prompts with (#1554)', () => {
  const store = new BridgeQuestions()
  store.record(question())
  const queued = store.queueAnswer(SESSION, ['Alpha'])
  assert.ok(typeof queued === 'object')
  assert.equal(queued.text, 'You paused to ask: "Pick one". The user chose: Alpha. Continue with that decision.')
})

test('a multi-select takes a subset of labels, none included, joined as a local gate words it (#1554)', () => {
  const store = new BridgeQuestions()
  store.record({ ...question('Which checks?'), multi: true, options: [{ label: 'Lint', default: true }, { label: 'Tests' }, { label: 'Docs' }] })
  const two = store.queueAnswer(SESSION, ['Lint', 'Tests'])
  assert.ok(typeof two === 'object')
  assert.equal(two.text, 'You paused to ask: "Which checks?". The user chose: Lint, Tests. Continue with that decision.')
  const none = store.queueAnswer(SESSION, [])
  assert.ok(typeof none === 'object')
  assert.equal(none.text, 'You paused to ask: "Which checks?". The user chose: (none). Continue with that decision.')
  assert.equal(store.queueAnswer(SESSION, ['Lint', 'Lint']), 'every label must be one of the question options')
})

test('a stop option hands the session over instead of continuing it (#358/#1554)', () => {
  const store = new BridgeQuestions()
  store.record({ ...question('Ship this?'), options: [{ label: 'Approve' }, { label: 'Decline', stop: true }], recommended: 'Approve' })
  const declined = store.queueAnswer(SESSION, ['Decline'])
  assert.ok(typeof declined === 'object')
  assert.equal(declined.text, 'You paused to ask: "Ship this?". The user chose: Decline. Stop here: the user is taking over and will come back with fresh instructions.')
  const approved = store.queueAnswer(SESSION, ['Approve'])
  assert.ok(typeof approved === 'object')
  assert.match(approved.text, /Continue with that decision\.$/)
})

test('a delivered answer resolves the question, and its re-report is ignored (#1237)', () => {
  const store = new BridgeQuestions()
  store.record(question())
  const queued = store.queueAnswer(SESSION, ['Beta'])
  assert.ok(typeof queued === 'object')
  store.resolveAnswer(SESSION, queued.id, true)
  assert.equal(store.get(SESSION), undefined)
  assert.equal(store.answer(SESSION)?.state, 'sent')
  assert.equal(store.pendingAnswer(SESSION), undefined)
  // The answered block stays in the page's DOM and the worker forgets what it sent on restart,
  // so the same question WILL be reported again. It must not resurface as parked.
  store.record(question())
  assert.equal(store.get(SESSION), undefined)
  // A genuinely new question does surface, and clears the resolved answer with it.
  store.record(question('Something new'))
  assert.equal(store.get(SESSION)?.title, 'Something new')
  assert.equal(store.answer(SESSION), undefined)
})

test('a failed delivery keeps the question so the user can retry (#1237)', () => {
  const store = new BridgeQuestions()
  store.record(question())
  const queued = store.queueAnswer(SESSION, ['Beta'])
  assert.ok(typeof queued === 'object')
  store.resolveAnswer(SESSION, queued.id, false, 'no composer on the page')
  assert.equal(store.get(SESSION)?.title, 'Pick one')
  assert.equal(store.answer(SESSION)?.state, 'failed')
  assert.equal(store.answer(SESSION)?.note, 'no composer on the page')
  // Retrying replaces the failed attempt.
  const retried = store.queueAnswer(SESSION, ['Alpha'])
  assert.ok(typeof retried === 'object')
  assert.deepEqual(store.pendingAnswer(SESSION)?.labels, ['Alpha'])
})

test('a queued answer can be withdrawn, a resolved one cannot (#1237)', () => {
  const store = new BridgeQuestions()
  store.record(question())
  const queued = store.queueAnswer(SESSION, ['Beta'])
  assert.ok(typeof queued === 'object')
  assert.equal(store.cancelAnswer(SESSION), true)
  assert.equal(store.answer(SESSION), undefined)
  const again = store.queueAnswer(SESSION, ['Beta'])
  assert.ok(typeof again === 'object')
  store.resolveAnswer(SESSION, again.id, true)
  assert.equal(store.cancelAnswer(SESSION), false)
  assert.equal(store.answer(SESSION)?.state, 'sent')
})

test('a stale ack cannot resolve a newer answer (#1237)', () => {
  const store = new BridgeQuestions()
  store.record(question())
  const first = store.queueAnswer(SESSION, ['Alpha'])
  assert.ok(typeof first === 'object')
  const second = store.queueAnswer(SESSION, ['Beta'])
  assert.ok(typeof second === 'object')
  store.resolveAnswer(SESSION, first.id, true)
  assert.equal(store.answer(SESSION)?.state, 'queued')
  assert.equal(store.get(SESSION)?.title, 'Pick one')
})

test('an undelivered pick dies with the question it answered (#1237)', () => {
  const store = new BridgeQuestions()
  store.record(question())
  const queued = store.queueAnswer(SESSION, ['Beta'])
  assert.ok(typeof queued === 'object')
  // The session moved on before the extension collected the pick: typing the old answer into
  // the new question would be answering a question nobody asked.
  store.record(question('Something new'))
  assert.equal(store.pendingAnswer(SESSION), undefined)
})

test("claude.ai's list saying a session awaits input makes it waiting, until the session is cleared (#1332)", () => {
  const store = new BridgeQuestions()
  // A fixed clock: a list status counts only within the session window, so the test's "now" must
  // sit inside the window of the timestamps it records — not the wall clock, which walked out of
  // it twelve hours after the timestamps were written.
  const now = new Date('2026-08-25T18:05:00.000Z')
  assert.equal(store.waiting(SESSION, now), false)
  // A question asked in prose carries no block: the list is the only thing that says the session
  // stopped for its user.
  store.recordStatus({ sessionId: SESSION, status: 'awaiting', at: '2026-08-25T18:00:00.000Z' })
  assert.equal(store.waiting(SESSION, now), true)
  assert.equal(store.status(SESSION)?.status, 'awaiting')
  // The newest report replaces the older one.
  store.recordStatus({ sessionId: SESSION, status: 'idle', at: '2026-08-25T18:01:00.000Z' })
  assert.equal(store.waiting(SESSION, now), false)
  // A parked question makes the session waiting whatever the list said.
  store.record(question())
  assert.equal(store.waiting(SESSION, now), true)
  store.clear(SESSION)
  assert.equal(store.waiting(SESSION, now), false)
  assert.equal(store.status(SESSION), undefined)
})

test('a list status older than the session window no longer marks the session waiting (#1332)', () => {
  const store = new BridgeQuestions()
  store.recordStatus({ sessionId: SESSION, status: 'awaiting', at: '2026-08-25T06:00:00.000Z' })
  assert.equal(store.waiting(SESSION, new Date('2026-08-25T17:59:00.000Z')), true)
  // Past the window the Driver no longer reads the session, so its last word cannot stand forever.
  assert.equal(store.waiting(SESSION, new Date('2026-08-25T18:01:00.000Z')), false)
})

test('an answer is handed to one Driver at a time, and offered again once its claim expires (#1332)', () => {
  const store = new BridgeQuestions()
  store.record(question())
  store.queueAnswer(SESSION, ['Alpha'])
  const t0 = Date.parse('2026-08-26T12:00:00.000Z')
  const first = store.claimAnswer(SESSION, t0)
  assert.equal(first?.labels[0], 'Alpha')
  // The user's own Chrome and the daemon's browser both serve the session: the second asker gets nothing.
  assert.equal(store.claimAnswer(SESSION, t0 + 1000), undefined)
  // The dashboard still sees it queued, and cannot withdraw what a Driver is typing.
  assert.equal(store.pendingAnswer(SESSION)?.state, 'queued')
  assert.equal(store.cancelAnswer(SESSION, t0 + 1000), false)
  // A Driver that died mid-delivery never acknowledges; the claim expires and the answer is offered again.
  assert.equal(store.claimAnswer(SESSION, t0 + 90_001)?.id, first?.id)
  assert.equal(store.cancelAnswer(SESSION, t0 + 200_000), true)
})
