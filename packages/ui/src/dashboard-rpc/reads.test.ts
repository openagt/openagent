import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { onProjectFiles, onRunCheckout } from './reads.js'
import { provideTestContext } from './test-context.js'

// A project id nobody registered has no local path, so these reads have no checkout to answer
// from. They must say so — an empty list, null — rather than throwing.

test('onProjectFiles for an unknown project returns an empty list', async () => {
  provideTestContext()
  assert.deepEqual(await onProjectFiles('project-that-does-not-exist'), [])
})

test('onRunCheckout for an unknown project returns null', async () => {
  provideTestContext()
  assert.equal(await onRunCheckout('project-that-does-not-exist', '2026-07-19T10-00-00-000Z'), null)
})

test('onRunCheckout refuses a run id that could escape the worktrees dir', async () => {
  // The id names a directory, so it is guarded here as it is everywhere else it reaches a path.
  provideTestContext()
  assert.equal(await onRunCheckout('project-that-does-not-exist', '../../etc'), null)
})

