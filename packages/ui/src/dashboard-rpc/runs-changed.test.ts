import { strict as assert } from 'node:assert'
import { mock, test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId, sessionsHome } from '@openagt/agent-data'
import { followRunsChanged, type RunsChanged } from './runs-changed.js'
import { ownRunsWatch } from '../dashboard/runs-watch.js'
import { pullRequestsRead } from '../dashboard/pr-states.js'
import type { PullRequestState } from '@openagt/hooks'
import { listTestProject } from '../test-projects.js'
import { SESSIONS_ID } from '../project-address.js'
import { handDownTestDistribution } from '../test-distribution.js'

handDownTestDistribution()

test("the page is told when the runs of a project, or of the sessions with no project, change: once for changes that come together, and no more once it stops listening", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-runs-changed-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  // The runs' watch, stood in for: what each folder's change would call.
  const changed = new Map<string, () => void>()
  let stopped = 0
  const follow = mock.method(ownRunsWatch, 'follow', (path: string, change: () => void) => {
    changed.set(path, change)
    return () => void stopped++
  })
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    const app = join(dir, 'app')
    await mkdir(app)
    await listTestProject(app, new Date().toISOString())
    const told: RunsChanged[] = []
    const stop = followRunsChanged(change => told.push(change))
    for (let i = 0; i < 50 && changed.size < 2; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual([...changed.keys()].sort(), [app, sessionsHome()].sort())
    changed.get(app)!()
    changed.get(app)!()
    changed.get(sessionsHome())!()
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.deepEqual(told, [
      { kind: 'runs', projectId: projectId(app) },
      { kind: 'runs', projectId: SESSIONS_ID },
    ])
    stop()
    assert.equal(stopped, 2)
    changed.get(app)!()
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(told.length, 2)
  } finally {
    follow.mock.restore()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('the page is told when a module reads a pull request for the first time, or standing otherwise than before, once for the reads that come together', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-prs-changed-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  const follow = mock.method(ownRunsWatch, 'follow', () => () => {})
  const read = (state: PullRequestState) => pullRequestsRead([{ url: 'https://github.com/o/r/pull/5', state, title: 'A fix', branch: 'agent-five' }])
  try {
    const told: RunsChanged[] = []
    const stop = followRunsChanged(change => told.push(change))
    read('open')
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.deepEqual(told, [{ kind: 'prs' }], 'read for the first time: the rows have its state now')
    read('open')
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(told.length, 1, 'read as it was: nothing moved')
    read('merged')
    read('merged')
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.deepEqual(told, [{ kind: 'prs' }, { kind: 'prs' }])
    stop()
    read('closed')
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(told.length, 2, 'no more once it stops listening')
  } finally {
    follow.mock.restore()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
