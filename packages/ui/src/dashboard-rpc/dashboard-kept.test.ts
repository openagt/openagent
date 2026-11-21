import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { onDashboard } from './reads.js'
import { provideTestContext } from './test-context.js'

// The Overview's summary reads every project's queue and tickets through their packages, a second
// and more on a small server: a page is answered at once with the last summary, built again behind it.

test('the summary is answered from the last one built for the same projects, and the next ask has the one built behind it', async () => {
  // A registry of its own: a project another test file adds meanwhile would change the summary.
  const dir = await mkdtemp(join(tmpdir(), 'openagent-dashboard-kept-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  try {
    provideTestContext()
    const first = await onDashboard()
    const kept = await onDashboard()
    assert.equal(kept, first)
    await new Promise(resolve => setTimeout(resolve, 50))
    const anew = await onDashboard()
    assert.notEqual(anew, first)
    assert.deepEqual(anew, first)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
