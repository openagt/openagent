import { strict as assert } from 'node:assert'
import { mock, test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId, sessionsHome } from '@openagt/agent-data'
import { followRunsChanged, type RunsChanged } from './runs-changed.js'
import { ownRunsWatch } from '../dashboard/runs-watch.js'
import { prStates, prsForBranch } from '../dashboard/pull-requests.js'
import type { GitHostFor, GitHostRequest } from '../store/git-host.js'
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

test('the page is told when a read finds a pull request moved, once for the reads that find it together', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-prs-changed-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  const follow = mock.method(ownRunsWatch, 'follow', () => () => {})
  const request: GitHostRequest = { number: 5, url: 'https://github.com/o/r/pull/5', state: 'open', title: 'A fix', draft: false, branch: 'agent-five', head: '', createdAt: '' }
  const saying = (state: GitHostRequest['state']): GitHostFor => async () => ({
    requests: async () => ({ ok: true, requests: [{ ...request, state }] }),
    open: async () => ({ ok: false, error: 'not here' }),
    merge: async () => ({ ok: false, error: 'not here' }),
    bring: async () => ({ ok: false, error: 'not here' }),
    home: async () => undefined,
    people: async () => [],
  })
  try {
    const told: RunsChanged[] = []
    const stop = followRunsChanged(change => told.push(change))
    await prsForBranch('/repo', 'agent-five', saying('open'))
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.deepEqual(told, [], 'read for the first time: nothing moved')
    await prsForBranch('/repo', 'agent-five', saying('merged'))
    await prStates('/repo', saying('merged'))
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.deepEqual(told, [{ kind: 'prs' }])
    stop()
    await prsForBranch('/repo', 'agent-five', saying('closed'))
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(told.length, 1, 'no more once it stops listening')
  } finally {
    follow.mock.restore()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
