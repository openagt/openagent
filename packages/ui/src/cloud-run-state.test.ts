import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { CLOUD_SESSION_WINDOW_MS, cloudRunActive, cloudRunState, type CloudRunFacts } from './cloud-run-state.js'

const NOW = Date.parse('2026-08-23T20:00:00.000Z')
const HOUR = 60 * 60 * 1000

const web = (over: Partial<CloudRunFacts> = {}): CloudRunFacts => ({
  target: 'web',
  status: 'done',
  startedAt: new Date(NOW - HOUR).toISOString(),
  ...over,
})

test('a young web run with nothing adopted is in cloud; past the session window it is done (#1668)', () => {
  assert.equal(cloudRunState(web(), NOW), 'in-cloud')
  assert.equal(cloudRunState(web({ startedAt: new Date(NOW - CLOUD_SESSION_WINDOW_MS).toISOString() }), NOW), 'in-cloud')
  assert.equal(cloudRunState(web({ startedAt: new Date(NOW - CLOUD_SESSION_WINDOW_MS - 1).toISOString() }), NOW), 'done')
  // An unreadable start is not "still working": say done rather than in cloud forever.
  assert.equal(cloudRunState(web({ startedAt: 'not a date' }), NOW), 'done')
})

test('a question the bridge holds makes the run waiting, over everything else (#1668)', () => {
  assert.equal(cloudRunState(web({ cloudWaiting: true }), NOW), 'waiting')
  assert.equal(cloudRunState(web({ cloudWaiting: true, pr: { number: 1, url: 'u' } }), NOW), 'waiting')
  // Even an old one: the session is parked now, however long ago it started.
  assert.equal(cloudRunState(web({ cloudWaiting: true, startedAt: new Date(NOW - 3 * CLOUD_SESSION_WINDOW_MS).toISOString() }), NOW), 'waiting')
})

test('adopted work says what a local run would: done with its PR, or merged (#1668)', () => {
  // The PR's own state is not on the record (both 1622 and 1608 read "open" while closed), so the
  // word is done and the PR badge carries the live state.
  assert.equal(cloudRunState(web({ pr: { number: 7, url: 'u' } }), NOW), 'done')
  assert.equal(cloudRunState(web({ pr: { number: 7, url: 'u' }, mergeOutcome: 'merged' }), NOW), 'merged')
  // Merged outranks age: a merged run never reads as done-by-timeout.
  assert.equal(cloudRunState(web({ pr: { number: 7, url: 'u' }, mergeOutcome: 'merged', startedAt: new Date(NOW - 3 * CLOUD_SESSION_WINDOW_MS).toISOString() }), NOW), 'merged')
  assert.equal(cloudRunState(web({ pr: { number: 7, url: 'u' }, mergeOutcome: 'withheld' }), NOW), 'done')
})

test('only a web run whose local half is over has a cloud state; every other run keeps its status', () => {
  assert.equal(cloudRunState(web({ target: 'local' }), NOW), undefined)
  assert.equal(cloudRunState(web({ target: 'actions' }), NOW), undefined)
  assert.equal(cloudRunState(web({ status: 'running' }), NOW), undefined)
  assert.equal(cloudRunState(web({ status: 'stopped' }), NOW), undefined)
  assert.equal(cloudRunState(web({ status: 'failed', cloudWaiting: true }), NOW), undefined)
})

test('in cloud and waiting count as an agent at work; the settled states do not', () => {
  assert.equal(cloudRunActive('in-cloud'), true)
  assert.equal(cloudRunActive('waiting'), true)
  for (const state of ['merged', 'done', undefined] as const) assert.equal(cloudRunActive(state), false)
})
