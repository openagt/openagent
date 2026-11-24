import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onProjectFiles, onAgentMainBranch, onAgentWorktree } from './reads.js'
import { provideTestContext } from './test-context.js'
import { projectId } from '@openagt/agent-data'
import { listTestProject } from '../test-projects.js'

// A project id nobody registered has no local path, so these reads have no checkout to answer
// from. They must say so — an empty list, null — rather than throwing.

test('onProjectFiles for an unknown project returns an empty list', async () => {
  provideTestContext()
  assert.deepEqual(await onProjectFiles('project-that-does-not-exist'), [])
})

test('onAgentWorktree for an unknown project returns null', async () => {
  provideTestContext()
  assert.equal(await onAgentWorktree('project-that-does-not-exist', '2026-07-19T10-00-00-000Z'), null)
})

test('onAgentWorktree refuses a run id that could escape the worktrees dir', async () => {
  // The id names a directory, so it is guarded here as it is everywhere else it reaches a path.
  provideTestContext()
  assert.equal(await onAgentWorktree('project-that-does-not-exist', '../../etc'), null)
})

test('onAgentMainBranch names origin\'s default branch as the clone has it, by the rule a run\'s start goes by', async () => {
  provideTestContext()
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'main-branch-')))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
  try {
    const origin = join(dir, 'origin.git')
    git(dir, 'init', '-q', '--bare', '-b', 'trunk', origin)
    const seed = join(dir, 'seed')
    git(dir, 'init', '-q', '-b', 'trunk', seed)
    git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed')
    git(seed, 'remote', 'add', 'origin', origin)
    git(seed, 'push', '-q', 'origin', 'trunk')
    const clone = join(dir, 'clone')
    git(dir, 'clone', '-q', origin, clone)
    // What the folder has out says nothing of it.
    git(clone, 'checkout', '-q', '-b', 'mine')
    await listTestProject(clone, new Date().toISOString())
    assert.equal(await onAgentMainBranch(projectId(clone)), 'trunk')
    // No remote: nothing to name, not the branch the folder is on.
    const lone = join(dir, 'lone')
    git(dir, 'init', '-q', '-b', 'main', lone)
    git(lone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed')
    await listTestProject(lone, new Date().toISOString())
    assert.equal(await onAgentMainBranch(projectId(lone)), null)
    assert.equal(await onAgentMainBranch('project-that-does-not-exist'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
