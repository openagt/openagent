import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { deleteProjectAgent, removeProjectWorktree } from './worktrees.js'
import { nodeGitRunner } from '@openagt/agent-data'
import { runFiles, writeRun } from '@openagt/skill-logs'
import { addWorktree, agentBranchName } from '@openagt/skill-branches'
// The dashboard's side of reclaiming a checkout: when it may be asked for, and whose refusal is answered. The rule itself lives in the branches package, the project's branches provider here (#1774), and is tested there.
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

/** The agent commits its own work, as the system prompt tells it to (#1638). */
async function commitWork(path: string): Promise<void> {
  const git = nodeGitRunner()
  await git(['config', 'user.email', 't@t'], path)
  await git(['config', 'user.name', 't'], path)
  await git(['add', '-A'], path)
  await git(['commit', '-q', '-m', 'work'], path)
}

test('a worktree whose agent committed goes, remote or none, and its branch keeps the work (E5)', async () => {
  const { repo, path, branch } = await repoWithDirtyWorktree({ remote: false })
  const git = nodeGitRunner()
  try {
    await commitWork(path)
    assert.deepEqual(await removeProjectWorktree(repo, RUN_ID), { ok: true })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.match(await git(['show', `${branch}:index.html`], repo), /Welcome!/, 'the work is on its branch')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test("a branches/ directory that is not a git worktree is refused before any git runs in it (#1654)", async () => {
  // Found on the rig: a checkout removed by hand, then a failed-start marker written into the
  // path. Git, asked in that directory, answers for the enclosing repo — so the ordinary rule
  // would commit the user's main checkout, push the user's main, and judge it for deletion.
  const { repo, path: worktree } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    // Turn the run's checkout into residue: gone as a worktree, its directory holding only
    // OpenAgent's bookkeeping. And leave the user's own checkout dirty, which is what must survive.
    await git(['worktree', 'remove', '--force', worktree], repo)
    await mkdir(join(worktree, '.openagent'), { recursive: true })
    await writeFile(join(worktree, '.openagent', `${RUN_ID}.json`), JSON.stringify({ id: RUN_ID, startedAt: '2026-01-01T00:00:00.000Z', status: 'failed' }))
    await writeFile(join(repo, 'index.html'), '<h1>half-typed</h1>\n')
    const before = (await git(['rev-parse', 'HEAD'], repo)).trim()

    const result = await removeProjectWorktree(repo, RUN_ID)
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.error : '', /not a git worktree; left alone/)
    assert.equal((await git(['rev-parse', 'HEAD'], repo)).trim(), before, "nothing was committed on the user's checkout")
    assert.match(await git(['status', '--porcelain'], repo), /index\.html/, "the user's edit is still uncommitted")
    assert.equal((await git(['ls-remote', '--heads', 'origin'], repo)).trim(), '', 'and nothing was pushed')
    assert.equal((await stat(worktree)).isDirectory(), true, 'the directory is left where it is')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('the run-id branch the agent branched away from goes with the checkout when the kept branch contains it (#1657)', async () => {
  // OpenAgent names the checkout's birth branch to the rule; without it nothing would go.
  const { repo, path, branch: runBranch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await git(['checkout', '-q', '-b', 'agent-cool-name'], path)
    await commitWork(path)
    assert.deepEqual(await removeProjectWorktree(repo, RUN_ID), { ok: true, branchesDeleted: [runBranch] })
    assert.match(await git(['show', 'agent-cool-name:index.html'], repo), /Welcome!/, 'the work branch stays')
    await assert.rejects(() => git(['rev-parse', '--verify', 'refs/remotes/origin/agent-cool-name'], repo), 'not pushed')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/heads/${runBranch}`], repo), 'the run-id branch is gone')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('an unknown session is refused, in the provider\'s words, before any git runs (#982)', async () => {
  const { repo, path } = await repoWithDirtyWorktree()
  try {
    assert.deepEqual(await removeProjectWorktree(repo, 'nosuchrun'), {
      ok: false,
      error: 'no checkout for agent nosuchrun',
    })
    assert.equal((await stat(path)).isDirectory(), true, 'the real worktree is untouched')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test("a run started from another run's branch: the commit on its card is named to the rule, so a branch with nothing past it goes", async () => {
  // Without the commit the branch would be measured from the default branch, and what it started
  // on would read as its own: pushed and kept.
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path)
    await git(['push', '-q', 'origin', branch], path)
    const sub = await addWorktree(repo, { agentId: 'run2', branch: agentBranchName('run2'), base: branch }, git)
    const baseCommit = (await git(['rev-parse', 'HEAD'], sub.path)).trim()
    await mkdir(join(repo, '.git', 'info'), { recursive: true })
    await writeFile(join(repo, '.git', 'info', 'exclude'), '.openagent/\n')
    await mkdir(join(sub.path, '.openagent'), { recursive: true })
    await writeFile(join(sub.path, '.openagent', 'run2.json'), JSON.stringify({ id: 'run2', startedAt: '2026-01-01T00:00:00.000Z', status: 'done', caller: { baseCommit } }))
    assert.deepEqual(await removeProjectWorktree(repo, 'run2'), { ok: true, branchesDeleted: [sub.branch] })
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${sub.branch}`], repo), 'nothing reached origin')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a project none of whose own packages provides its checkouts is asked through the built-in one (#1774)', async () => {
  const { repo, path } = await repoWithDirtyWorktree()
  try {
    await rm(join(repo, 'node_modules'), { recursive: true, force: true })
    assert.deepEqual(await removeProjectWorktree(repo, RUN_ID), { ok: false, error: `${agentBranchName(RUN_ID)} has uncommitted work; the checkout was kept` })
    assert.equal((await stat(path)).isDirectory(), true, 'the checkout is untouched')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

// #1032: delete removes the session from the dashboard, records and all — where remove-worktree
// keeps it. Against real git, because "did the branch survive" is the whole distinction.

/**
 * Record a run the way a run's tool does, with the logs package, which every project has as its
 * runs provider. The two files that put its row in the rail.
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
