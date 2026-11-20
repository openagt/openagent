import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/agent-data'
import { createCheckout } from './checkout.js'
import { mergeBranch } from './merge.js'
import { reclaimWorktree } from './reclaim.js'
import { runCli } from './cli.js'

// Merging a finished agent's branch into the default branch, in a project with no remote. Real git.

const git = nodeGitRunner()

async function localRepo(): Promise<string> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'branches-merge-')))
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'index.html'), '<h1>Hello</h1>\n')
  await writeFile(join(repo, '.gitignore'), '.branches/\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  return repo
}

async function commit(path: string, file: string, text: string, message: string): Promise<void> {
  await writeFile(join(path, file), text)
  await git(['add', '-A'], path)
  await git(['commit', '-q', '-m', message], path)
}

const has = (repo: string, ref: string): Promise<boolean> => git(['rev-parse', '--verify', '--quiet', ref], repo).then(out => out.trim() !== '', () => false)
const head = async (repo: string): Promise<string> => (await git(['rev-parse', 'HEAD'], repo)).trim()

test("an agent's branch that still has its checkout is merged into the default branch and kept: the checkout is not removed under an agent working in it", async () => {
  const repo = await localRepo()
  try {
    const start = await head(repo)
    const { path, branch } = await createCheckout(repo, { agentId: 'run1' }, git)
    await commit(path, 'hello.txt', 'hi\n', 'work')
    const tip = await head(path)
    // The default branch moved on meanwhile, in another file: a real merge, not a fast-forward.
    await commit(repo, 'other.txt', 'other\n', 'mine')
    // Something the agent keeps in its checkout and never commits (its diary) must survive the merge.
    await mkdir(join(path, '.openagent'), { recursive: true })
    await writeFile(join(path, '.openagent', 'run1.jsonl'), '{"kind":"said"}\n')
    await appendFile(join(repo, '.git', 'info', 'exclude'), '.openagent/\n')

    assert.deepEqual(await mergeBranch(repo, branch, git), { ok: true, branch, into: 'main', commit: tip, from: start, deleted: false })
    assert.equal(await readFile(join(repo, 'hello.txt'), 'utf8'), 'hi\n', "the work is in the project's folder")
    assert.equal(await readFile(join(repo, 'other.txt'), 'utf8'), 'other\n')
    assert.equal(await has(repo, `refs/heads/${branch}`), true, 'the branch stays with its checkout')
    assert.equal(await readFile(join(path, '.openagent', 'run1.jsonl'), 'utf8'), '{"kind":"said"}\n', 'the checkout and what it holds are untouched')
    await git(['merge-base', '--is-ancestor', tip, 'HEAD'], repo)
    // Run by the agent itself, from inside its checkout: the same outcome, and its directory is still there.
    assert.deepEqual(await mergeBranch(repo, branch, git), { ok: true, branch, into: 'main', commit: tip, from: tip, deleted: false })
    assert.equal(await stat(path).then(s => s.isDirectory(), () => false), true)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a branch whose checkout is gone fast-forwards the default branch; a branch already in it is only deleted', async () => {
  const repo = await localRepo()
  try {
    const start = await head(repo)
    const { path, branch } = await createCheckout(repo, { agentId: 'run2' }, git)
    await commit(path, 'hello.txt', 'hi\n', 'work')
    const tip = await head(path)
    assert.equal((await reclaimWorktree(repo, path, { git })).ok, true)
    assert.deepEqual(await mergeBranch(repo, branch, git), { ok: true, branch, into: 'main', commit: tip, from: start, deleted: true })
    assert.equal(await head(repo), tip, 'a fast-forward makes no merge commit')

    await git(['branch', 'agent-again', tip], repo)
    assert.deepEqual(await mergeBranch(repo, 'agent-again', git), { ok: true, branch: 'agent-again', into: 'main', commit: tip, from: tip, deleted: true })
    assert.equal(await head(repo), tip)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a conflict changes nothing and names the files; uncommitted work in the checkout, another branch in the folder and no such branch are each refused', async () => {
  const repo = await localRepo()
  try {
    const { path, branch } = await createCheckout(repo, { agentId: 'run3' }, git)
    await commit(path, 'index.html', '<h1>Theirs</h1>\n', 'theirs')
    await commit(repo, 'index.html', '<h1>Mine</h1>\n', 'mine')
    const before = await head(repo)

    assert.deepEqual(await mergeBranch(repo, branch, git), { ok: false, reason: 'conflict', branch, into: 'main', files: ['index.html'] })
    assert.equal(await head(repo), before)
    assert.equal(await readFile(join(repo, 'index.html'), 'utf8'), '<h1>Mine</h1>\n', 'the file is as it was: no conflict markers')
    assert.equal((await git(['status', '--porcelain'], repo)).trim(), '', 'no half-done merge is left')
    assert.equal(await has(repo, `refs/heads/${branch}`), true, 'the branch stays')

    await writeFile(join(path, 'draft.txt'), 'not committed\n')
    assert.deepEqual(await mergeBranch(repo, branch, git), { ok: false, reason: 'dirty', branch })

    assert.deepEqual(await mergeBranch(repo, 'agent-nowhere', git), { ok: false, reason: 'no-branch', branch: 'agent-nowhere' })

    await git(['checkout', '-q', '-b', 'side'], repo)
    assert.deepEqual(await mergeBranch(repo, branch, git), { ok: false, reason: 'not-on-default', branch, into: 'main', current: 'side' })
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a branch that is no agent\'s is merged and kept; the command line answers the outcome, and a refusal in words', async () => {
  const repo = await localRepo()
  try {
    await git(['checkout', '-q', '-b', 'feature'], repo)
    await commit(repo, 'feature.txt', 'f\n', 'feature')
    await git(['checkout', '-q', 'main'], repo)
    const out: string[] = []
    const err: string[] = []
    const io = { cwd: repo, stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l) }
    assert.equal(await runCli(['merge', 'feature'], io, git), 0)
    assert.equal(JSON.parse(out[0]!).deleted, false)
    assert.equal(await has(repo, 'refs/heads/feature'), true)

    assert.equal(await runCli(['merge', 'agent-nowhere'], io, git), 1)
    assert.equal(err.at(-1), 'no branch agent-nowhere on this machine')
    assert.equal(await runCli(['merge'], io, git), 2)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
