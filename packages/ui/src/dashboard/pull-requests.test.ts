import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cachedOpenPrs, cachedPrStates, cachedPrView, cachedPrsForBranch, forgetBranchPrs, forgetPr, linkedPrOf, onPrMoved, openPrOf, openPrs, prStates, prView, prsForBranch, prsForBranchOrThrow, type OpenPr } from './pull-requests.js'
import type { GitHostFor, GitHostRequest, RequestsOutcome } from '../store/git-host.js'

// The dashboard's pull request reads (#1820), all through the git host provider: what is asked of it,
// what is kept of the answer, and which reads forgive a git host that could not answer and which
// must not.

const REQUEST: GitHostRequest = { number: 2, url: 'https://github.com/o/r/pull/2', state: 'open', title: 'Add a LICENSE file', draft: false, branch: 'agent-thing', head: 'f1789c5ebaab4cfb79e4ea214508daee147a4092', createdAt: '2026-08-21T10:47:50Z' }

/** A git host whose `requests` answers as told and records what it was asked. */
function fakeGitHost(answer: RequestsOutcome): { gitHost: GitHostFor; asked: unknown[] } {
  const asked: unknown[] = []
  const gitHost: GitHostFor = async () => ({
    requests: async opts => {
      asked.push(opts)
      return answer
    },
    open: async () => ({ ok: false, error: 'not here' }),
    merge: async () => ({ ok: false, error: 'not here' }),
    bring: async () => ({ ok: false, error: 'not here' }),
    home: async () => undefined,
    me: async () => undefined,
    people: async () => [],
  })
  return { gitHost, asked }
}
const noGitHost: GitHostFor = async () => undefined

test('a request is kept as OpenAgent\'s own shape: the state upper-cased, the head as the commit, and a field the git host did not answer absent rather than undefined-valued', () => {
  assert.deepEqual(linkedPrOf(REQUEST), { number: 2, url: 'https://github.com/o/r/pull/2', state: 'OPEN', title: 'Add a LICENSE file', createdAt: '2026-08-21T10:47:50Z', headRefOid: 'f1789c5ebaab4cfb79e4ea214508daee147a4092' })
  // "We do not know" must stay distinguishable from "it has none": the CI-age decision reads createdAt (#1334).
  const bare = linkedPrOf({ ...REQUEST, createdAt: '', head: '' })
  assert.ok(!('createdAt' in bare) && !('headRefOid' in bare))
  assert.equal(linkedPrOf({ ...REQUEST, armed: true }).armed, true)
  assert.ok(!('armed' in linkedPrOf(REQUEST)))
  assert.deepEqual(openPrOf({ ...REQUEST, draft: true }), { number: 2, title: 'Add a LICENSE file', url: 'https://github.com/o/r/pull/2', isDraft: true, headRefName: 'agent-thing', createdAt: '2026-08-21T10:47:50Z' })
})

test('a branch\'s history asks the git host for every state of that branch; the newest is the branch\'s PR; a project with no git host has none', async () => {
  const { gitHost, asked } = fakeGitHost({ ok: true, requests: [REQUEST, { ...REQUEST, number: 1, state: 'merged' }] })
  assert.deepEqual((await prsForBranch('/repo', 'agent-thing', gitHost)).map(pr => pr.number), [2, 1])
  assert.deepEqual(asked, [{ branch: 'agent-thing', state: 'all' }])
  assert.equal((await prView('/repo', 'agent-thing', gitHost))?.number, 2)
  assert.deepEqual(await prsForBranch('/repo', 'agent-thing', noGitHost), [])
  assert.deepEqual(await prsForBranchOrThrow('/repo', 'agent-thing', noGitHost), [], 'no git host: truthfully no PRs, not a failure')
  assert.deepEqual(await cachedPrView('/repo'), { value: undefined, pending: false }, 'no branch to ask about answers nothing at once')
})

test('a git host that could not answer reads as no history for the panels, and as a failure for a caller about to open a PR (#1601)', async () => {
  const { gitHost } = fakeGitHost({ ok: false, error: 'gh: not authenticated' })
  assert.deepEqual(await prsForBranch('/repo', 'agent-thing', gitHost), [])
  await assert.rejects(prsForBranchOrThrow('/repo', 'agent-thing', gitHost), /not authenticated/)
})

test('the open PRs are asked by state; a git host that could not answer is a failure, never an empty queue (#1623); a project with no git host has none open', async () => {
  const { gitHost, asked } = fakeGitHost({ ok: true, requests: [{ ...REQUEST, number: 3, title: 'a fix' }] })
  assert.deepEqual((await openPrs('/repo', gitHost)).map(pr => pr.number), [3])
  assert.deepEqual(asked, [{ state: 'open' }])
  await assert.rejects(openPrs('/repo', fakeGitHost({ ok: false, error: 'gh: not authenticated' }).gitHost))
  assert.deepEqual(await openPrs('/repo', noGitHost), [])
})

test('how a project\'s PRs stand, with their titles, is one listing of every state, by number; an open draft reads as a draft; a git host that could not answer is a failure, so the last states are kept; no git host, no states', async () => {
  const { gitHost, asked } = fakeGitHost({
    ok: true,
    requests: [REQUEST, { ...REQUEST, number: 3, url: 'https://github.com/o/r/pull/3', draft: true, title: 'Dark mode' }, { ...REQUEST, number: 4, url: 'https://github.com/o/r/pull/4', state: 'merged' }, { ...REQUEST, number: 5, url: 'https://github.com/o/r/pull/5', state: 'closed', draft: true }],
  })
  const url = (n: number) => `https://github.com/o/r/pull/${n}`
  const states = await prStates('/repo', gitHost)
  assert.deepEqual([...states].map(([at, pr]) => [at, pr.state]), [[url(2), 'open'], [url(3), 'draft'], [url(4), 'merged'], [url(5), 'closed']])
  assert.equal(states.get(url(3))!.title, 'Dark mode')
  assert.deepEqual(asked, [{ state: 'all' }])
  await assert.rejects(prStates('/repo', fakeGitHost({ ok: false, error: 'gh: not authenticated' }).gitHost), /not authenticated/)
  assert.equal((await prStates('/repo', noGitHost)).size, 0)
})

test('the cached states: a failed listing is kept as the states last read, so the git host is not asked at every poll; after a request was opened here, the rows keep their states while the next read is on its way', async () => {
  const cwd = '/repo-states'
  const url = 'https://github.com/o/r/pull/41'
  let calls = 0
  let answer: () => Promise<RequestsOutcome> = async () => ({ ok: true, requests: [{ ...REQUEST, number: 41, url, title: 'A fix' }] })
  const gitHost: GitHostFor = async () => ({ ...(await fakeGitHost({ ok: true, requests: [] }).gitHost('/'))!, requests: () => (calls++, answer()) })
  const said = async () => (await cachedPrStates(cwd, gitHost)).get(url)?.state
  assert.equal(await said(), 'open')
  // Opened or merged here: the states are forgotten, and the next read is slow. The rows keep what they had.
  forgetPr(cwd, 'agent-x')
  answer = () => new Promise(resolve => setTimeout(() => resolve({ ok: true, requests: [{ ...REQUEST, number: 41, url, state: 'merged' }] }), 400))
  assert.equal(await said(), 'open')
  await new Promise(resolve => setTimeout(resolve, 450))
  assert.equal(await said(), 'merged')
  // A git host that cannot answer: its failure is kept like an answer, as the last states, and not asked again at once.
  forgetPr(cwd, 'agent-x')
  answer = async () => ({ ok: false, error: 'gh: not authenticated' })
  const before = calls
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(await said(), 'merged')
  await cachedPrStates(cwd, gitHost)
  await cachedPrStates(cwd, gitHost)
  assert.equal(calls, before + 1, 'one ask, then the kept answer')
})

test("a request merged is merged everywhere at once: the session's own read and the rows of the runs say what the newest read of it says, whichever was read last, and a read that moved one tells whoever listens", async () => {
  const cwd = '/repo-together'
  const url = 'https://github.com/o/r/pull/77'
  const request: GitHostRequest = { ...REQUEST, number: 77, url, branch: 'agent-together', title: 'Image paste' }
  const saying = (state: GitHostRequest['state']) => fakeGitHost({ ok: true, requests: [{ ...request, state }] }).gitHost
  let moved = 0
  const stop = onPrMoved(() => moved++)
  try {
    // Both read while it was open, each cached on its own clock.
    assert.equal((await cachedPrStates(cwd, saying('open'))).get(url)?.state, 'open')
    assert.equal((await cachedPrsForBranch(cwd, 'agent-together', saying('open'))).value?.[0]?.state, 'OPEN')
    assert.equal((await cachedOpenPrs(cwd, async () => [openPrOf(request)])).length, 1)
    assert.equal(moved, 0, 'nothing moved yet')
    // Merged on the git host; the session's page reads its branch first. The listing is not read
    // again before its minute is up, yet its row says merged with the header.
    forgetBranchPrs(cwd, 'agent-together')
    assert.equal((await cachedPrsForBranch(cwd, 'agent-together', saying('merged'))).value?.[0]?.state, 'MERGED')
    assert.equal((await cachedPrStates(cwd, saying('open'))).get(url)?.state, 'merged')
    assert.deepEqual(await cachedOpenPrs(cwd, async () => [openPrOf(request)]), [], 'off the queue of open requests too')
    assert.equal(moved, 1, 'the page is told, so every place reads again together')
    // And the other way: the listing reads it closed first, and the branch's cached read says so too.
    forgetPr(cwd)
    assert.equal((await cachedPrStates(cwd, saying('closed'))).get(url)?.state, 'closed')
    assert.equal((await cachedPrsForBranch(cwd, 'agent-together', saying('merged'))).value?.[0]?.state, 'CLOSED')
    assert.equal(moved, 2)
  } finally {
    stop()
  }
})

test('an answer from a read asked before another is never newer than it, however late it comes', async () => {
  const url = 'https://github.com/o/r/pull/88'
  const request: GitHostRequest = { ...REQUEST, number: 88, url, branch: 'agent-late' }
  let release: (outcome: RequestsOutcome) => void = () => {}
  const slow: GitHostFor = async () => ({ ...(await fakeGitHost({ ok: true, requests: [] }).gitHost('/'))!, requests: () => new Promise(resolve => (release = resolve)) })
  // The listing is asked while the request is open, and answers only after the branch's read found it merged.
  const listing = prStates('/repo-late', slow)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal((await cachedPrsForBranch('/repo-late', 'agent-late', fakeGitHost({ ok: true, requests: [{ ...request, state: 'merged' }] }).gitHost)).value?.[0]?.state, 'MERGED')
  release({ ok: true, requests: [request] })
  await listing
  assert.equal((await cachedPrStates('/repo-late', slow)).get(url)?.state, 'merged')
})

test('the open requests for the Human Queue: the first ask waits for them, the next ones are the list last read, and a request opened or merged here reads them again; a first read that fails is a failure', async () => {
  const cwd = '/repo-open'
  let calls = 0
  let answer: () => Promise<OpenPr[]> = () => new Promise(resolve => setTimeout(() => resolve([{ number: 1, title: 'one', url: 'u/1', isDraft: false }]), 300))
  const read = () => (calls++, answer())
  assert.deepEqual((await cachedOpenPrs(cwd, read)).map(pr => pr.number), [1], 'a slow first answer is waited for, never an empty queue')
  answer = async () => [{ number: 1, title: 'one', url: 'u/1', isDraft: false }, { number: 2, title: 'two', url: 'u/2', isDraft: false }]
  assert.deepEqual((await cachedOpenPrs(cwd, read)).map(pr => pr.number), [1], 'the list last read')
  assert.equal(calls, 1)
  forgetPr(cwd, 'agent-x')
  assert.deepEqual((await cachedOpenPrs(cwd, read)).map(pr => pr.number), [1, 2], 'read again once a request was opened or merged here')
  await assert.rejects(cachedOpenPrs('/repo-open-never', () => Promise.reject(new Error('gh: not authenticated'))))
})
