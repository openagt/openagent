import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId } from '@openagt/agent-data'
import { listedProjects } from './distribution-hooks.js'
import { addProject } from './registry.js'

test("the modules are told this computer's projects whose folder is there, each as a hook is given it", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'openagent-listed-')))
  const env = { XDG_CONFIG_HOME: join(home, 'cfg') }
  const there = join(home, 'there')
  const gone = join(home, 'gone')
  try {
    await mkdir(there)
    execFileSync('git', ['init', '-q'], { cwd: there })
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'], { cwd: there })
    const at = new Date().toISOString()
    await addProject(there, at, env)
    await addProject(gone, at, env)
    const [project, ...more] = await listedProjects(env)
    assert.deepEqual(more, [], 'one whose folder is gone has nothing to run in')
    assert.equal(project?.id, projectId(there))
    assert.equal(project?.dir, there)
    assert.equal(project?.name, 'widgets', "its repository's name")
    assert.match(project?.remote ?? '', /acme\/widgets$/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
