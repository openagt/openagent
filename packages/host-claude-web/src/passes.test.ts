import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { GhRunner } from '@openagt/github'
import { readDiary } from '@openagt/agent-driver'
import { UNMADE, anchorRefOf } from './hand-off.js'
import { passProject, type PassDeps } from './passes.js'
import { git, originHas, pushedStart, pushedWork, recorded, removeRepo, startOf, testRepo } from './test-support.js'
import { findWebRun } from './web-runs.js'

// What follows a web run once its hand-off is over: its session's branch and pull request found,
// its end, its start's branch deleted from origin, and a hand-off that ended with OpenAgent.

const ID = '2026-11-19T10-00-00-000Z'
const HOURS = 60 * 60 * 1000
/** A pass `hours` after the run's start. */
const at = (hours: number): Date => new Date(Date.parse(startOf(ID)) + hours * HOURS)
const PR = { number: 9, url: 'https://github.com/o/r/pull/9' }
const gh: GhRunner = async () => {
  throw new Error('no gh in these tests')
}

function deps(hours: number, over: PassDeps = {}): PassDeps & { lines: string[] } {
  const lines: string[] = []
  return { account: async () => ({ git, gh }), prOf: async () => undefined, host: 'laptop', now: () => at(hours), log: line => void lines.push(line), lines, ...over }
}

/** A project with a web run of this computer's whose session is made: its start on origin, and the session's branch descending from it unless `work` is false. */
async function withSession(body: (repo: string, anchor: string) => Promise<void>, work: string[] = ['claude/add-flag-x1']): Promise<void> {
  const repo = await testRepo()
  try {
    const anchor = await pushedStart(repo, anchorRefOf(ID))
    await recorded(repo, ID, {}, { sessionId: 'session_01S', anchor, anchorRef: anchorRefOf(ID), gitAccount: 'octo-agent' })
    for (const branch of work) await pushedWork(repo, anchor, branch)
    // Another session's branch, which never started at this run's start.
    await pushedWork(repo, 'main', 'claude/other-y2')
    await body(repo, anchor)
  } finally {
    await removeRepo(repo)
  }
}

test("the session's branch is the one of origin's claude/* that descends from the run's start; with its pull request, the run is done and its start's branch deleted (#1601, #1547)", () =>
  withSession(async (repo, anchor) => {
    const asked: string[] = []
    const pass = deps(1, { prOf: async (_dir, branch, since) => (asked.push(`${branch} since ${since}`), PR) })
    await passProject({ dir: repo }, pass)
    assert.deepEqual(asked, [`claude/add-flag-x1 since ${startOf(ID)}`])
    const run = await findWebRun(repo, ID)
    assert.deepEqual([run?.card.branch, run?.card.pr, run?.card.status, run?.card.endedAt], ['claude/add-flag-x1', PR, 'done', at(1).toISOString()])
    assert.deepEqual((await readDiary(repo, ID))?.at(-1), { kind: 'ended', status: 'done', at: at(1).toISOString() })
    // Its start's branch is gone from origin, and from the record; the start itself is kept.
    assert.equal(await originHas(repo, anchorRefOf(ID)), undefined)
    assert.deepEqual([run?.anchorRef, run?.anchor], [undefined, anchor])
    assert.deepEqual(pass.lines, [`[host-claude-web] web run ${ID}'s session works on claude/add-flag-x1, its pull request ${PR.url}`])
    // Nothing is left to learn: the next pass writes nothing.
    const diary = await readDiary(repo, ID)
    await passProject({ dir: repo }, deps(2, { prOf: async () => assert.fail('nothing is asked again') }))
    assert.deepEqual(await readDiary(repo, ID), diary)
  }))

test('before its session opened a pull request, the run is at work on the branch found; the pull request is the next pass’s question (#1601, #1668)', () =>
  withSession(async repo => {
    await passProject({ dir: repo }, deps(1))
    let run = await findWebRun(repo, ID)
    assert.deepEqual([run?.card.branch, run?.card.pr, run?.card.status], ['claude/add-flag-x1', undefined, 'running'])
    assert.equal(await originHas(repo, anchorRefOf(ID)), undefined, 'the start’s branch goes once the session’s is found')
    await passProject({ dir: repo }, deps(2, { prOf: async () => PR }))
    run = await findWebRun(repo, ID)
    assert.deepEqual([run?.card.pr, run?.card.status], [PR, 'done'])
  }))

test('two branches that descend from the start tell nothing apart: none is recorded, and the start’s branch is kept until a day has passed (#1601, #1547)', () =>
  withSession(
    async (repo, anchor) => {
      await passProject({ dir: repo }, deps(1))
      let run = await findWebRun(repo, ID)
      assert.deepEqual([run?.card.branch, run?.card.status, run?.anchorRef], [undefined, 'running', anchorRefOf(ID)])
      assert.equal(await originHas(repo, anchorRefOf(ID)), anchor)
      // Past the session window the run is over, with nothing learned; past a day its start's branch goes.
      await passProject({ dir: repo }, deps(13))
      run = await findWebRun(repo, ID)
      assert.deepEqual([run?.card.status, run?.anchorRef], ['done', anchorRefOf(ID)])
      await passProject({ dir: repo }, deps(25))
      assert.equal(await originHas(repo, anchorRefOf(ID)), undefined)
      assert.equal((await findWebRun(repo, ID))?.anchorRef, undefined)
    },
    ['claude/add-flag-x1', 'claude/add-flag-x2'],
  ))

test('a start’s branch a person pushed to is theirs: it is left on origin, and the record forgets it (#1547)', () =>
  withSession(
    async (repo, anchor) => {
      const theirs = await pushedWork(repo, anchor, anchorRefOf(ID))
      await passProject({ dir: repo }, deps(25))
      assert.equal(await originHas(repo, anchorRefOf(ID)), theirs)
      assert.equal((await findWebRun(repo, ID))?.anchorRef, undefined)
    },
    [],
  ))

test('a hand-off under way nowhere, its session never made, failed; a run of another computer is that computer’s to follow (#2394)', async () => {
  const repo = await testRepo()
  try {
    await recorded(repo, ID)
    await recorded(repo, '2026-11-19T10-00-01-000Z', {}, { host: 'desk' })
    await recorded(repo, '2026-11-19T10-00-02-000Z', {}, { host: 'desk', sessionId: 'session_01D', anchor: 'a'.repeat(40) })
    await passProject({ dir: repo }, deps(1, { account: async () => assert.fail('no account is needed for runs of another computer') }))
    assert.equal((await findWebRun(repo, ID))?.card.status, 'failed')
    assert.deepEqual((await readDiary(repo, ID))?.at(-1), { kind: 'ended', status: 'failed', detail: UNMADE, at: at(1).toISOString() })
    assert.equal((await findWebRun(repo, '2026-11-19T10-00-01-000Z'))?.card.status, 'running')
    assert.equal((await findWebRun(repo, '2026-11-19T10-00-02-000Z'))?.card.status, 'running')
  } finally {
    await removeRepo(repo)
  }
})

test('a pull request GitHub cannot list now is the next pass’s question; the branch found is recorded meanwhile (#1601)', () =>
  withSession(async repo => {
    const pass = deps(1, {
      prOf: async () => {
        throw new Error('gh: rate limited')
      },
    })
    await passProject({ dir: repo }, pass)
    const run = await findWebRun(repo, ID)
    assert.deepEqual([run?.card.branch, run?.card.pr, run?.card.status], ['claude/add-flag-x1', undefined, 'running'])
    assert.ok(pass.lines.some(line => line === '[host-claude-web] the pull requests of claude/add-flag-x1 could not be read: gh: rate limited'))
  }))
