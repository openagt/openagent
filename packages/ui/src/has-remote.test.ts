import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasRemote } from './has-remote.js'

test('a repository has a remote only when one is named origin; a folder that is no repository has none', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-has-remote-')))
  try {
    assert.equal(await hasRemote(dir), false, 'no repository')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    assert.equal(await hasRemote(dir), false, 'a repository nobody shared')
    execFileSync('git', ['remote', 'add', 'upstream', 'https://example.com/x.git'], { cwd: dir })
    assert.equal(await hasRemote(dir), false, 'a remote under another name is none')
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/x.git'], { cwd: dir })
    assert.equal(await hasRemote(dir), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
