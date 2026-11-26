import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GitRunner, RunFound } from '@openagt/hooks'
import type { Handoff } from '@openagt/git-branches'
import { prHandoffOf, readRunPr, requestText, type PrRead } from './handoff.js'
import type { GitHostFor, GitHostRequest, LinkedPr } from './pulls.js'

// The pull request of an ended run's work (#799), in the bar above its message box: which of its
// branch's requests is the run's, what the bar offers for it, and what a new one says. The
// branch's facts are given as git-branches would read them; the requests as GitHub would answer.

const HANDOFF: Handoff = {
  branch: 'agent/fix',
  exists: true,
  commits: [{ sha: 'c2'.padEnd(40, '0'), subject: 'Second' }, { sha: 'c1'.padEnd(40, '0'), subject: 'First' }] as Handoff['commits'],
  files: [{ path: 'a.ts', insertions: 3, deletions: 1 }] as Handoff['files'],
  insertions: 3,
  deletions: 1,
  empty: false,
  hasRemote: true,
  pushed: true,
  merged: false,
}
const OPEN: LinkedPr = { number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'Fix', headRefOid: HANDOFF.commits[0]!.sha }
const read = (over: Partial<PrRead> = {}, handoff: Partial<Handoff> = {}): PrRead => ({ at: { cwd: '/repo', branch: 'agent/fix', changedNothing: false }, handoff: { ...HANDOFF, ...handoff }, movedPast: false, onGithub: true, ...over })
const noCarries = async () => undefined

test('a branch with work no request has, on GitHub and committed, is offered a request; pushed or not is said', async () => {
  assert.deepEqual(await prHandoffOf(read(), noCarries), { open: { pushed: true, branch: 'agent/fix' } })
  assert.deepEqual(await prHandoffOf(read({}, { pushed: false }), noCarries), { open: { pushed: false, branch: 'agent/fix' } })
  // What a request into the default branch carries beyond the run's own work goes with the offer.
  const carries = { base: 'origin/feature', commits: 4, files: 6, insertions: 40, deletions: 2 }
  assert.deepEqual(await prHandoffOf(read(), async () => carries), { open: { pushed: true, branch: 'agent/fix', carries } })
})

test('no request is offered for work left uncommitted, a landed run, a gone, empty or merged branch, no remote, or a repository not on GitHub', async () => {
  for (const [over, handoff] of [
    [{}, { pendingFiles: ['a.ts'] }],
    [{}, { landed: true }],
    [{}, { exists: false }],
    [{}, { empty: true }],
    [{}, { merged: true }],
    [{}, { hasRemote: false }],
    [{ onGithub: false }, {}],
  ] as [Partial<PrRead>, Partial<Handoff>][]) {
    assert.deepEqual(await prHandoffOf(read(over, handoff), noCarries), {}, JSON.stringify([over, handoff]))
  }
  assert.deepEqual(await prHandoffOf(undefined), {})
})

test("the run's open request: its merge is offered; armed, it merges by itself; commits it does not have yet are pushed first", async () => {
  assert.deepEqual(await prHandoffOf(read({ pr: OPEN }), noCarries), { pr: OPEN, merge: true })
  assert.deepEqual(await prHandoffOf(read({ pr: { ...OPEN, armed: true } }), noCarries), { pr: { ...OPEN, armed: true }, armed: true })
  // The request's head is an earlier commit of the branch: the newer one is pushed into it.
  const behind = { ...OPEN, headRefOid: HANDOFF.commits[1]!.sha }
  assert.deepEqual(await prHandoffOf(read({ pr: behind }, { pushed: false }), noCarries), { pr: behind, update: true })
  // A branch that differs from origin because the request was updated on GitHub has nothing to push.
  const elsewhere = { ...OPEN, headRefOid: 'f'.repeat(40) }
  assert.deepEqual(await prHandoffOf(read({ pr: elsewhere }, { pushed: false }), noCarries), { pr: elsewhere, merge: true })
})

test('a merged or closed request is named and nothing offered; work committed past it is offered the next one', async () => {
  const merged = { ...OPEN, state: 'MERGED' }
  assert.deepEqual(await prHandoffOf(read({ pr: merged }), noCarries), { pr: merged })
  assert.deepEqual(await prHandoffOf(read({ pr: merged, movedPast: true }), noCarries), { pr: merged, open: { pushed: true, branch: 'agent/fix' } })
})

/** A git host answering the branch's requests as told, counting its reads. */
function hostAnswering(requests: GitHostRequest[]): { gitHost: GitHostFor; reads: () => number } {
  let reads = 0
  return { gitHost: async () => ({ requests: async () => (reads++, { ok: true, requests }) }), reads: () => reads }
}
const REQUEST: GitHostRequest = { number: 7, url: OPEN.url, state: 'open', title: 'Fix', draft: false, branch: 'agent/fix', head: OPEN.headRefOid!, createdAt: '2026-08-21T10:00:00Z' }
const run = (record: Record<string, unknown>): RunFound => ({ record: { status: 'done', branch: 'agent/fix', ...record } }) as unknown as RunFound
const deps = (gitHost: GitHostFor) => ({ gitHost, branch: async () => HANDOFF, onGithub: async () => true, git: (async () => '') as GitRunner })

test("the run's request is the one its record names, read live for its state; one GitHub no longer lists keeps its number", async () => {
  const { gitHost } = hostAnswering([{ ...REQUEST, state: 'merged' }])
  const found = await readRunPr('/repo-recorded', 'r1', run({ pr: { number: 7, url: OPEN.url } }), undefined, deps(gitHost))
  assert.equal(found?.pr?.state, 'MERGED')
  const gone = await readRunPr('/repo-unlisted', 'r1', run({ pr: { number: 9, url: 'https://github.com/o/r/pull/9' } }), undefined, deps(hostAnswering([]).gitHost))
  assert.deepEqual(gone?.pr, { number: 9, url: 'https://github.com/o/r/pull/9', state: 'UNKNOWN', title: '' })
})

test("with none recorded, the branch's open request is the run's, or one opened since the run started; an older closed one is a predecessor's", async () => {
  const startedAt = '2026-08-21T09:00:00Z'
  assert.equal((await readRunPr('/repo-open', 'r1', run({ startedAt }), undefined, deps(hostAnswering([REQUEST]).gitHost)))?.pr?.number, 7)
  const older: GitHostRequest = { ...REQUEST, state: 'closed', createdAt: '2026-08-20T10:00:00Z' }
  assert.equal((await readRunPr('/repo-older', 'r1', run({ startedAt }), undefined, deps(hostAnswering([older]).gitHost)))?.pr, undefined)
})

test('a repository not on GitHub asks GitHub for nothing, and a run with no branch and nothing landed has nothing to read', async () => {
  const { gitHost, reads } = hostAnswering([REQUEST])
  const found = await readRunPr('/repo-elsewhere', 'r1', run({}), undefined, { ...deps(gitHost), onGithub: async () => false })
  assert.equal(found?.onGithub, false)
  assert.equal(found?.pr, undefined)
  assert.equal(reads(), 0)
  assert.equal(await readRunPr('/repo-none', 'r1', run({}), undefined, { ...deps(gitHost), branch: async () => undefined }), undefined)
})

test("the requests read before the run ended are read again: they cannot know of the one it opened on its way out", async () => {
  const { gitHost, reads } = hostAnswering([REQUEST])
  await readRunPr('/repo-ended', 'r1', run({}), undefined, deps(gitHost))
  assert.equal(reads(), 1)
  // The same read again, the run not ended later than it: the answer kept is the answer.
  await readRunPr('/repo-ended', 'r1', run({ endedAt: '2000-01-01T00:00:00Z' }), undefined, deps(gitHost))
  assert.equal(reads(), 1)
  await readRunPr('/repo-ended', 'r1', run({ endedAt: new Date(Date.now() + 60_000).toISOString() }), undefined, deps(gitHost))
  assert.equal(reads(), 2)
})

test('a GitHub slower than the cache waits for is asked once: its answer is kept for the next read', async () => {
  let reads = 0
  const slow: GitHostFor = async () => ({ requests: async () => (reads++, await new Promise(resolve => setTimeout(resolve, 300)), { ok: true, requests: [REQUEST] }) })
  assert.equal((await readRunPr('/repo-slow', 'r1', run({}), undefined, deps(slow)))?.pr?.number, 7)
  assert.equal((await readRunPr('/repo-slow', 'r1', run({}), undefined, deps(slow)))?.pr?.number, 7)
  assert.equal(reads, 1)
})

test('a GitHub that does not answer is no "none": no request is offered, the read after it asks again, and a good answer is kept over a failed one', async () => {
  let answer: 'refuse' | 'one' = 'refuse'
  let reads = 0
  const flaky: GitHostFor = async () => ({ requests: async () => (reads++, answer === 'refuse' ? { ok: false as const, error: 'gh: connection reset' } : { ok: true as const, requests: [REQUEST] }) })
  const failed = await readRunPr('/repo-flaky', 'r1', run({}), undefined, deps(flaky))
  assert.equal(failed?.unread, true)
  assert.equal(failed?.pr, undefined)
  // As session 2026-11-26T00-43-44-681Z showed: its copy's open PR #10 read as none, and the bar offered Open PR.
  assert.deepEqual(await prHandoffOf(failed, noCarries), {})
  answer = 'one'
  const next = await readRunPr('/repo-flaky', 'r1', run({}), undefined, deps(flaky))
  assert.equal(next?.pr?.number, 7)
  assert.equal(next?.unread, undefined)
  assert.ok(reads >= 3, 'the failed read was kept for nobody')
})

test('a request a press opens is read from GitHub there and then, and one it cannot read is a refusal, never "none"', async () => {
  const refusing: GitHostFor = async () => ({ requests: async () => ({ ok: false, error: 'gh: not authenticated' }) })
  await assert.rejects(readRunPr('/repo-fresh', 'r1', run({}), undefined, { ...deps(refusing), fresh: true }), /not authenticated/)
})

test('a request of one commit is that commit: its subject the title, the rest of its message the body, less its co-authors', async () => {
  const git: GitRunner = async args => (args[0] === 'log' ? 'Fix the thing\n\nIt was broken.\n\nCloses #12\nCo-Authored-By: Claude <noreply@anthropic.com>\n' : '')
  const one = { ...HANDOFF, commits: [HANDOFF.commits[0]!] }
  assert.deepEqual(await requestText('/repo', 'r1', one, git), { title: 'Second', body: 'It was broken.\n\nCloses #12\n\nOpened from OpenAgent session `r1`.' })
  // A message git cannot read leaves the subject alone.
  assert.deepEqual(await requestText('/repo', 'r1', one, async () => Promise.reject(new Error('no'))), { title: 'Second', body: 'Opened from OpenAgent session `r1`.' })
})

test('a request of several commits lists them, oldest first, under the name the branch was given, else the branch', async () => {
  assert.deepEqual(await requestText('/repo', 'r1', { ...HANDOFF, name: 'Fix the login' }), { title: 'Fix the login', body: '- First\n- Second\n\nOpened from OpenAgent session `r1`.' })
  assert.equal((await requestText('/repo', 'r1', HANDOFF)).title, 'agent/fix')
})
