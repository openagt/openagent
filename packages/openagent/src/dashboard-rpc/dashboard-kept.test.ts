import assert from 'node:assert/strict'
import { test } from 'node:test'
import { onDashboard } from './reads.js'
import { provideTestContext } from './test-context.js'

// The Overview's summary reads every project's queue and tickets through their packages, a second
// and more on a small server: a page is answered at once with the last summary, built again behind it.

test('the summary is answered from the last one built for the same projects, and the next ask has the one built behind it', async () => {
  provideTestContext()
  const first = await onDashboard()
  const kept = await onDashboard()
  assert.equal(kept, first)
  await new Promise(resolve => setTimeout(resolve, 50))
  const anew = await onDashboard()
  assert.notEqual(anew, first)
  assert.deepEqual(anew, first)
})
