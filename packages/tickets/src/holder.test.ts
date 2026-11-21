import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/agent-data'
import { holderOf } from './holder.js'

const git = nodeGitRunner()

test('the holder is AGENT_ID when the environment has it, else the current branch, and nobody when detached', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'holder-')))
  try {
    await git(['init', '-b', 'main'], repo)
    await git(['config', 'user.email', 's@s'], repo)
    await git(['config', 'user.name', 's'], repo)
    await writeFile(join(repo, 'README.md'), '# t\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'init'], repo)
    await git(['checkout', '-b', 'agent-x1'], repo)
    // The environment wins over the branch: the branch is renamed later, the id is not.
    assert.deepEqual(await holderOf(repo, git, { AGENT_ID: 'x1' }), { ok: true, holder: 'x1' })
    // An empty value is no id.
    assert.deepEqual(await holderOf(repo, git, { AGENT_ID: '  ' }), { ok: true, holder: 'agent-x1' })
    assert.deepEqual(await holderOf(repo, git, {}), { ok: true, holder: 'agent-x1' })
    await git(['checkout', '--detach'], repo)
    assert.deepEqual(await holderOf(repo, git, {}), { ok: false, reason: 'no-identity' })
    assert.deepEqual(await holderOf(repo, git, { AGENT_ID: 'x1' }), { ok: true, holder: 'x1' }, 'detached, but the process said who')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
