import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile, stat, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { nodeGitRunner, type GitRunner, BRANCHES_DIR } from '@openagt/agent-data'
import {
  addWorktree,
  attachWorktree,
  deleteBranch,
  isWorktreeRoot,
  worktreeBranch,
  listWorktrees,
  parseWorktreeList,
  removeWorktree,
  pruneWorktrees,
  worktreeClean,
  worktreePath,
  currentBranch,
  worktreeDirEntries,
  leaveOut,
  FRESH_START_FETCH_MS,
} from './worktree.js'
import { agentBranchName } from './branch-names.js'
import { publishedBase } from '@openagt/agent-data/names'

const REPO = '/repo'

/** A {@link GitRunner} that records its calls and returns a canned stdout. */
function recordingGit(stdout = ''): GitRunner & { calls: { args: string[]; cwd: string }[] } {
  const calls: { args: string[]; cwd: string }[] = []
  const agent: GitRunner = async (args, cwd) => {
    calls.push({ args, cwd })
    return stdout
  }
  return Object.assign(agent, { calls })
}

const failingGit: GitRunner = async () => {
  throw new Error('not a git repository')
}

test('worktreePath nests the checkout under .branches/, named as its branch (#1580)', () => {
  assert.equal(worktreePath(REPO, '2026-07-19T10-00-00-000Z'), join(REPO, BRANCHES_DIR, 'agent-2026-07-19T10-00-00-000Z'))
})

test('addWorktree builds `worktree add --no-track -b <branch> <path>` when the repo has no origin, and returns the path + branch', async () => {
  const git = recordingGit()
  const added = await addWorktree(REPO, { agentId: 'run1', branch: 'agent-run1' }, git)
  const path = worktreePath(REPO, 'run1')
  assert.deepEqual(added, { path, branch: 'agent-run1' })
  assert.deepEqual(git.calls.at(-1), { args: ['worktree', 'add', '--no-track', '-b', 'agent-run1', path], cwd: REPO })
  assert.equal(git.calls.some(call => call.args[0] === 'fetch'), false, 'no origin, nothing to fetch')
})

test('addWorktree appends the base ref when given, and fetches nothing', async () => {
  const git = recordingGit()
  await addWorktree(REPO, { agentId: 'run1', branch: 'b', base: 'origin/feature' }, git)
  assert.deepEqual(git.calls, [{ args: ['worktree', 'add', '--no-track', '-b', 'b', worktreePath(REPO, 'run1'), 'origin/feature'], cwd: REPO }])
})

test('addWorktree rejects an unsafe agent id before touching git (no traversal out of .branches/)', async () => {
  const git = recordingGit()
  await assert.rejects(() => addWorktree(REPO, { agentId: '../evil', branch: 'b' }, git), /unsafe agent id/)
  assert.equal(git.calls.length, 0)
})

test('parseWorktreeList reads path/head/branch and strips refs/heads/, dropping detached branches', () => {
  const porcelain = [
    'worktree /repo',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/.branches/agent-run1',
    'HEAD bbbb',
    'branch refs/heads/agent-run1',
    '',
    'worktree /repo/detached',
    'HEAD cccc',
    'detached',
    '',
  ].join('\n')
  assert.deepEqual(parseWorktreeList(porcelain), [
    { path: '/repo', head: 'aaaa', branch: 'main' },
    { path: '/repo/.branches/agent-run1', head: 'bbbb', branch: 'agent-run1' },
    { path: '/repo/detached', head: 'cccc' },
  ])
})

test('parseWorktreeList yields [] for empty output', () => {
  assert.deepEqual(parseWorktreeList(''), [])
})

test('listWorktrees passes --porcelain and is forgiving of a git failure', async () => {
  const git = recordingGit('worktree /repo\nHEAD aaaa\nbranch refs/heads/main\n')
  const entries = await listWorktrees(REPO, git)
  assert.deepEqual(git.calls[0]?.args, ['worktree', 'list', '--porcelain'])
  assert.deepEqual(entries, [{ path: '/repo', head: 'aaaa', branch: 'main' }])
  assert.deepEqual(await listWorktrees(REPO, failingGit), [])
})

test('removeWorktree tolerates an already-gone path', async () => {
  // Both attempts fail for a path git never registered; teardown stays idempotent.
  await assert.doesNotReject(() => removeWorktree(REPO, '/repo/gone', failingGit))
})

test('pruneWorktrees runs `worktree prune` and tolerates failure', async () => {
  const git = recordingGit()
  await pruneWorktrees(REPO, git)
  assert.deepEqual(git.calls[0]?.args, ['worktree', 'prune'])
  await assert.doesNotReject(() => pruneWorktrees(REPO, failingGit))
})

// End-to-end against real git: the whole point of the module is that the plumbing
// works, so add -> list -> remove -> prune is exercised on a temp repo.
test('add/list/remove round-trips against a real git repo', async () => {
  const git = nodeGitRunner()
  // realpath so the mkdtemp path matches what `git worktree list` reports: on
  // macOS tmpdir is under the /var -> /private/var symlink.
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'worktree-')))
  try {
    await git(['init'], repo)
    await git(['config', 'user.email', 't@t'], repo)
    await git(['config', 'user.name', 't'], repo)
    await writeFile(join(repo, 'README.md'), '# t\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'init'], repo)

    const { path, branch } = await addWorktree(repo, { agentId: 'run1', branch: 'agent-run1' }, git)
    assert.equal((await stat(path)).isDirectory(), true, 'worktree checkout dir exists')
    assert.equal((await stat(join(path, 'README.md'))).isFile(), true, 'checkout has the repo content')

    const listed = await listWorktrees(repo, git)
    assert.ok(listed.some(w => w.path === path && w.branch === branch), 'new worktree shows up with its branch')

    await removeWorktree(repo, path, git)
    await assert.rejects(() => stat(path), 'checkout dir is gone after removal')
    assert.equal((await listWorktrees(repo, git)).some(w => w.path === path), false, 'removed worktree is no longer listed')

    await assert.doesNotReject(() => pruneWorktrees(repo, git))
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('attachWorktree recreates a branch that is gone, from HEAD in a repo with no remote, and still refuses one git will not attach (#1650)', async () => {
  // The only branch the package deletes held nothing past a commit the remote already had, so
  // continuing that agent on a fresh branch loses nothing of it.
  const git = nodeGitRunner()
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'worktree-')))
  try {
    await git(['init'], repo)
    await git(['config', 'user.email', 't@t'], repo)
    await git(['config', 'user.name', 't'], repo)
    await writeFile(join(repo, 'README.md'), '# t\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'init'], repo)

    const { path } = await attachWorktree(repo, { agentId: 'run1', branch: 'agent-run1' }, git)
    assert.equal(await currentBranch(path, git), 'agent-run1', 'the missing branch was created and checked out')
    await removeWorktree(repo, path, git)
    await deleteBranch(repo, 'agent-run1', git)
    await assert.rejects(() => git(['show-ref', '--verify', 'refs/heads/agent-run1'], repo), 'deleteBranch removed it')

    // A branch that exists but is checked out by the main checkout is git's refusal, not ours.
    const head = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).trim()
    await assert.rejects(() => attachWorktree(repo, { agentId: 'run2', branch: head }, git))
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

/** A repo with an origin that has `main`, the user's own checkout on `my-feature` with a commit origin lacks. */
async function repoOnUnpushedFeature(git: GitRunner): Promise<{ repo: string; base: string; main: string; feature: string }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'worktree-')))
  const repo = join(base, 'repo')
  await mkdir(repo)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'README.md'), '# t\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  await git(['init', '-q', '--bare', join(base, 'origin.git')], base)
  await git(['remote', 'add', 'origin', join(base, 'origin.git')], repo)
  await git(['push', '-q', 'origin', 'main'], repo)
  await git(['fetch', '-q', 'origin'], repo)
  const main = (await git(['rev-parse', 'HEAD'], repo)).trim()
  await git(['checkout', '-q', '-b', 'my-feature'], repo)
  await writeFile(join(repo, 'secret.txt'), 'not ready\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'unpushed work'], repo)
  return { repo, base, main, feature: (await git(['rev-parse', 'HEAD'], repo)).trim() }
}

test('a new agent branch starts from origin’s default branch, never the branch the user has out, and sets no upstream', async () => {
  const git = nodeGitRunner()
  const { repo, base, main } = await repoOnUnpushedFeature(git)
  try {
    const { path } = await addWorktree(repo, { agentId: 'run1', branch: 'agent-run1' }, git)
    assert.equal((await git(['rev-parse', 'HEAD'], path)).trim(), main, 'on origin/main, without the unpushed commit')
    assert.equal(await git(['config', '--get', 'branch.agent-run1.remote'], repo).catch(() => ''), '', 'no upstream: the shared config is not written')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a new agent branch starts from origin’s latest, fetched: a commit pushed from elsewhere is in it', async () => {
  const git = nodeGitRunner()
  const { repo, base } = await repoOnUnpushedFeature(git)
  try {
    // Someone else pushes to main; this clone has not fetched it.
    const other = join(base, 'other')
    await git(['clone', '-q', '-b', 'main', join(base, 'origin.git'), other], base)
    await git(['config', 'user.email', 't@t'], other)
    await git(['config', 'user.name', 't'], other)
    await git(['commit', '-q', '--allow-empty', '-m', 'from elsewhere'], other)
    await git(['push', '-q', 'origin', 'main'], other)
    const latest = (await git(['rev-parse', 'HEAD'], other)).trim()
    const { path } = await addWorktree(repo, { agentId: 'run1', branch: 'agent-run1' }, git)
    assert.equal((await git(['rev-parse', 'HEAD'], path)).trim(), latest)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a fetch that hangs holds a new agent branch back 5 seconds at most, then it starts from the copy the clone has', async () => {
  const real = nodeGitRunner()
  const { repo, base, main } = await repoOnUnpushedFeature(real)
  // The network hangs: the fetch answers only long after. A live timer, as a hung git process is
  // live: a promise nothing holds would let the event loop end mid-test.
  let hung: ReturnType<typeof setTimeout> | undefined
  const git: GitRunner = (args, cwd) => (args[0] === 'fetch' ? new Promise<string>(resolve => (hung = setTimeout(() => resolve(''), 60_000))) : real(args, cwd))
  try {
    const started = Date.now()
    const { path } = await addWorktree(repo, { agentId: 'run1', branch: 'agent-run1' }, git)
    const waited = Date.now() - started
    assert.ok(waited >= FRESH_START_FETCH_MS - 100 && waited < FRESH_START_FETCH_MS + 3_000, `waited ${waited}ms`)
    assert.equal((await real(['rev-parse', 'HEAD'], path)).trim(), main)
  } finally {
    clearTimeout(hung)
    await rm(base, { recursive: true, force: true })
  }
})

test('a follow-up whose branch is gone gets it back from origin’s default branch, never the branch the user has out', async () => {
  const git = nodeGitRunner()
  const { repo, base, main } = await repoOnUnpushedFeature(git)
  try {
    const { path } = await attachWorktree(repo, { agentId: 'run1', branch: 'agent-run1' }, git)
    assert.equal(await currentBranch(path, git), 'agent-run1')
    assert.equal((await git(['rev-parse', 'HEAD'], path)).trim(), main, 'on origin/main, without the unpushed commit')
    assert.equal(await git(['config', '--get', 'branch.agent-run1.remote'], repo).catch(() => ''), '', 'no upstream')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a continued agent whose branch is gone gets it back from the base named: this clone’s, else origin’s, else origin’s default branch', async () => {
  const git = nodeGitRunner()
  const { repo, base, main, feature } = await repoOnUnpushedFeature(git)
  try {
    const local = await attachWorktree(repo, { agentId: 'run1', branch: 'agent-run1', base: 'my-feature' }, git)
    assert.equal((await git(['rev-parse', 'HEAD'], local.path)).trim(), feature, 'the base as this clone has it')
    assert.equal(local.again, true, 'made again: the answer says so')
    assert.equal(await git(['config', '--get', 'branch.agent-run1.remote'], repo).catch(() => ''), '', 'no upstream')

    // The base is gone here and origin has it.
    await git(['push', '-q', 'origin', 'my-feature:agent-main-run'], repo)
    await git(['fetch', '-q', 'origin'], repo)
    const remote = await attachWorktree(repo, { agentId: 'run2', branch: 'agent-run2', base: 'agent-main-run' }, git)
    assert.equal((await git(['rev-parse', 'HEAD'], remote.path)).trim(), feature, 'the base as origin has it')
    assert.equal(remote.again, true)

    const gone = await attachWorktree(repo, { agentId: 'run3', branch: 'agent-run3', base: 'agent-no-such' }, git)
    assert.equal((await git(['rev-parse', 'HEAD'], gone.path)).trim(), main, 'a base gone everywhere: origin’s default branch')
    assert.equal(gone.again, true)

    // The branch itself, where origin still has it, wins over the base.
    await git(['push', '-q', 'origin', `${main}:refs/heads/agent-pushed`], repo)
    await git(['fetch', '-q', 'origin'], repo)
    const kept = await attachWorktree(repo, { agentId: 'run4', branch: 'agent-pushed', base: 'my-feature' }, git)
    assert.equal((await git(['rev-parse', 'HEAD'], kept.path)).trim(), main, 'origin’s copy of the branch, not the base')
    assert.equal(kept.again, undefined, 'it came back with what it held: not made again')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a follow-up whose branch only origin has gets origin’s copy, with no upstream set', async () => {
  const git = nodeGitRunner()
  const { repo, base, feature } = await repoOnUnpushedFeature(git)
  try {
    await git(['push', '-q', 'origin', 'my-feature:agent-pushed'], repo)
    await git(['fetch', '-q', 'origin'], repo)
    const { path } = await attachWorktree(repo, { agentId: 'run2', branch: 'agent-pushed' }, git)
    assert.equal((await git(['rev-parse', 'HEAD'], path)).trim(), feature, 'the branch as origin has it')
    assert.equal(await git(['config', '--get', 'branch.agent-pushed.remote'], repo).catch(() => ''), '', 'no upstream')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('isWorktreeRoot is true for the main checkout and a linked worktree, false inside them and for a plain directory (#1654)', async () => {
  const git = nodeGitRunner()
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'worktree-')))
  try {
    await git(['init'], repo)
    await git(['config', 'user.email', 't@t'], repo)
    await git(['config', 'user.name', 't'], repo)
    await writeFile(join(repo, 'README.md'), '# t\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'init'], repo)
    const { path } = await addWorktree(repo, { agentId: 'run1', branch: 'agent-run1' }, git)
    // The hazard: a `.branches/` directory that is not a worktree. Git still answers in it — with
    // the enclosing repo's toplevel and branch.
    const residue = worktreePath(repo, 'run2')
    await mkdir(join(residue, 'leftover'), { recursive: true })

    assert.equal(await isWorktreeRoot(repo, git), true)
    assert.equal(await isWorktreeRoot(path, git), true)
    assert.equal(await isWorktreeRoot(join(repo, BRANCHES_DIR), git), false, 'a subdirectory of a checkout is not its root')
    assert.equal(await isWorktreeRoot(residue, git), false, 'and neither is a residue directory')
    assert.equal(await isWorktreeRoot(join(tmpdir()), git), false, 'nor a directory outside any repo')

    assert.equal(await currentBranch(residue, git), (await currentBranch(repo, git)), 'a plain read in the residue answers with the enclosing repo\'s branch — the bug')
    assert.equal(await worktreeBranch(residue, git), undefined, 'the guarded read answers with nothing')
    assert.equal(await worktreeBranch(path, git), 'agent-run1')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('removeWorktree tries a plain removal before forcing (#786)', async () => {
  const git = recordingGit()
  await removeWorktree(REPO, '/wt', git)
  assert.deepEqual(git.calls.map(c => c.args), [['worktree', 'remove', '/wt']]) // no --force needed
})

test('removeWorktree falls back to --force when git calls the checkout unclean (#786)', async () => {
  const calls: string[][] = []
  const git: GitRunner = async args => {
    calls.push(args)
    if (!args.includes('--force')) throw new Error('contains modified or untracked files')
    return ''
  }
  await removeWorktree(REPO, '/wt', git)
  assert.deepEqual(calls, [
    ['worktree', 'remove', '/wt'],
    ['worktree', 'remove', '--force', '/wt'],
  ])
})

// #786's point — a finished agent's edit must survive teardown — now holds by keeping, not by
// committing (#1638): the package commits nothing for an agent. A dirty checkout reads dirty and
// is the caller's to keep; once the agent has committed, the branch outlives the checkout.
test('a run worktree reads dirty until the agent commits; the branch then outlives it (#786/#1638)', async () => {
  const git = nodeGitRunner()
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'worktree-')))
  try {
    await git(['init'], repo)
    await git(['config', 'user.email', 't@t'], repo)
    await git(['config', 'user.name', 't'], repo)
    await writeFile(join(repo, 'index.html'), '<h1>Hello, world!</h1>\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'init'], repo)

    const { path, branch } = await addWorktree(repo, { agentId: 'run1', branch: 'agent-run1' }, git)
    // The agent edits and stops without committing, exactly as the system prompt leaves it.
    await writeFile(join(path, 'index.html'), '<h1>Welcome!</h1>\n')

    assert.equal(await worktreeClean(path, git), false, 'the uncommitted edit is reported, never swept into a commit')
    await git(['add', '-A'], path)
    await git(['commit', '-m', 'welcome'], path)
    assert.equal(await worktreeClean(path, git), true)
    await removeWorktree(repo, path, git)
    await assert.rejects(() => stat(path), 'checkout dir is gone')

    // The branch outlived the worktree and carries the edit.
    const shown = await git(['show', `${branch}:index.html`], repo)
    assert.match(shown, /Welcome!/, 'the edit survives on the run branch')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('agentBranchName names the branch after the agent id (#736)', () => {
  assert.equal(agentBranchName('2026-07-19T10-00-00-000Z'), 'agent-2026-07-19T10-00-00-000Z')
})

test('currentBranch reads the checked-out branch, and reads detached/non-repo as undefined', async () => {
  assert.equal(await currentBranch(REPO, recordingGit('agent-1\n')), 'agent-1')
  assert.equal(await currentBranch(REPO, recordingGit('HEAD\n')), undefined, 'detached HEAD is not a branch')
  assert.equal(await currentBranch(REPO, failingGit), undefined)
})

/** A directory reader over one listing: `entries[dir]` are the directory names under `dir`. */
const listing = (entries: Record<string, string[]>) => async (dir: string) => entries[dir] ?? []

test('worktreeDirEntries lists the agent-branch-named dirs under .branches/ and nothing else (#737/#1580)', async () => {
  const root = join('/repo', BRANCHES_DIR)
  // `agent-data` is the data branch's checkout, not agent `data`'s.
  const readdir = listing({ [root]: ['agent-r1', 'agent-r2', '.tmp', 'agent-data'] })
  assert.deepEqual(await worktreeDirEntries('/repo', readdir), [
    { path: join(root, 'agent-r1'), agentId: 'r1' },
    { path: join(root, 'agent-r2'), agentId: 'r2' },
  ])
  assert.deepEqual(await worktreeDirEntries('/never-ran', readdir), [])
})

test('worktreeDirEntries never mistakes a rename link for a checkout: a link is not a directory (#1580)', async () => {
  // A rename link beside the checkouts is named as an agent branch too; only the real directory
  // is a checkout, so the default reader must tell them apart by type, not by name.
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'worktree-')))
  try {
    await mkdir(join(repo, BRANCHES_DIR, 'agent-r1'), { recursive: true })
    await symlink('agent-r1', join(repo, BRANCHES_DIR, 'agent-cool-name'))
    await writeFile(join(repo, BRANCHES_DIR, 'agent-note'), 'not a checkout either\n')
    assert.deepEqual(await worktreeDirEntries(repo), [{ path: join(repo, BRANCHES_DIR, 'agent-r1'), agentId: 'r1' }])
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a new checkout started from a published base takes origin\'s copy, fetched then, whatever this clone holds of that branch; one gone from origin leaves no checkout and no branch', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'worktree-')))
  const repo = join(base, 'repo')
  const origin = join(base, 'origin.git')
  const elsewhere = join(base, 'elsewhere')
  const git = nodeGitRunner()
  const author = ['-c', 'user.name=t', '-c', 'user.email=t@example.com']
  const commit = (cwd: string, message: string) => git([...author, 'commit', '-q', '--allow-empty', '-m', message], cwd)
  const headOf = async (cwd: string) => (await git(['rev-parse', 'HEAD'], cwd)).trim()
  try {
    await git(['init', '-q', '--bare', '-b', 'main', origin], base)
    await mkdir(repo)
    await git(['init', '-q', '-b', 'main'], repo)
    await commit(repo, 'first')
    await git(['remote', 'add', 'origin', origin], repo)
    await git(['push', '-q', 'origin', 'main'], repo)
    await git(['clone', '-q', origin, elsewhere], base)

    // A branch this clone has never seen.
    await git(['checkout', '-q', '-b', 'feature/x'], elsewhere)
    await commit(elsewhere, 'theirs')
    await git(['push', '-q', 'origin', 'feature/x'], elsewhere)
    assert.equal(await git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/feature/x'], repo).then(() => true, () => false), false, 'not fetched yet')
    const first = await addWorktree(repo, { agentId: 'r1', branch: agentBranchName('r1'), base: publishedBase('feature/x') }, git)
    assert.equal(await headOf(first.path), await headOf(elsewhere))

    // Moved on at origin, and this clone holds a different branch by that name.
    await commit(elsewhere, 'theirs again')
    await git(['push', '-q', 'origin', 'feature/x'], elsewhere)
    await git(['branch', 'feature/x', 'main'], repo)
    const second = await addWorktree(repo, { agentId: 'r2', branch: agentBranchName('r2'), base: publishedBase('feature/x') }, git)
    assert.equal(await headOf(second.path), await headOf(elsewhere), 'origin\'s copy as it is now, not the local branch, not the copy fetched a moment ago')

    // The same name without the spelling is the local branch, as a subagent's base is.
    const local = await addWorktree(repo, { agentId: 'r3', branch: agentBranchName('r3'), base: 'feature/x' }, git)
    assert.equal(await headOf(local.path), (await git(['rev-parse', 'refs/heads/main'], repo)).trim())

    // Gone from origin, with this clone's stale copy still there: refused, never started from that copy.
    await git(['push', '-q', 'origin', '--delete', 'feature/x'], elsewhere)
    assert.notEqual((await git(['rev-parse', '--verify', 'refs/remotes/origin/feature/x'], repo)).trim(), '')
    await assert.rejects(() => addWorktree(repo, { agentId: 'r4', branch: agentBranchName('r4'), base: publishedBase('feature/x') }, git), /the branch feature\/x could not be fetched from origin/)
    await assert.rejects(() => stat(worktreePath(repo, 'r4')))
    assert.equal(await git(['rev-parse', '--verify', '--quiet', `refs/heads/${agentBranchName('r4')}`], repo).then(() => true, () => false), false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('paths left out of a checkout: git\'s sparse checkout in the new worktree, everything else in; none given, no such call', async () => {
  const git = recordingGit()
  const asked: string[] = []
  const { path } = await addWorktree(REPO, { agentId: 'run1', branch: 'agent-run1', without: async checkout => (asked.push(checkout), ['.agents/skills/b', '/.claude/skills/b']) }, git)
  assert.deepEqual(asked, [path], 'asked of the checkout once it is there')
  assert.deepEqual(git.calls.at(-1), { args: ['sparse-checkout', 'set', '--no-cone', '/*', '!/.agents/skills/b', '!/.claude/skills/b'], cwd: path })
  const full = recordingGit()
  await addWorktree(REPO, { agentId: 'run1', branch: 'agent-run1', without: async () => [] }, full)
  assert.equal(full.calls.some(call => call.args[0] === 'sparse-checkout'), false)
  await leaveOut(path, undefined, full)
  assert.equal(full.calls.some(call => call.args[0] === 'sparse-checkout'), false)
})

test('a checkout made without some of the project\'s skills has every other file, the project\'s other checkouts have them all, and a commit from it changes nothing about them', async () => {
  const git = nodeGitRunner()
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'worktree-')))
  try {
    await git(['init'], repo)
    await git(['config', 'user.email', 't@t'], repo)
    await git(['config', 'user.name', 't'], repo)
    for (const name of ['a', 'b']) {
      await mkdir(join(repo, '.agents', 'skills', name), { recursive: true })
      await writeFile(join(repo, '.agents', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
      await mkdir(join(repo, '.claude', 'skills'), { recursive: true })
      await symlink(`../../.agents/skills/${name}`, join(repo, '.claude', 'skills', name))
    }
    await mkdir(join(repo, 'src'))
    await writeFile(join(repo, 'src', 'x.ts'), 'export {}\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'init'], repo)
    // Asked of the checkout: the skill is left out because that checkout has it.
    const without = async (checkout: string) => ((await git(['ls-files', '--', '.agents/skills/b'], checkout)).trim() !== '' ? ['.agents/skills/b', '.claude/skills/b'] : [])
    const there = (path: string, file: string) => stat(join(path, file)).then(() => true, () => false)

    const { path } = await addWorktree(repo, { agentId: 'run1', branch: 'agent-run1', without }, git)
    assert.equal(await there(path, 'src/x.ts'), true)
    assert.equal(await there(path, '.agents/skills/a/SKILL.md'), true)
    assert.equal(await there(path, '.claude/skills/a'), true)
    assert.equal(await there(path, '.agents/skills/b/SKILL.md'), false, 'the skill left out is not in this checkout')
    assert.equal(await there(path, '.claude/skills/b'), false, 'nor its link')
    assert.equal(await git(['status', '--porcelain'], path), '', 'nothing to commit about it')
    assert.equal(await there(repo, '.agents/skills/b/SKILL.md'), true, 'the main checkout keeps it')
    // A commit from that checkout: the skill stays in the tree.
    await writeFile(join(path, 'src', 'y.ts'), 'export {}\n')
    await git(['add', '-A'], path)
    await git(['commit', '-m', 'work'], path)
    assert.ok((await git(['ls-tree', '-r', '--name-only', 'HEAD'], path)).includes('.agents/skills/b/SKILL.md'))
    // A second checkout, made in full, has them all.
    const full = await addWorktree(repo, { agentId: 'run2', branch: 'agent-run2' }, git)
    assert.equal(await there(full.path, '.agents/skills/b/SKILL.md'), true)
    // The same branch attached again, without the same: left out again.
    await removeWorktree(repo, path, git)
    const back = await attachWorktree(repo, { agentId: 'run1', branch: 'agent-run1', without }, git)
    assert.equal(await there(back.path, 'src/y.ts'), true)
    assert.equal(await there(back.path, '.agents/skills/b/SKILL.md'), false)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
