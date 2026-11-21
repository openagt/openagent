import { strict as assert } from 'node:assert'
import { mock, test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId, sessionsHome } from '@openagt/agent-data'
import { followRunsChanged, type RunsChanged } from './runs-changed.js'
import { ownRunsWatch } from '../dashboard/runs-watch.js'
import { addProject } from '../registry.js'
import { SESSIONS_ID } from '../project-address.js'

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
    await addProject(app, new Date().toISOString())
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
