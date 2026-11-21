import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile, stat } from 'node:fs/promises'
import { acquireRunLock, handOverRunLock, lockHolder, releaseRunLock, runLockPath } from './run-lock.js'
import { git, removeRepo, testRepo } from './test-repo.js'

// The run's lock on a real repository: one holder at a time, a dead holder holds nothing, a
// detached run's parent hands it to the run's process.

test('a free lock is taken; a live holder is waited for; a dead one holds nothing; its own pid is its own', async () => {
  const repo = await testRepo()
  try {
    const alive = new Set([10, 11])
    const isAlive = (pid: number) => alive.has(pid)
    await acquireRunLock(repo, 'r', { pid: 10, isAlive })
    assert.equal(await lockHolder(repo, 'r', isAlive), 10)
    await acquireRunLock(repo, 'r', { pid: 10, isAlive })

    let taken = false
    const waiting = acquireRunLock(repo, 'r', { pid: 11, isAlive, pollMs: 10 }).then(() => (taken = true))
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(taken, false, 'held by a live process')
    alive.delete(10)
    await waiting
    assert.equal(await lockHolder(repo, 'r', isAlive), 11, 'a dead holder is taken over')

    await releaseRunLock(repo, 'r', 10)
    assert.equal(await lockHolder(repo, 'r', isAlive), 11, 'only the holder lets it go')
    await releaseRunLock(repo, 'r', 11)
    assert.equal(await stat(runLockPath(repo, 'r')).then(() => true, () => false), false)
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '', 'the lock never dirties the tree')
  } finally {
    await removeRepo(repo)
  }
})

test("a parent hands the lock to the run's process; a hand-over from a process that does not hold it changes nothing", async () => {
  const repo = await testRepo()
  try {
    await acquireRunLock(repo, 'r', { pid: 20, isAlive: () => true })
    await handOverRunLock(repo, 'r', 99, 21)
    assert.equal((await readFile(runLockPath(repo, 'r'), 'utf8')).trim(), '20')
    await handOverRunLock(repo, 'r', 20, 21)
    assert.equal((await readFile(runLockPath(repo, 'r'), 'utf8')).trim(), '21')
    // The run's process finds its own pid there and goes on at once.
    await acquireRunLock(repo, 'r', { pid: 21, isAlive: () => true, pollMs: 60_000 })
  } finally {
    await removeRepo(repo)
  }
})
