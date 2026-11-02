import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { followRunsChanged, type RunsChanged } from './runs-changed.js'
import { provideTestContext, testDashboardContext } from './test-context.js'
import { elsewhereId } from '../dashboard/elsewhere.js'

test("the page is told when the runs of another computer's project change there, until it stops listening", async () => {
  const there = elsewhereId('shop-1abc', 'http://127.0.0.1:4210')
  const followed: string[] = []
  let changed: (() => void) | undefined
  let stopped = 0
  const base = testDashboardContext()
  provideTestContext({
    remote: {
      ...base.remote,
      elsewhere: async () => [{ id: there, path: '/Users/me/shop', name: 'shop', activated: true, gitHost: true, machine: 'http://127.0.0.1:4210' }],
      followElsewhereRuns: (project, change) => {
        followed.push(project)
        changed = change
        return () => void stopped++
      },
      followRuns: () => {
        throw new Error("another computer's project has no runs here to follow")
      },
    },
  })
  const told: RunsChanged[] = []
  const stop = followRunsChanged(change => told.push(change))
  for (let i = 0; i < 50 && changed === undefined; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(followed, [there])
  changed!()
  // Changes that come together are told once.
  changed!()
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepEqual(told, [{ kind: 'runs', projectId: there }])
  stop()
  assert.equal(stopped, 1)
})
