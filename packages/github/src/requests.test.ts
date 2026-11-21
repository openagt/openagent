import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { listRequests, openRequestOf, parseRequests, requestsArgs, sinceFilter } from './requests.js'
import type { GhRunner } from './gh.js'

// One read for every question about pull requests: what is asked of gh, and what comes back.

const row = (over: Record<string, unknown> = {}) => ({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'T', isDraft: false, headRefName: 'agent-x', headRefOid: 'abc', createdAt: '2026-09-20T10:00:00Z', mergedAt: null, mergeCommit: null, autoMergeRequest: null, ...over })

test('the query becomes one gh listing: state (all by default), head branch, the limit, the fields', () => {
  assert.deepEqual(requestsArgs({}), ['pr', 'list', '--state', 'all', '--limit', '50', '--json', 'number,url,state,title,isDraft,headRefName,headRefOid,createdAt,mergedAt,mergeCommit,autoMergeRequest'])
  assert.deepEqual(requestsArgs({ branch: 'agent-x', state: 'open' }).slice(0, 6), ['pr', 'list', '--state', 'open', '--head', 'agent-x'])
})

test("gh's rows become requests: states lowercased, the head as branch and sha, mergedAt and mergeCommit only when set; a row without number and url is none", () => {
  const [open, merged, closed] = parseRequests([row(), row({ number: 8, state: 'MERGED', mergedAt: '2026-09-21T00:00:00Z', mergeCommit: { oid: 'm8' }, isDraft: true }), row({ number: 9, state: 'CLOSED' }), { title: 'junk' }])
  assert.deepEqual(open, { number: 7, url: 'https://github.com/o/r/pull/7', state: 'open', title: 'T', draft: false, branch: 'agent-x', head: 'abc', createdAt: '2026-09-20T10:00:00Z' })
  assert.equal(merged?.state, 'merged')
  assert.equal(merged?.draft, true)
  assert.equal(merged?.mergedAt, '2026-09-21T00:00:00Z')
  assert.equal(merged?.mergeCommit, 'm8')
  assert.equal(closed?.state, 'closed')
  assert.equal(parseRequests([row(), { title: 'junk' }]).length, 1)
  assert.deepEqual(parseRequests('not a list'), [])
})

test('a request GitHub will merge by itself once its checks pass is armed; one without auto-merge is not', () => {
  const [armed, plain] = parseRequests([row({ autoMergeRequest: { enabledAt: '2026-11-15T10:00:00Z', mergeMethod: 'SQUASH' } }), row({ number: 8 })])
  assert.equal(armed?.armed, true)
  assert.equal(plain && 'armed' in plain, false)
})

test('--since keeps what was created at or after it, or merged at or after it when only merged ones are asked for', () => {
  const requests = parseRequests([row({ createdAt: '2026-09-19T00:00:00Z' }), row({ number: 8, createdAt: '2026-09-21T00:00:00Z', state: 'MERGED', mergedAt: '2026-09-22T00:00:00Z' }), row({ number: 9, createdAt: '2026-09-18T00:00:00Z', state: 'MERGED', mergedAt: '2026-09-23T00:00:00Z' })])
  assert.deepEqual(sinceFilter(requests, { since: '2026-09-21T00:00:00Z' }).map(r => r.number), [8])
  assert.deepEqual(sinceFilter(requests, { since: '2026-09-22T12:00:00Z', state: 'merged' }).map(r => r.number), [9])
  assert.equal(sinceFilter(requests, {}).length, 3)
})

test('a listing gh cannot answer throws, so none and could-not-tell never look alike; the open request of a branch reads as none then', async () => {
  const failing: GhRunner = async () => {
    throw new Error('gh: not logged in')
  }
  await assert.rejects(listRequests('/repo', {}, failing), /not logged in/)
  assert.equal(await openRequestOf('/repo', 'agent-x', failing), undefined)
  const one: GhRunner = async args => {
    assert.deepEqual(args.slice(2, 6), ['--state', 'open', '--head', 'agent-x'])
    return JSON.stringify([row()])
  }
  assert.deepEqual(await openRequestOf('/repo', 'agent-x', one), { number: 7, url: 'https://github.com/o/r/pull/7' })
})
