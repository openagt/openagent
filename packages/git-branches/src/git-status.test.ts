import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readGitStatus } from './git-status.js'
import type { GitRunner } from '@openagt/hooks'
const gitWith =
  (branch: string, porcelain: string): GitRunner =>
  async args => {
    if (args[0] === 'rev-parse') return `${branch}\n`
    if (args[0] === 'status') return porcelain
    return ''
  }

test('readGitStatus reports the branch and a clean tree', async () => {
  const status = await readGitStatus('/x', { git: gitWith('main', '') })
  assert.deepEqual(status, { branch: 'main', dirty: false })
})

test('readGitStatus flags a dirty tree', async () => {
  const status = await readGitStatus('/x', { git: gitWith('feat/x', ' M src/a.ts\n') })
  assert.deepEqual(status, { branch: 'feat/x', dirty: true })
})

test('readGitStatus returns undefined when the path is not a git repo', async () => {
  const status = await readGitStatus('/x', {
    git: async () => {
      throw new Error('not a git repository')
    },
  })
  assert.equal(status, undefined)
})
