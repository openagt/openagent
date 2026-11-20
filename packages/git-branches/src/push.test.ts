import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/agent-data'
import { createCheckout } from './checkout.js'
import { pushBranchByName, pushCheckout } from './push.js'
import { runCli } from './cli.js'

// Pushing is the agent's last git step (#1820): the branch reaches origin, on a clean tree only.
// What happens to the branch on the git host is another package's. Real git and a bare origin.

const git = nodeGitRunner()

async function repoWithOrigin(): Promise<string> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'branches-push-')))
  const repo = join(base, 'repo')
  await mkdir(repo)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'index.html'), '<h1>Hello</h1>\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  await git(['init', '-q', '--bare', join(base, 'origin.git')], base)
  await git(['remote', 'add', 'origin', join(base, 'origin.git')], repo)
  await git(['push', '-q', '-u', 'origin', 'main'], repo)
  return repo
}

async function commitWork(path: string): Promise<void> {
  await writeFile(join(path, 'index.html'), '<h1>Welcome</h1>\n')
  await git(['config', 'user.email', 't@t'], path)
  await git(['config', 'user.name', 't'], path)
  await git(['add', '-A'], path)
  await git(['commit', '-q', '-m', 'work'], path)
}

const onOrigin = async (repo: string, branch: string): Promise<string> => (await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], repo).catch(() => '')).trim()

test('push: a clean checkout\'s branch reaches origin; a dirty tree is refused before anything is pushed', async () => {
  const repo = await repoWithOrigin()
  try {
    const { path } = await createCheckout(repo, { agentId: 'a1' })
    await writeFile(join(path, 'notes.txt'), 'uncommitted\n')
    assert.deepEqual(await pushCheckout(path), { ok: false, reason: 'dirty', branch: 'agent-a1' })
    assert.equal(await onOrigin(repo, 'agent-a1'), '', 'nothing was pushed')

    await rm(join(path, 'notes.txt'))
    await commitWork(path)
    assert.deepEqual(await pushCheckout(path), { ok: true, branch: 'agent-a1', pushed: true })
    assert.equal(await onOrigin(repo, 'agent-a1'), (await git(['rev-parse', 'HEAD'], path)).trim())
    // No upstream is written: that takes the shared `.git/config` lock a running agent's own git command may need.
    assert.equal(await git(['config', '--get', 'branch.agent-a1.remote'], repo).catch(() => ''), '', 'no upstream set')
    assert.deepEqual(await pushCheckout(join(path, '..')), { ok: false, reason: 'not-a-worktree' })
  } finally {
    await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
  }
})

test('push by name: the checkout on the branch is pushed under its clean rule; a local branch without one is pushed; one only origin has is left as it is; one nowhere is no-branch', async () => {
  const repo = await repoWithOrigin()
  try {
    const { path } = await createCheckout(repo, { agentId: 'b1' })
    await commitWork(path)
    await writeFile(join(path, 'draft.txt'), 'uncommitted\n')
    assert.deepEqual(await pushBranchByName(repo, 'agent-b1'), { ok: false, reason: 'dirty', branch: 'agent-b1' })
    await rm(join(path, 'draft.txt'))
    assert.deepEqual(await pushBranchByName(repo, 'agent-b1'), { ok: true, branch: 'agent-b1', pushed: true })
    assert.equal(await onOrigin(repo, 'agent-b1'), (await git(['rev-parse', 'HEAD'], path)).trim())

    // A local branch with no checkout: the agent's checkout was reclaimed already.
    await git(['branch', 'agent-b2', 'main'], repo)
    await git(['switch', '-q', 'agent-b2'], repo)
    await commitWork(repo)
    await git(['switch', '-q', 'main'], repo)
    assert.deepEqual(await pushBranchByName(repo, 'agent-b2'), { ok: true, branch: 'agent-b2', pushed: true })
    assert.equal(await onOrigin(repo, 'agent-b2'), (await git(['rev-parse', 'agent-b2'], repo)).trim())

    // A branch only origin has: pushed from elsewhere, nothing here to push.
    await git(['branch', 'claude/remote-only', 'main'], repo)
    await git(['push', '-q', 'origin', 'claude/remote-only'], repo)
    await git(['branch', '-D', 'claude/remote-only'], repo)
    const remoteTip = await onOrigin(repo, 'claude/remote-only')
    assert.deepEqual(await pushBranchByName(repo, 'claude/remote-only'), { ok: true, branch: 'claude/remote-only', pushed: false })
    assert.equal(await onOrigin(repo, 'claude/remote-only'), remoteTip, 'untouched')
    assert.equal(await git(['rev-parse', '--verify', '--quiet', 'refs/heads/claude/remote-only'], repo).then(() => true, () => false), false, 'no local branch was made')

    assert.deepEqual(await pushBranchByName(repo, 'nowhere'), { ok: false, reason: 'no-branch', branch: 'nowhere' })
  } finally {
    await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
  }
})

test('the command line: a bare `push` acts on the checkout it runs in, `push --branch` on the project; a refusal is exit 1 with its line', async () => {
  const repo = await repoWithOrigin()
  try {
    const { path } = await createCheckout(repo, { agentId: 'c1' })
    const io = () => {
      const out: string[] = []
      const err: string[] = []
      return { out, err, io: { stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l) } }
    }
    const dirty = io()
    await writeFile(join(path, 'wip.txt'), 'wip\n')
    assert.equal(await runCli(['push'], { cwd: join(path, 'src-or-anywhere-under').replace(/\/src-or-anywhere-under$/, ''), ...dirty.io }), 1)
    assert.deepEqual(JSON.parse(dirty.out[0]!), { ok: false, reason: 'dirty', branch: 'agent-c1' })
    assert.equal(dirty.err[0], 'agent-c1 has uncommitted work; commit or delete it, then push')

    await rm(join(path, 'wip.txt'))
    await commitWork(path)
    const ok = io()
    assert.equal(await runCli(['push'], { cwd: path, ...ok.io }), 0)
    assert.deepEqual(JSON.parse(ok.out[0]!), { ok: true, branch: 'agent-c1', pushed: true })

    const byName = io()
    assert.equal(await runCli(['push', '--branch', 'nowhere'], { cwd: repo, ...byName.io }), 1)
    assert.deepEqual(JSON.parse(byName.out[0]!), { ok: false, reason: 'no-branch', branch: 'nowhere' })
    assert.equal(byName.err[0], 'no branch nowhere, here or on origin')

    const usage = io()
    assert.equal(await runCli(['push', '--branch', ''], { cwd: repo, ...usage.io }), 2)
    assert.equal(usage.out.length, 0)
  } finally {
    await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
  }
})
