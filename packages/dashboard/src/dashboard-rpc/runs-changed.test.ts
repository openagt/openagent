import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { followRunsChanged, type RunsChanged } from './runs-changed.js'
import { provideTestContext, testDashboardContext } from './test-context.js'
import { elsewhereId } from '../dashboard/elsewhere.js'
import { SESSIONS_ID } from '../project-address.js'
import { sessionsHome } from '@openagt/agent-data'

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
      // The sessions with no project are followed on the machines as well; another computer's project has no runs here to follow.
      followRuns: path => {
        if (path === sessionsHome()) return () => {}
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

test('the sessions with no project are followed on the saved machines too, in their home, under their one name', async () => {
  const home = sessionsHome()
  const followed: string[] = []
  let changed: (() => void) | undefined
  const base = testDashboardContext()
  provideTestContext({
    remote: {
      ...base.remote,
      elsewhere: async () => [],
      // The suite's files share one list of projects: one another file adds meanwhile is followed too, and is none of this test's.
      followRuns: (path, change) => {
        followed.push(path)
        if (path === home) changed = change
        return () => {}
      },
    },
  })
  const told: RunsChanged[] = []
  const stop = followRunsChanged(change => told.push(change))
  for (let i = 0; i < 50 && changed === undefined; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(followed.includes(home), 'the sessions\' home is followed')
  changed!()
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepEqual(told, [{ kind: 'runs', projectId: SESSIONS_ID }])
  stop()
})
