import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { deleteProjectAgent } from './worktrees.js'
import { nodeGitRunner } from '@openagt/agent-data'
import { runFiles, writeRun } from '@openagt/agent-driver'
import { addWorktree, agentBranchName } from '@openagt/git-branches'
import { handDownTestDistribution } from './test-distribution.js'

handDownTestDistribution()

// The dashboard's Delete of a session: its record, and the checkout with it. Removing a kept checkout alone is git-branches' (its Remove worktree), and tested there.
// Against real git, because "was the diff actually destroyed" is not a question a fake answers.

const RUN_ID = 'run1'

/**
 * A repo whose retained worktree holds an uncommitted edit, as a failed agent leaves one, with a bare
 * repo standing in for `origin` — real, since whether the work reached it is the whole subject.
 */
async function repoWithDirtyWorktree(opts: { remote?: boolean } = {}): Promise<{ repo: string; path: string; branch: string }> {
  const git = nodeGitRunner()
  // realpath so the mkdtemp path matches what git reports (the /var -> /private/var symlink).
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'openagent-worktrees-')))
  await git(['init'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'index.html'), '<h1>Hello, world!</h1>\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-m', 'init'], repo)
  if (opts.remote !== false) {
    await git(['init', '-q', '--bare', join(repo, 'origin.git')], repo)
    await git(['remote', 'add', 'origin', join(repo, 'origin.git')], repo)
  }
  const { path, branch } = await addWorktree(repo, { agentId: RUN_ID, branch: agentBranchName(RUN_ID) }, git)
  await writeFile(join(path, 'index.html'), '<h1>Welcome!</h1>\n')
  return { repo, path, branch }
}

/**
 * Record a run the way a run's tool does, with agent-driver's record, which every project's
 * runs provider reads. The two files that put its row in the rail.
 */
async function recordRun(repo: string, id: string): Promise<{ card: string; diary: string }> {
  const written = await writeRun(repo, { id, startedAt: '2026-01-01T00:00:00.000Z', status: 'stopped' }, [{ kind: 'ended', status: 'stopped' }])
  assert.ok(written.ok || written.committed, 'the record landed')
  return (await runFiles(repo, id))!
}

test('deleting a record-only session (its worktree already gone) still clears the row (#1032)', async () => {
  const { repo } = await repoWithDirtyWorktree()
  try {
    const { card: meta } = await recordRun(repo, 'run-x')
    // No worktree on disk — a clean finished agent, or one already removed. Delete must not need one.
    assert.deepEqual(await deleteProjectAgent(repo, 'run-x'), { ok: true })
    await assert.rejects(() => stat(meta), 'the record is gone')
    // Deleted through the runs provider: the second delete finds no record and is still fine.
    assert.deepEqual(await deleteProjectAgent(repo, 'run-x'), { ok: true })
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('deleting an agent whose checkout holds uncommitted work discards the work with the checkout and keeps the branch (#1032/#1774)', async () => {
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await recordRun(repo, RUN_ID)
    assert.deepEqual(await deleteProjectAgent(repo, RUN_ID), { ok: true })
    await assert.rejects(() => stat(path), 'the checkout is gone, uncommitted edit and all')
    assert.equal((await git(['rev-parse', '--verify', `refs/heads/${branch}`], repo)).trim().length, 40, 'the branch stays: it is git\'s, not the dashboard\'s')
    // The record's deletion is a pushed change on the data branch; the work itself is not: the agent's branch never reaches origin.
    assert.equal((await git(['ls-remote', '--heads', 'origin', branch], repo)).trim(), '', 'the branch was not pushed on the way out')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('an invalid session id is refused before anything is touched (#1032)', async () => {
  const result = await deleteProjectAgent('/nowhere', '../etc/passwd')
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.error : '', /invalid session id/)
})
