import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId } from './project-id.js'
import { listedProjects, listProjects } from './distribution-hooks.js'
import { handDownTestDistribution } from './test-distribution.js'
import { listTestProject } from './test-projects.js'

handDownTestDistribution()

test("the modules are told this computer's projects whose folder is there, each as a hook is given it: the list the projects module keeps", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'openagent-listed-')))
  const before = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(home, 'cfg')
  const there = join(home, 'there')
  const gone = join(home, 'gone')
  try {
    await mkdir(there)
    execFileSync('git', ['init', '-q'], { cwd: there })
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'], { cwd: there })
    const at = new Date().toISOString()
    await listTestProject(there, at)
    await listTestProject(gone, at)
    assert.deepEqual((await listProjects()).map(project => project.path), [there, gone], 'the list, in the order the projects were added')
    const [project, ...more] = await listedProjects()
    assert.deepEqual(more, [], 'one whose folder is gone has nothing to run in')
    assert.equal(project?.id, projectId(there))
    assert.equal(project?.dir, there)
    assert.equal(project?.name, 'widgets', "its repository's name")
    assert.match(project?.remote ?? '', /acme\/widgets$/)
  } finally {
    if (before === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = before
    await rm(home, { recursive: true, force: true })
  }
})
