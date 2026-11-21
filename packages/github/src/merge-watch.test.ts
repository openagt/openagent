import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readPr, watchAndMerge } from './merge-watch.js'
import type { GhRunner } from './gh.js'

// The watcher with gh scripted: what each read of the request says, and what the watcher does
// about it. A clock that moves one interval per sleep, so hours pass in no time.

function scripted(views: unknown[]): { gh: GhRunner; merges: string[][] } {
  const merges: string[][] = []
  let i = 0
  const gh: GhRunner = async args => {
    if (args[1] === 'merge') {
      merges.push(args)
      return ''
    }
    const view = views[Math.min(i++, views.length - 1)]
    if (view instanceof Error) throw view
    return JSON.stringify(view)
  }
  return { gh, merges }
}

function clock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0
  return { now: () => t, sleep: async ms => { t += ms } }
}

const run = (name: string, status: string, conclusion = '') => ({ name, status, conclusion })

test('checks: runs and classic statuses; skipped and neutral pass, cancelled fails, an unreadable read is pending', async () => {
  const read = (view: unknown) => readPr('/repo', 1, scripted([view]).gh)
  assert.equal((await read({ state: 'OPEN', statusCheckRollup: [run('build', 'COMPLETED', 'SUCCESS'), run('lint', 'COMPLETED', 'SKIPPED'), { context: 'ci/x', state: 'SUCCESS' }] })).checks, 'passing')
  assert.equal((await read({ state: 'OPEN', statusCheckRollup: [run('build', 'IN_PROGRESS'), run('lint', 'COMPLETED', 'SUCCESS')] })).checks, 'pending')
  assert.equal((await read({ state: 'OPEN', statusCheckRollup: [{ context: 'ci/x', state: 'PENDING' }] })).checks, 'pending')
  assert.deepEqual(await read({ state: 'OPEN', statusCheckRollup: [run('build', 'COMPLETED', 'CANCELLED'), run('lint', 'IN_PROGRESS')] }), { state: 'OPEN', checks: 'failing', failed: ['build'] })
  assert.equal((await read({ state: 'OPEN', statusCheckRollup: [] })).checks, 'none')
  assert.equal((await readPr('/repo', 1, scripted([new Error('gh: not logged in')]).gh)).checks, 'pending')
})

test('pending, then green: merged once, squashed', async () => {
  const { gh, merges } = scripted([
    { state: 'OPEN', statusCheckRollup: [run('build', 'IN_PROGRESS')] },
    { state: 'OPEN', statusCheckRollup: [run('build', 'IN_PROGRESS')] },
    { state: 'OPEN', statusCheckRollup: [run('build', 'COMPLETED', 'SUCCESS')] },
  ])
  assert.deepEqual(await watchAndMerge('/repo', 9, { gh, ...clock() }), { outcome: 'merged' })
  assert.deepEqual(merges, [['pr', 'merge', '9', '--squash']])
})

test('red, closed meanwhile, or pending past the limit: nothing is merged', async () => {
  const red = scripted([{ state: 'OPEN', statusCheckRollup: [run('build', 'COMPLETED', 'FAILURE')] }])
  assert.deepEqual(await watchAndMerge('/repo', 9, { gh: red.gh, ...clock() }), { outcome: 'checks-failed', failed: ['build'] })
  const closed = scripted([{ state: 'MERGED', statusCheckRollup: [] }])
  assert.deepEqual(await watchAndMerge('/repo', 9, { gh: closed.gh, ...clock() }), { outcome: 'closed', state: 'MERGED' })
  const stuck = scripted([{ state: 'OPEN', statusCheckRollup: [run('build', 'QUEUED')] }])
  assert.deepEqual(await watchAndMerge('/repo', 9, { gh: stuck.gh, ...clock(), forMs: 10 * 60_000 }), { outcome: 'timed-out' })
  for (const s of [red, closed, stuck]) assert.deepEqual(s.merges, [])
})

test('no checks: the grace passes first, then it is green; a merge gh refuses is said', async () => {
  const none = scripted([{ state: 'OPEN', statusCheckRollup: [] }])
  const c = clock()
  assert.deepEqual(await watchAndMerge('/repo', 9, { gh: none.gh, ...c, everyMs: 30_000, graceMs: 120_000 }), { outcome: 'merged' })
  assert.equal(c.now(), 120_000, 'it waited the grace out')

  const refused: GhRunner = async args => {
    if (args[1] === 'merge') throw new Error('Pull request is not mergeable: the merge commit cannot be cleanly created')
    return JSON.stringify({ state: 'OPEN', statusCheckRollup: [run('build', 'COMPLETED', 'SUCCESS')] })
  }
  assert.deepEqual(await watchAndMerge('/repo', 9, { gh: refused, ...clock() }), { outcome: 'failed', error: 'Pull request is not mergeable: the merge commit cannot be cleanly created' })
})
