import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import { createCheckout } from './checkout.js'
import { readBranchesAhead } from './branch-ahead.js'
import { runCli } from './cli.js'

// The quick read of many branches: counts and where each stands, no files. Real git, a bare origin.

const git = nodeGitRunner()

/** A git that predates the `ahead-behind` atom (2.41): it refuses the atom, as such a git does. */
const oldGit: GitRunner = (args, cwd) => (args.some(arg => arg.includes('%(ahead-behind:')) ? Promise.reject(new Error('fatal: unknown field name: ahead-behind')) : git(args, cwd))

/** A repo with one commit pushed to a bare `origin`, whose HEAD names `main`. */
async function repoWithOrigin(): Promise<string> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'branches-ahead-')))
  const repo = join(base, 'repo')
  await mkdir(repo)
  await git(['init', '-q', '-b', 'main'], repo)
  await commit(repo, 'index.html', '<h1>Hello</h1>\n', 'init')
  await git(['init', '-q', '--bare', join(base, 'origin.git')], base)
  await git(['remote', 'add', 'origin', join(base, 'origin.git')], repo)
  await git(['push', '-q', '-u', 'origin', 'main'], repo)
  await git(['remote', 'set-head', 'origin', 'main'], repo)
  return repo
}

async function commit(path: string, file: string, content: string, message: string): Promise<void> {
  await writeFile(join(path, file), content)
  await git(['config', 'user.email', 't@t'], path)
  await git(['config', 'user.name', 't'], path)
  await git(['add', '-A'], path)
  await git(['commit', '-q', '-m', message], path)
}

for (const [which, runner] of [['git', git], ['a git without the ahead-behind atom', oldGit]] as const) {
  test(`ahead, with ${which}: each branch's own commits, whether origin has it or had it, whether it is merged, what its checkout left uncommitted, in the order asked`, async () => {
    const repo = await repoWithOrigin()
    try {
      const { path } = await createCheckout(repo, { agentId: 'a1' })
      await commit(path, 'a.md', 'a\n', 'one')
      await commit(path, 'b.md', 'b\n', 'two')
      const [unpushed, nope, main] = await readBranchesAhead(repo, ['agent-a1', 'nope', 'main'], runner)
      assert.deepEqual(unpushed, { branch: 'agent-a1', exists: true, agent: true, ahead: 2, hasRemote: true, pushed: false, gone: false, merged: false, uncommitted: 0 })
      assert.deepEqual(nope, { branch: 'nope', exists: false, agent: false, ahead: 0, hasRemote: true, pushed: false, gone: false, merged: false, uncommitted: 0 })
      assert.deepEqual(main, { branch: 'main', exists: true, agent: false, ahead: 0, hasRemote: true, pushed: true, gone: false, merged: true, uncommitted: 0 })

      // What its checkout left uncommitted, a new file and a changed one; the project's own folder is no checkout.
      await writeFile(join(path, 'draft.txt'), 'not committed\n')
      await writeFile(join(path, 'a.md'), 'changed\n')
      await writeFile(join(repo, 'stray.txt'), 'in the project folder\n')
      const [left, onMain] = await readBranchesAhead(repo, ['agent-a1', 'main'], runner)
      assert.equal(left!.uncommitted, 2)
      assert.equal(onMain!.uncommitted, 0)
      await rm(join(path, 'draft.txt'))
      await git(['checkout', '--', 'a.md'], path)

      await git(['push', '-q', 'origin', 'agent-a1'], path)
      const [pushed] = await readBranchesAhead(repo, ['agent-a1'], runner)
      assert.equal(pushed!.pushed, true, 'origin has the tip')
      await commit(path, 'c.md', 'c\n', 'three')
      const [past] = await readBranchesAhead(repo, ['agent-a1'], runner)
      assert.equal(past!.pushed, false, 'a commit origin does not have yet')
      assert.equal(past!.ahead, 3)

      // Pushed with its upstream, then its copy on origin deleted, as a merged pull request's is.
      await git(['push', '-q', '-u', 'origin', 'agent-a1'], path)
      await git(['push', '-q', 'origin', '--delete', 'agent-a1'], repo)
      await git(['fetch', '-q', '--prune', 'origin'], repo)
      const [gone] = await readBranchesAhead(repo, ['agent-a1'], runner)
      assert.equal(gone!.pushed, false)
      assert.equal(gone!.gone, true, 'it was pushed, and origin no longer has it')
      assert.equal(gone!.ahead, 3, 'a squash merge leaves its commits past the base')
    } finally {
      await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
    }
  })

  test(`ahead --from, with ${which}: a branch started from another branch counts only its own work, and one that took the default branch in does not count what it took`, async () => {
    const repo = await repoWithOrigin()
    try {
      await git(['switch', '-q', '-c', 'feature'], repo)
      await commit(repo, 'f1.md', 'f1\n', 'f1')
      await commit(repo, 'f2.md', 'f2\n', 'f2')
      const start = (await git(['rev-parse', 'HEAD'], repo)).trim()
      await git(['switch', '-q', '-c', 'agent-b', start], repo)
      await commit(repo, 'b.md', 'b\n', 'b')
      const [fromFeature] = await readBranchesAhead(repo, ['agent-b'], runner, start)
      assert.equal(fromFeature!.ahead, 1, "the feature branch's two commits are not its own")
      const [fromMain] = await readBranchesAhead(repo, ['agent-b'], runner)
      assert.equal(fromMain!.ahead, 3, 'counted from the default branch alone, they are')

      // Made from main, then main moved and was merged in: what it took in is not its own.
      await git(['switch', '-q', 'main'], repo)
      const born = (await git(['rev-parse', 'HEAD'], repo)).trim()
      await git(['switch', '-q', '-c', 'agent-c'], repo)
      await commit(repo, 'c.md', 'c\n', 'c')
      await git(['switch', '-q', 'main'], repo)
      await commit(repo, 'm.md', 'm\n', 'm')
      await git(['push', '-q', 'origin', 'main'], repo)
      await git(['switch', '-q', 'agent-c'], repo)
      await git(['merge', '-q', '--no-edit', 'main'], repo)
      const [tookMain] = await readBranchesAhead(repo, ['agent-c'], runner, born)
      assert.equal(tookMain!.ahead, 2, 'its commit and the merge, not the commit it took in')
    } finally {
      await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
    }
  })
}

test('ahead: a repository with no remote has nothing pushed; the command line prints a bare array and wants a branch', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'branches-ahead-')))
  try {
    await git(['init', '-q', '-b', 'main'], repo)
    await commit(repo, 'a.txt', 'a\n', 'a')
    await git(['switch', '-q', '-c', 'agent-x'], repo)
    await commit(repo, 'b.txt', 'b\n', 'b')
    const out: string[] = []
    assert.equal(await runCli(['ahead', 'agent-x', 'agent-data'], { cwd: repo, stdout: l => out.push(l), stderr: () => {} }, git), 0)
    assert.deepEqual(JSON.parse(out.join('')), [
      { branch: 'agent-x', exists: true, agent: true, ahead: 1, hasRemote: false, pushed: false, gone: false, merged: false, uncommitted: 0 },
      { branch: 'agent-data', exists: false, agent: false, ahead: 0, hasRemote: false, pushed: false, gone: false, merged: false, uncommitted: 0 },
    ])
    const usage: string[] = []
    assert.equal(await runCli(['ahead'], { cwd: repo, stdout: () => {}, stderr: l => usage.push(l) }, git), 2, 'at least one branch')
    assert.match(usage.join('\n'), /at least 1/)
  } finally {
    await rm(repo, { recursive: true, force: true, maxRetries: 10 })
  }
})

test('ahead, with a git without the ahead-behind atom: only the branches asked are counted, however many the repository holds', async () => {
  const repo = await repoWithOrigin()
  try {
    for (const name of ['one', 'two', 'three']) await git(['branch', `agent-${name}`], repo)
    const counted: string[] = []
    const counting: GitRunner = (args, cwd) => {
      if (args[0] === 'rev-list') counted.push(args.at(-1)!)
      return oldGit(args, cwd)
    }
    const [two] = await readBranchesAhead(repo, ['agent-two', 'agent-two'], counting)
    assert.equal(two!.exists, true)
    assert.equal(counted.length, 1, 'one branch asked, one count, once')
  } finally {
    await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
  }
})
