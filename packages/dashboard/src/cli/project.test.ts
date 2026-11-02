import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repositoryOf } from './project.js'

test('the project is the repository the folder is in, by its top folder; outside one there is none', async () => {
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'openagent-cli-')))
  const repo = join(outside, 'app')
  try {
    await mkdir(join(repo, 'src'), { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: repo })
    assert.equal(await repositoryOf(repo), repo)
    assert.equal(await repositoryOf(join(repo, 'src')), repo)
    assert.equal(await repositoryOf(outside), undefined)
  } finally {
    await rm(outside, { recursive: true, force: true })
  }
})
