import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { nodeGitRunner } from '@openagt/agent-data'
import { addWorktree, agentBranchName, reclaimWorktree, type ReclaimOptions } from './index.js'

// #982: one rule decides every removal — the checkout goes only once its branch holds everything
// in it, and the branch stays. Nothing is ever pushed: publishing is a person's call. Against real
// git, because "was the diff actually destroyed" is not a question a fake answers.

const RUN_ID = 'run1'
const ORDINARY: ReclaimOptions = { birthBranch: agentBranchName(RUN_ID) }

/**
 * A repo whose checkout holds an uncommitted edit, as a failed agent leaves one, with a bare repo
 * standing in for `origin` — real, since whether the work reached it is the whole subject.
 */
async function repoWithDirtyWorktree(opts: { remote?: boolean } = {}): Promise<{ repo: string; path: string; branch: string }> {
  const git = nodeGitRunner()
  // realpath so the mkdtemp path matches what git reports (the /var -> /private/var symlink).
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'branches-reclaim-')))
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

/** The agent commits its own work (#1638). */
async function commitWork(path: string, message = 'work'): Promise<void> {
  const git = nodeGitRunner()
  await git(['config', 'user.email', 't@t'], path)
  await git(['config', 'user.name', 't'], path)
  await git(['add', '-A'], path)
  await git(['commit', '-q', '-m', message], path)
}

/** A caller's own bookkeeping directory inside the checkout, hidden from `git status` the way that caller does it. */
async function ignoreStateDir(repo: string, path: string): Promise<void> {
  await mkdir(join(repo, '.git', 'info'), { recursive: true })
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.state/\n')
  await mkdir(join(path, '.state'), { recursive: true })
  await writeFile(join(path, '.state', 'agent.json'), '{}')
}

test('a checkout holding uncommitted work is kept — nothing is committed for the agent (#1638)', async () => {
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: false, reason: 'dirty', branch })
    assert.equal((await stat(path)).isDirectory(), true, 'the checkout is still on disk')
    assert.match(await readFile(join(path, 'index.html'), 'utf8'), /Welcome!/, 'with the work still in it, uncommitted')
    assert.equal((await git(['log', '--format=%s', branch], repo)).trim(), 'init', 'no commit was grabbed')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], repo), 'and nothing reached the remote')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a reclaimed checkout keeps the work its agent committed, on its branch, and pushes nothing (#982)', async () => {
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path)
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.match(await git(['show', `${branch}:index.html`], repo), /Welcome!/, 'the committed edit survived on the branch')
    assert.equal((await git(['ls-remote', '--heads', 'origin', 'agent-*'], repo)).trim(), '', 'and nothing reached the remote: publishing is a person\'s call')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('in a repository with no remote the checkout goes too, and its branch stays', async () => {
  const { repo, path, branch } = await repoWithDirtyWorktree({ remote: false })
  const git = nodeGitRunner()
  try {
    await commitWork(path)
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.match(await git(['show', `${branch}:index.html`], repo), /Welcome!/, 'the branch stays')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a checkout on the user\'s own unpushed branch goes, and the branch stays, never pushed for them', async () => {
  const { repo, path } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['checkout', '-q', '-b', 'release'], path)
    await commitWork(path)
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true, branchesDeleted: [agentBranchName(RUN_ID)] })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.match(await git(['show', 'release:index.html'], repo), /Welcome!/, 'the branch stays')
    assert.equal((await git(['ls-remote', '--heads', 'origin'], repo)).trim(), '', 'nothing reached the remote')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a run branch holding nothing the remote lacks goes with its checkout, unpushed (#1650)', async () => {
  // A triage that wrote only to the data branch, or a run stopped before its first commit: the
  // branch tip is the commit it started from, which origin already has.
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await git(['checkout', '--', '.'], path)
    await ignoreStateDir(repo, path)
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true, branchesDeleted: [branch] })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], repo), 'nothing reached origin')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/heads/${branch}`], repo), 'and the branch went with the checkout')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a run branch pushed under its own name holds its own work, so it stays (#1650)', async () => {
  // `origin/<branch>` contains the branch tip by definition. Counting it would read every pushed
  // run branch — the one with the PR — as holding nothing, and delete the local copy after each run.
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await commitWork(path)
    await git(['push', '-q', 'origin', branch], path)
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.match(await git(['show', `${branch}:index.html`], repo), /Welcome!/, 'the branch stays')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a run branch another run was started from, and pushed, still holds its own work, so it stays', async () => {
  // A main agent commits, starts a subagent from its branch, and ends its turn. The subagent's
  // pushed branch contains the main agent's tip: another name on the remote, holding work that is
  // the main agent's own.
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path)
    await git(['push', '-q', 'origin', `${branch}:refs/heads/agent-sub`], path)
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.match(await git(['show', `${branch}:index.html`], repo), /Welcome!/, 'the branch stays')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], repo), 'and is not pushed')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

/** A second agent's checkout, on a branch started from the first agent's tip, as a subagent's is; the commit it started from. */
async function checkoutStartedFrom(repo: string, base: string): Promise<{ path: string; branch: string; from: string }> {
  const git = nodeGitRunner()
  const sub = await addWorktree(repo, { agentId: 'run2', branch: agentBranchName('run2'), base }, git)
  return { ...sub, from: (await git(['rev-parse', 'HEAD'], sub.path)).trim() }
}

const STARTED: ReclaimOptions = { birthBranch: agentBranchName('run2') }

test('a run branch with no commit past the commit it started from goes with its checkout, unpushed', async () => {
  // A subagent that committed nothing: its tip is the main agent's commit, which origin has under
  // the main agent's name.
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path)
    await git(['push', '-q', 'origin', branch], path)
    const sub = await checkoutStartedFrom(repo, branch)
    assert.deepEqual(await reclaimWorktree(repo, sub.path, { ...STARTED, from: sub.from }), { ok: true, branchesDeleted: [sub.branch] })
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${sub.branch}`], repo), 'nothing reached origin')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/heads/${sub.branch}`], repo), 'and the branch went with the checkout')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a run branch with a commit past the commit it started from stays, whatever other name holds its tip', async () => {
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path)
    await git(['push', '-q', 'origin', branch], path)
    const sub = await checkoutStartedFrom(repo, branch)
    await writeFile(join(sub.path, 'sub.txt'), 'own\n')
    await commitWork(sub.path, 'the subagent\'s own')
    await git(['push', '-q', 'origin', `${sub.branch}:refs/heads/agent-third`], sub.path)
    assert.deepEqual(await reclaimWorktree(repo, sub.path, { ...STARTED, from: sub.from }), { ok: true })
    assert.match(await git(['show', `${sub.branch}:sub.txt`], repo), /own/, 'the branch stays')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${sub.branch}`], repo), 'and is not pushed')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a run branch at the commit it started from goes with its checkout, though no name on the remote holds that commit', async () => {
  // Started from a branch nobody published, as every subagent's is: it committed nothing, so it
  // holds nothing of its own.
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path)
    const sub = await checkoutStartedFrom(repo, branch)
    assert.deepEqual(await reclaimWorktree(repo, sub.path, { ...STARTED, from: sub.from }), { ok: true, branchesDeleted: [sub.branch] })
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/heads/${sub.branch}`], repo), 'the branch went with the checkout')
    assert.equal((await git(['ls-remote', '--heads', 'origin', 'agent-*'], repo)).trim(), '', 'and nothing reached origin')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a run branch started off the default branch, its start not named, is kept even with no commit of its own', async () => {
  // Without the commit it started from the branch is measured from origin's default branch, and
  // what it started on reads as its own: the safe side.
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path)
    const sub = await checkoutStartedFrom(repo, branch)
    assert.deepEqual(await reclaimWorktree(repo, sub.path, STARTED), { ok: true })
    assert.equal((await git(['rev-parse', '--verify', `refs/heads/${sub.branch}`], repo)).trim(), sub.from, 'kept')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${sub.branch}`], repo), 'and not pushed')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a start commit this machine does not have proves nothing: a branch the remote\'s default branch lacks is kept', async () => {
  // Made from a branch nobody published, with no commit of its own: only its start could say so.
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path)
    const sub = await checkoutStartedFrom(repo, branch)
    assert.deepEqual(await reclaimWorktree(repo, sub.path, { ...STARTED, from: '0123456789abcdef0123456789abcdef01234567' }), { ok: true })
    assert.equal((await git(['rev-parse', '--verify', `refs/heads/${sub.branch}`], repo)).trim(), sub.from, 'kept')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a run branch whose start is named goes once the remote\'s default branch has its work, and stays while it does not', async () => {
  const { repo, path, branch } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    const from = (await git(['rev-parse', 'HEAD'], repo)).trim()
    await commitWork(path)
    // Its work is its own: a commit past its start, which the default branch does not have.
    const kept = await addWorktree(repo, { agentId: 'run3', branch: agentBranchName('run3'), base: branch }, git)
    assert.deepEqual(await reclaimWorktree(repo, kept.path, { birthBranch: agentBranchName('run3'), from }), { ok: true })
    await git(['rev-parse', '--verify', `refs/heads/${kept.branch}`], repo)
    // Merged: the remote's default branch has every commit on it.
    await git(['push', '-q', 'origin', `${branch}:main`], repo)
    assert.deepEqual(await reclaimWorktree(repo, path, { ...ORDINARY, from }), { ok: true, branchesDeleted: [branch] })
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/heads/${branch}`], repo), 'the branch went with the checkout')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('with no remote, a run branch with no commit past its start goes with its checkout, and one with a commit stays', async () => {
  const { repo, path, branch } = await repoWithDirtyWorktree({ remote: false })
  const git = nodeGitRunner()
  try {
    const from = (await git(['rev-parse', 'HEAD'], repo)).trim()
    const idle = await addWorktree(repo, { agentId: 'run3', branch: agentBranchName('run3') }, git)
    assert.deepEqual(await reclaimWorktree(repo, idle.path, { birthBranch: agentBranchName('run3'), from }), { ok: true, branchesDeleted: [idle.branch] })
    // Its start not named: nothing says the branch is empty, so it is kept.
    const unnamed = await addWorktree(repo, { agentId: 'run4', branch: agentBranchName('run4') }, git)
    assert.deepEqual(await reclaimWorktree(repo, unnamed.path, { birthBranch: agentBranchName('run4') }), { ok: true })
    await commitWork(path)
    assert.deepEqual(await reclaimWorktree(repo, path, { ...ORDINARY, from }), { ok: true })
    assert.match(await git(['show', `${branch}:index.html`], repo), /Welcome!/, 'the branch stays')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a leftover checkout on a branch not minted for an agent keeps that branch, empty or not (#1650)', async () => {
  // Found on a rig: a reclaimed checkout sitting on `main`. It held nothing, and `git branch -D
  // main` failed only because the primary checkout had it out — git's refusal is not the guard.
  const { repo, path } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await git(['checkout', '--', '.'], path)
    await git(['checkout', '-q', '-b', 'release'], path)
    await ignoreStateDir(repo, path)
    // The user's branch stays; the birth branch it was cut from is ours and holds nothing
    // `release` does not, so that one goes (#1657).
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true, branchesDeleted: [agentBranchName(RUN_ID)] })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    await git(['rev-parse', '--verify', 'refs/heads/release'], repo)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a directory that is not a git worktree is refused before any git runs in it (#1654)', async () => {
  // A checkout removed by hand, then a marker written into the path. Git, asked in that
  // directory, answers for the enclosing repo — so the ordinary rule would judge the user's main
  // for deletion.
  const { repo, path: worktree } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['worktree', 'remove', '--force', worktree], repo)
    await mkdir(join(worktree, '.state'), { recursive: true })
    await writeFile(join(worktree, '.state', 'agent.json'), '{}')
    await writeFile(join(repo, 'index.html'), '<h1>half-typed</h1>\n')
    assert.deepEqual(await reclaimWorktree(repo, worktree, ORDINARY), { ok: false, reason: 'not-a-worktree' })
    assert.match(await git(['status', '--porcelain'], repo), /index\.html/, "the user's edit is still uncommitted")
    assert.equal((await git(['ls-remote', '--heads', 'origin'], repo)).trim(), '', 'and nothing was pushed')
    assert.equal((await stat(worktree)).isDirectory(), true, 'the directory is left where it is')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('the birth branch the agent branched away from goes with the checkout when the kept branch contains it (#1657)', async () => {
  const { repo, path, branch: birth } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await git(['checkout', '-q', '-b', 'agent-cool-name'], path)
    await commitWork(path)
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true, branchesDeleted: [birth] })
    assert.match(await git(['show', 'agent-cool-name:index.html'], repo), /Welcome!/, 'the work branch stays')
    await assert.rejects(() => git(['rev-parse', '--verify', 'refs/remotes/origin/agent-cool-name'], repo), 'not pushed')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/heads/${birth}`], repo), 'the birth branch is gone')
    await assert.rejects(() => git(['rev-parse', '--verify', `refs/remotes/origin/${birth}`], repo), 'and was never pushed')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a birth branch that is not an agent branch is never deleted, however contained it is', async () => {
  const { repo, path } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await git(['checkout', '-q', '-b', 'agent-cool-name'], path)
    await commitWork(path)
    // A caller naming the user's own branch as the birth branch: contained by the kept branch, and
    // still not ours to delete. The fixture's default branch, whatever git on this machine calls it.
    const own = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).trim()
    assert.deepEqual(await reclaimWorktree(repo, path, { birthBranch: own }), { ok: true })
    assert.ok((await git(['rev-parse', '--verify', `refs/heads/${own}`], repo)).trim(), 'the user\'s branch is still there')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a commitless run leaves neither the branch it ended on nor its birth branch (#1650, #1657)', async () => {
  const { repo, path, branch: birth } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await git(['checkout', '--', '.'], path)
    await git(['checkout', '-q', '-b', 'agent-triage-quick'], path)
    await ignoreStateDir(repo, path)
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true, branchesDeleted: ['agent-triage-quick', birth] })
    assert.equal((await git(['branch', '--list', 'agent-*'], repo)).trim(), '', 'no agent- branch is left')
    assert.equal((await git(['ls-remote', '--heads', 'origin', 'agent-*'], repo)).trim(), '', 'and none reached origin')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a birth branch carrying a commit the kept branch lacks stays (#1657)', async () => {
  // The agent committed on the birth branch, then branched from the init commit and went on
  // from there. The birth branch holds something the kept branch does not, so it is not ours to delete.
  const { repo, path, branch: birth } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path, 'early work on the birth branch')
    const init = (await git(['rev-parse', 'HEAD'], repo)).trim()
    await git(['checkout', '-q', '-b', 'agent-other', init], path)
    await writeFile(join(path, 'other.txt'), 'later\n')
    await commitWork(path, 'later work elsewhere')
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true })
    assert.match(await git(['show', `${birth}:index.html`], repo), /Welcome!/, 'the early commit is still on the birth branch')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a branch renamed after its birth name was pushed stays, never read as empty (#1725 review)', async () => {
  const { repo, path } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await commitWork(path)
    await git(['push', '-q', 'origin', 'agent-run1'], path)
    await git(['branch', '-m', 'agent-run1', 'agent-renamed'], path)
    // The tip is on the remote under the birth name only: the branch's own copy, which says
    // nothing about the branch being empty.
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true })
    assert.equal((await git(['rev-parse', '--verify', 'refs/heads/agent-renamed'], repo)).trim().length, 40, 'the local branch stays')
    await assert.rejects(() => git(['rev-parse', '--verify', 'refs/remotes/origin/agent-renamed'], repo), 'and is not pushed under its new name')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a birth branch another worktree has checked out is not named as deleted (#1757)', async () => {
  const { repo, path, branch: birth } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await git(['checkout', '-q', '-b', 'agent-cool-name'], path)
    await commitWork(path)
    // Someone else holds the birth branch out: git will refuse to delete it.
    await git(['worktree', 'add', '-q', join(repo, 'elsewhere'), birth], repo)
    assert.deepEqual(await reclaimWorktree(repo, path, ORDINARY), { ok: true }, 'the checkout goes, no branch is claimed deleted')
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.match(await git(['rev-parse', '--verify', `refs/heads/${birth}`], repo), /^[0-9a-f]{40}/, 'the birth branch still exists')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

// Root unlinks inside a read-only directory all the same, so as root (a container's user) the
// failed removal cannot be staged this way.
const asRoot = process.getuid?.() === 0 ? { skip: 'run as root: a read-only directory does not stop root' } : {}

test('a checkout git cannot remove even by force is not reported as reclaimed (#1757)', asRoot, async () => {
  const { repo, path } = await repoWithDirtyWorktree()
  const git = nodeGitRunner()
  try {
    await git(['push', '-q', 'origin', 'HEAD:main'], repo)
    await commitWork(path)
    // No write permission on the directory: nothing inside it can be unlinked.
    await chmod(path, 0o555)
    await assert.rejects(() => reclaimWorktree(repo, path, ORDINARY), 'the removal that failed is said, not swallowed')
    assert.equal((await stat(path)).isDirectory(), true, 'the checkout is still there')
  } finally {
    await chmod(path, 0o755).catch(() => {})
    await rm(repo, { recursive: true, force: true })
  }
})
