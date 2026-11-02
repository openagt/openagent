import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { BridgeStarts, MAX_START_MODEL, MAX_START_PROMPT, START_CLAIM_TTL_MS, bridgeStarts, resetBridgeStarts } from './bridge-starts.js'

const INPUT = { repo: 'openagt/openagent', branch: 'main', prompt: 'Do the thing' }

test('a queued start carries the repo, branch and prompt (#1328)', () => {
  const starts = new BridgeStarts()
  const queued = starts.request(INPUT, new Date('2026-08-24T10:00:00Z'))
  assert.ok(typeof queued !== 'string', 'accepted')
  assert.equal(queued.repo, 'openagt/openagent')
  assert.equal(queued.branch, 'main')
  assert.equal(queued.prompt, 'Do the thing')
  assert.equal(queued.state, 'queued')
})

test('a queued start carries the model when the run named one, trimmed; a blank one is dropped and an absurd one refused (#1697)', () => {
  const starts = new BridgeStarts()
  const named = starts.request({ ...INPUT, model: ' sonnet ' })
  assert.ok(typeof named !== 'string')
  assert.equal(named.model, 'sonnet')
  const blank = starts.request({ ...INPUT, model: '   ' })
  assert.ok(typeof blank !== 'string')
  assert.equal(blank.model, undefined)
  assert.equal(starts.request({ ...INPUT, model: 'x'.repeat(MAX_START_MODEL + 1) }), `model must be at most ${MAX_START_MODEL} characters`)
})

test('a repo that is not owner/name is refused (#1328)', () => {
  const starts = new BridgeStarts()
  for (const repo of ['openagent', 'a/b/c', '../etc', 'owner/..', './x', 'owner/name; rm -rf /', '']) {
    assert.equal(typeof starts.request({ ...INPUT, repo }), 'string', `${JSON.stringify(repo)} refused`)
  }
  // A leading dot is legal in a real repo name, so only the all-dots segments are the traversal.
  assert.ok(typeof starts.request({ ...INPUT, repo: 'openagt/.github' }) !== 'string', 'owner/.github passes')
})

test('a branch that could act as syntax is refused (#1328)', () => {
  const starts = new BridgeStarts()
  for (const branch of ['a branch', 'main;whoami', '$(id)', '', 'x'.repeat(300)]) {
    assert.equal(typeof starts.request({ ...INPUT, branch }), 'string', `${JSON.stringify(branch)} refused`)
  }
  assert.ok(typeof starts.request({ ...INPUT, branch: 'cloud-1-abcd1234' }) !== 'string', 'a hand-off ref passes')
})

test('an empty or absurd prompt is refused, a whole hand-off prompt is not (#1328)', () => {
  const starts = new BridgeStarts()
  assert.equal(typeof starts.request({ ...INPUT, prompt: '   ' }), 'string')
  assert.equal(typeof starts.request({ ...INPUT, prompt: 'x'.repeat(MAX_START_PROMPT + 1) }), 'string')
  assert.ok(typeof starts.request({ ...INPUT, prompt: 'x'.repeat(50_000) }) !== 'string', 'the framing makes prompts long')
})

test('claiming hands out the oldest request, once (#1328)', () => {
  // The duplicate this prevents is a second cloud session on the user's account, not a stray row.
  const starts = new BridgeStarts()
  starts.request({ ...INPUT, prompt: 'first' }, new Date('2026-08-24T10:00:00Z'))
  starts.request({ ...INPUT, prompt: 'second' }, new Date('2026-08-24T10:01:00Z'))
  const now = new Date('2026-08-24T10:02:00Z')
  assert.equal(starts.claimNext(now)?.prompt, 'first')
  assert.equal(starts.claimNext(now)?.prompt, 'second')
  assert.equal(starts.claimNext(now), undefined, 'nothing left to hand out')
})

test('a claim nobody resolved goes back on the queue (#1328)', () => {
  // A tab closed mid-creation would otherwise brick its request for the life of the daemon.
  const starts = new BridgeStarts()
  starts.request(INPUT, new Date('2026-08-24T10:00:00Z'))
  const claimedAt = new Date('2026-08-24T10:00:01Z')
  assert.ok(starts.claimNext(claimedAt), 'claimed')
  const stillFresh = new Date(claimedAt.getTime() + START_CLAIM_TTL_MS - 1000)
  assert.equal(starts.claimNext(stillFresh), undefined, 'a live claim is honoured')
  const expired = new Date(claimedAt.getTime() + START_CLAIM_TTL_MS + 1000)
  assert.ok(starts.claimNext(expired), 'an expired claim is offered again')
})

test('a success records the session and its url (#1328)', () => {
  const starts = new BridgeStarts()
  const queued = starts.request(INPUT)
  assert.ok(typeof queued !== 'string')
  starts.claimNext()
  starts.resolve(queued.id, true, 'session_01ABC')
  const done = starts.get(queued.id)
  assert.equal(done?.state, 'created')
  assert.equal(done?.sessionId, 'session_01ABC')
  assert.equal(done?.url, 'https://claude.ai/code/session_01ABC')
})

test('success without a session id is recorded as a failure (#1328)', () => {
  // The run would have nowhere to point, so "created, location unknown" is not a usable outcome.
  const starts = new BridgeStarts()
  const queued = starts.request(INPUT)
  assert.ok(typeof queued !== 'string')
  starts.claimNext()
  starts.resolve(queued.id, true)
  assert.equal(starts.get(queued.id)?.state, 'failed')
})

test('only a claimed request can be resolved (#1328)', () => {
  // A tab that died after its claim expired must not overwrite the retry that replaced it.
  const starts = new BridgeStarts()
  const queued = starts.request(INPUT)
  assert.ok(typeof queued !== 'string')
  starts.resolve(queued.id, true, 'session_01ABC')
  assert.equal(starts.get(queued.id)?.state, 'queued', 'never claimed, so the report is ignored')
  starts.resolve('no-such-id', true, 'session_01ABC')
})

test('a failure keeps the extension note (#1328)', () => {
  const starts = new BridgeStarts()
  const queued = starts.request(INPUT)
  assert.ok(typeof queued !== 'string')
  starts.claimNext()
  starts.resolve(queued.id, false, undefined, 'no repo picker on the page')
  const failed = starts.get(queued.id)
  assert.equal(failed?.state, 'failed')
  assert.equal(failed?.note, 'no repo picker on the page')
})

test('the store is a singleton, and resettable for tests (#1328)', () => {
  resetBridgeStarts()
  assert.equal(bridgeStarts(), bridgeStarts())
  bridgeStarts().request(INPUT)
  assert.equal(bridgeStarts().list().length, 1)
  resetBridgeStarts()
  assert.equal(bridgeStarts().list().length, 0)
})
