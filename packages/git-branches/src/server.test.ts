import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { START_FROM } from '@openagt/hooks'
import { rpcHost } from '@openagt/hooks/testing'
import { agentBranchName } from './branch-names.js'
import { checkout, discard, merge, pickStart, removeCheckout, startBranches, startedFrom, startPlaces } from './server.js'
import { addWorktree } from './worktree.js'

// What the launcher's start menu reads and saves, against real repositories.

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' })

async function folder(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)))
}

test("the menu lists what origin has now, by asking origin: not the main branch, not the records' branch, not this clone's old copies; and says so where origin cannot be read", async () => {
  const dir = await folder('git-branches-start-')
  const origin = await folder('git-branches-start-origin-')
  try {
    git(origin, 'init', '-q', '--bare', '-b', 'main')
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'first')
    git(dir, 'remote', 'add', 'origin', origin)
    git(dir, 'push', '-q', 'origin', 'main', 'main:agent-data', 'main:agent-fix-it', 'main:feature/x', 'main:old')
    git(dir, 'fetch', '-q', 'origin')
    git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    git(origin, 'update-ref', '-d', 'refs/heads/old')
    // A branch only this clone has is no published one.
    git(dir, 'branch', 'mine')
    const host = rpcHost({ root: dir })
    assert.deepEqual(await startBranches(host, {}), { branches: ['agent-fix-it', 'feature/x'] })

    git(dir, 'remote', 'set-url', 'origin', join(origin, 'nowhere'))
    assert.deepEqual(await startBranches(host, {}), {})
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(origin, { recursive: true, force: true })
  }
})

// The menu is offered only where the pick would be obeyed: a real repository, its branches changed one step at a time.
test('the menu names the two branches a run can start from only when the repository has a remote and the folder is on a branch; the pick saved is read with them', async () => {
  const dir = await folder('git-branches-places-')
  const host = rpcHost({ root: dir })
  try {
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'first')
    git(dir, 'checkout', '-q', '-b', 'my/work')
    assert.equal(await startPlaces(host, {}), null, 'no remote: one place to start from, nothing to pick')

    git(dir, 'remote', 'add', 'origin', 'https://example.com/x.git')
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'main')
    assert.deepEqual(await startPlaces(host, {}), { main: 'main', local: 'my/work' })

    git(dir, 'checkout', '-q', 'main')
    assert.deepEqual(await startPlaces(host, {}), { main: 'main', local: 'main' }, 'on the default branch itself: the local one may hold commits that are not pushed')

    git(dir, 'checkout', '-q', '--detach')
    assert.equal(await startPlaces(host, {}), null, 'the folder is on no branch')

    git(dir, 'checkout', '-q', 'main')
    assert.deepEqual(await pickStart(host, { pick: { kind: 'published', branch: 'feature/x' } }), { ok: true })
    assert.deepEqual(await startPlaces(host, {}), { main: 'main', local: 'main', pick: { kind: 'published', branch: 'feature/x' } })
    assert.equal(await startPlaces(rpcHost({ root: dir, project: async () => undefined }), {}), null, 'a session with no project starts from no branch')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a pick is saved for the project on this computer, the main branch by saving none, and a word that is no branch name is refused", async () => {
  const host = rpcHost()
  await host.settings.set(START_FROM, { other: { kind: 'local' } })
  assert.deepEqual(await pickStart(host, { pick: { kind: 'local' } }), { ok: true })
  assert.deepEqual(await host.settings.get(START_FROM), { other: { kind: 'local' }, project: { kind: 'local' } })
  assert.deepEqual(await pickStart(host, {}), { ok: true })
  assert.deepEqual(await host.settings.get(START_FROM), { other: { kind: 'local' } })
  assert.deepEqual(await pickStart(host, { pick: { kind: 'published', branch: '--upload-pack=x' } }), { ok: false, error: 'That is no branch to start from.' })
  assert.deepEqual(await pickStart(rpcHost({ project: async () => undefined }), {}), { ok: false, error: 'A session with no project starts from no branch.' })
})

/** A project whose run `run1` kept its checkout, holding an uncommitted edit, beside an origin that has none of its work. */
async function keptCheckout(): Promise<{ dir: string; worktree: string; branch: string }> {
  const dir = await folder('git-branches-remove-')
  git(dir, 'init', '-q', '-b', 'main')
  await writeFile(join(dir, 'index.html'), '<h1>Hello, world!</h1>\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  git(dir, 'init', '-q', '--bare', join(dir, 'origin.git'))
  git(dir, 'remote', 'add', 'origin', join(dir, 'origin.git'))
  const { path, branch } = await addWorktree(dir, { agentId: 'run1', branch: agentBranchName('run1') })
  await writeFile(join(path, 'index.html'), '<h1>Welcome!</h1>\n')
  return { dir, worktree: path, branch }
}

const ENDED = { record: { status: 'done' }, changedNothing: false }

test('Remove worktree keeps a checkout holding uncommitted work, and says so; one whose agent committed goes, its branch kept, nothing pushed (#982)', async () => {
  const at = await keptCheckout()
  const host = rpcHost({ root: at.dir, run: async () => ENDED })
  try {
    assert.equal((await checkout(host, { agentId: 'run1' })).kept, true)
    const kept = await removeCheckout(host, { agentId: 'run1' })
    assert.equal(kept.ok, false)
    assert.match(kept.ok === false ? kept.error : '', /uncommitted work/)
    assert.match(await readFile(join(at.worktree, 'index.html'), 'utf8'), /Welcome!/, 'the edit is still in the checkout, uncommitted')

    git(at.worktree, 'add', '-A')
    git(at.worktree, 'commit', '-q', '-m', 'work')
    assert.deepEqual(await removeCheckout(host, { agentId: 'run1' }), { ok: true, said: 'Removed the worktree.' })
    assert.match(git(at.dir, 'show', `${at.branch}:index.html`), /Welcome!/, 'the committed edit survived on the run branch')
    await assert.rejects(() => stat(at.worktree), 'the checkout is gone')
    assert.throws(() => git(at.dir, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${at.branch}`), 'and nothing reached the remote')
    assert.equal((await checkout(host, { agentId: 'run1' })).kept, false, 'nothing left to offer')
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test('the presses refuse a run still going, an id that is no run, and a run with no checkout, touching nothing', async () => {
  const at = await keptCheckout()
  try {
    const going = rpcHost({ root: at.dir, run: async () => ({ record: { status: 'running' }, changedNothing: false }) })
    for (const press of [removeCheckout, discard, merge]) {
      const refused = await press(going, { agentId: 'run1' })
      assert.equal(refused.ok, false)
      assert.match(refused.ok === false ? refused.error : '', /still going/)
    }
    assert.equal((await checkout(going, { agentId: 'run1' })).kept, false)
    assert.match(await readFile(join(at.worktree, 'index.html'), 'utf8'), /Welcome!/, 'the worktree is untouched')
    const host = rpcHost({ root: at.dir, run: async () => ENDED })
    for (const press of [removeCheckout, discard, merge]) assert.deepEqual(await press(host, { agentId: '../../etc' }), { ok: false, error: 'Unknown session.' })
    const none = await removeCheckout(host, { agentId: 'nosuchrun' })
    assert.match(none.ok === false ? none.error : '', /no checkout for agent nosuchrun/)
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test('Discard puts the changed files back as the branch has them and deletes the new ones; the branch and its commits stay', async () => {
  const at = await keptCheckout()
  const host = rpcHost({ root: at.dir, run: async () => ENDED })
  try {
    await writeFile(join(at.worktree, 'new.txt'), 'new\n')
    assert.deepEqual(await discard(host, { agentId: 'run1' }), { ok: true, said: 'Discarded the uncommitted changes.' })
    assert.match(await readFile(join(at.worktree, 'index.html'), 'utf8'), /Hello, world!/)
    await assert.rejects(() => stat(join(at.worktree, 'new.txt')))
    assert.equal(git(at.worktree, 'branch', '--show-current').trim(), at.branch)
  } finally {
    await rm(at.dir, { recursive: true, force: true })
  }
})

test("a session says the branch it started from as its record vouches for it, and the one it works on", async () => {
  const dir = await folder('git-branches-started-')
  const origin = await folder('git-branches-started-origin-')
  const said = (record: Record<string, string>) => startedFrom(rpcHost({ root: dir, run: async () => ({ record, changedNothing: false }) }), { agentId: 'run1' })
  try {
    git(origin, 'init', '-q', '--bare', '-b', 'trunk')
    git(dir, 'init', '-q', '-b', 'trunk')
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'first')
    git(dir, 'remote', 'add', 'origin', origin)
    git(dir, 'push', '-q', 'origin', 'trunk')
    git(dir, 'fetch', '-q', 'origin')
    git(dir, 'remote', 'set-head', 'origin', 'trunk')
    // Told one, by its name, or origin's copy of one: the name on its record, whatever origin's default is.
    assert.deepEqual(await said({ base: 'feature/x', baseCommit: 'abc', branch: 'agent-fix' }), { from: 'feature/x', on: 'agent-fix' })
    assert.deepEqual(await said({ base: 'refs/remotes/origin/feature/x' }), { from: 'feature/x' })
    // It made its own branch and was told none: origin's default branch, by the name it has in the clone; not the branch the folder is on.
    git(dir, 'checkout', '-q', '-b', 'mine')
    assert.deepEqual(await said({ baseCommit: 'abc', branch: 'agent-fix' }), { from: 'trunk', on: 'agent-fix' })
    // Nothing to vouch for it, an old record or a run given a branch that exists: no name.
    assert.deepEqual(await said({ branch: 'agent-fix' }), { on: 'agent-fix' })
    assert.deepEqual(await startedFrom(rpcHost({ root: dir }), { agentId: '../x' }), {})
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(origin, { recursive: true, force: true })
  }
})
