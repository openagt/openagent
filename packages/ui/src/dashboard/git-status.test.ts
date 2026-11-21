import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readGitStatus } from './git-status.js'
import type { GitRunner } from '@openagt/agent-data'
const gitWith =
  (branch: string, porcelain: string): GitRunner =>
  async args => {
    if (args[0] === 'rev-parse') return `${branch}\n`
    if (args[0] === 'status') return porcelain
    return ''
  }

test('readGitStatus reports branch, clean tree, and no PR', async () => {
  const status = await readGitStatus('/x', { git: gitWith('main', ''), pr: async () => undefined })
  assert.deepEqual(status, { branch: 'main', dirty: false })
})

test('readGitStatus flags a dirty tree and includes a linked PR', async () => {
  const pr = { number: 12, url: 'https://github.com/o/r/pull/12', state: 'OPEN', title: 'Add thing' }
  const status = await readGitStatus('/x', { git: gitWith('feat/x', ' M src/a.ts\n'), pr: async () => pr })
  assert.deepEqual(status, { branch: 'feat/x', dirty: true, pr })
})

test('readGitStatus returns undefined when the path is not a git repo', async () => {
  const status = await readGitStatus('/x', {
    git: async () => {
      throw new Error('not a git repository')
    },
    pr: async () => undefined,
  })
  assert.equal(status, undefined)
})

test('readGitStatus degrades to no PR when the lookup fails', async () => {
  const status = await readGitStatus('/x', {
    git: gitWith('main', ''),
    pr: async () => {
      throw new Error('gh not found')
    },
  })
  assert.deepEqual(status, { branch: 'main', dirty: false })
})

test('a run-scoped read does not wear a predecessor PR from a reused pinned branch (#1255)', async () => {
  // The default lookup is `gh pr view`, newest PR in any state — on `openagent/triage-quick`
  // that is a merged PR from a previous firing. With `since` the pick runs through pickAgentPr.
  const old = { number: 1177, url: 'https://x/1177', state: 'MERGED', title: 'old triage', createdAt: '2026-07-25T00:00:00Z' }
  const status = await readGitStatus('/repo', {
    git: gitWith('openagent/triage-quick', ''),
    since: '2026-07-27T14:38:59Z',
    prs: async () => [old],
  })
  assert.equal(status?.pr, undefined)
})

test('a run-scoped read still shows the run its own PR, open or just merged (#1255)', async () => {
  const since = '2026-07-27T14:38:59Z'
  const own = { number: 1301, url: 'https://x/1301', state: 'MERGED', title: 'this run', createdAt: '2026-07-27T15:00:00Z' }
  const older = { number: 1177, url: 'https://x/1177', state: 'MERGED', title: 'old triage', createdAt: '2026-07-25T00:00:00Z' }
  const status = await readGitStatus('/repo', {
    git: gitWith('openagent/triage-quick', ''),
    since,
    prs: async () => [own, older],
  })
  assert.equal(status?.pr?.number, 1301)

  const open = { number: 1302, url: 'https://x/1302', state: 'OPEN', title: 'open pr' }
  const withOpen = await readGitStatus('/repo', {
    git: gitWith('openagent/triage-quick', ''),
    since,
    prs: async () => [open, older],
  })
  assert.equal(withOpen?.pr?.number, 1302)
})

test('a failing history read degrades to no PR, like the plain lookup (#1255)', async () => {
  const status = await readGitStatus('/repo', {
    git: gitWith('main', ''),
    since: '2026-07-27T14:38:59Z',
    prs: async () => {
      throw new Error('gh is down')
    },
  })
  assert.equal(status?.pr, undefined)
  assert.equal(status?.prPending, undefined)
})
