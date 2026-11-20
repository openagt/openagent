import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner } from '@openagt/agent-data'
import { createCheckout } from './checkout.js'
import { nameBranch } from './name.js'
import { parseCommits, parseNumstat, parsePorcelain, readBranchStates } from './branch-state.js'
import { runCli } from './cli.js'

// What a branch holds and where it stands (#1774): the caller's read of a finished agent's
// work. Real git, a bare origin; no git host, since the pull request is the caller's own question.

const git = nodeGitRunner()

/** A repo with one commit pushed to a bare `origin`, whose HEAD names `main`. */
async function repoWithOrigin(): Promise<string> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'branches-state-')))
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

test('show: the commits and files beyond the base, whether the remote has the tip, and what the checkout left uncommitted', async () => {
  const repo = await repoWithOrigin()
  try {
    const { path } = await createCheckout(repo, { agentId: 'a1' })
    await commit(path, 'index.html', '<h1>Welcome</h1>\nmore\n', 'welcome')
    await commit(path, 'notes.md', 'notes\n', 'notes')
    await writeFile(join(path, 'draft.txt'), 'not committed\n')
    const [state] = await readBranchStates(repo, ['agent-a1'], git)
    assert.ok(state)
    assert.equal(state.branch, 'agent-a1')
    assert.equal(state.name, undefined, 'still on its birth branch: no name yet')
    assert.equal(state.exists, true)
    assert.equal(state.base, 'origin/main')
    assert.deepEqual(state.commits.map(c => c.subject), ['notes', 'welcome'], 'newest first')
    assert.match(state.commits[0]!.sha, /^[0-9a-f]{40}$/)
    assert.deepEqual(state.files, [
      { path: 'index.html', insertions: 2, deletions: 1, binary: false },
      { path: 'notes.md', insertions: 1, deletions: 0, binary: false },
    ])
    assert.equal(state.hasRemote, true)
    assert.equal(state.pushed, false, 'nothing pushed yet')
    assert.equal(state.merged, false)
    assert.deepEqual(state.pendingFiles, ['draft.txt'], 'the checkout on the branch names its uncommitted work')

    await rm(join(path, 'draft.txt'))
    await git(['push', '-q', 'origin', 'agent-a1'], path)
    const [pushed] = await readBranchStates(repo, ['agent-a1'], git)
    assert.equal(pushed!.pushed, true, 'the remote has the tip')
    assert.deepEqual(pushed!.pendingFiles, [], 'asked, and the tree is clean')

    // Landed on main: the base contains it, and it holds nothing beyond the base any more.
    await git(['merge', '-q', '--no-ff', '-m', 'land', 'agent-a1'], repo)
    await git(['push', '-q', 'origin', 'main'], repo)
    const [merged] = await readBranchStates(repo, ['agent-a1'], git)
    assert.equal(merged!.merged, true)
    assert.deepEqual(merged!.commits, [])
    assert.deepEqual(merged!.files, [])
  } finally {
    await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
  }
})

test('show: several branches answer in the order asked; a branch that is gone answers exists false with empty lists', async () => {
  const repo = await repoWithOrigin()
  try {
    const { path } = await createCheckout(repo, { agentId: 'a2' })
    await commit(path, 'index.html', '<h1>Two</h1>\n', 'two')
    const states = await readBranchStates(repo, ['nope', 'agent-a2', 'main'], git)
    assert.deepEqual(
      states.map(s => [s.branch, s.exists, s.commits.length]),
      [
        ['nope', false, 0],
        ['agent-a2', true, 1],
        ['main', true, 0],
      ],
    )
    assert.deepEqual(states[0], { branch: 'nope', exists: false, commits: [], files: [], hasRemote: true, pushed: false, merged: false })
    assert.equal('pendingFiles' in states[2]!, false, 'no checkout is on main: nobody asked')

    // The command line: a bare JSON array, one element per branch named.
    const out: string[] = []
    const code = await runCli(['show', 'agent-a2', 'nope'], { cwd: path, stdout: l => out.push(l), stderr: () => {} }, git)
    assert.equal(code, 0)
    const printed = JSON.parse(out.join('')) as { branch: string; exists: boolean }[]
    assert.deepEqual(
      printed.map(s => [s.branch, s.exists]),
      [
        ['agent-a2', true],
        ['nope', false],
      ],
    )
    const usage: string[] = []
    assert.equal(await runCli(['show'], { cwd: repo, stdout: () => {}, stderr: l => usage.push(l) }, git), 2, 'at least one branch')
    assert.match(usage.join('\n'), /at least 1/)
  } finally {
    await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
  }
})

test('show: a repository with no remote has no remote and nothing pushed; without a default branch, no base, no commits and no files', async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'branches-state-')))
  try {
    await git(['init', '-q', '-b', 'trunk'], repo)
    await commit(repo, 'a.txt', 'a\n', 'a')
    await git(['switch', '-q', '-c', 'agent-x'], repo)
    await commit(repo, 'b.txt', 'b\n', 'b')
    const [state] = await readBranchStates(repo, ['agent-x'], git)
    // No checkout is on `agent-x`, so nothing tells a birth branch apart: it is named by its suffix.
    assert.deepEqual(state, { branch: 'agent-x', name: 'x', exists: true, commits: [], files: [], hasRemote: false, pushed: false, merged: false })
  } finally {
    await rm(repo, { recursive: true, force: true, maxRetries: 10 })
  }
})

test('the parsers: a subject with spaces, a binary numstat entry, a renamed and a quoted status path', () => {
  const SEP = String.fromCharCode(31)
  assert.deepEqual(parseCommits(`abc${SEP}one two\n\ndef${SEP}\n`), [
    { sha: 'abc', subject: 'one two' },
    { sha: 'def', subject: '' },
  ])
  assert.deepEqual(parseNumstat('3\t1\ta.ts\n-\t-\timg.png\n\n'), [
    { path: 'a.ts', insertions: 3, deletions: 1, binary: false },
    { path: 'img.png', insertions: 0, deletions: 0, binary: true },
  ])
  assert.deepEqual(parsePorcelain(' M a.ts\n?? new.txt\nR  old.txt -> new name.txt\n M "sp ace.txt"\n'), ['a.ts', 'new.txt', 'new name.txt', 'sp ace.txt'])
})

test('show: the name the agent gave its work is the branch minus the prefix; none for a birth branch or a branch the package did not mint', async () => {
  const repo = await repoWithOrigin()
  try {
    const { path } = await createCheckout(repo, { agentId: 'a1' })
    await nameBranch(path, 'fix-login', git)
    await createCheckout(repo, { agentId: 'a2' })
    const [named, birth, main, gone] = await readBranchStates(repo, ['agent-fix-login', 'agent-a2', 'main', 'agent-gone'], git)
    assert.equal(named?.name, 'fix-login')
    assert.equal(birth?.name, undefined, 'the branch a checkout was created on names nothing')
    assert.equal(main?.name, undefined, 'not this package\'s branch')
    // A branch no checkout is on cannot be told from a birth branch, so it is named by its suffix.
    assert.equal(gone?.exists, false)
    assert.equal(gone?.name, 'gone')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('show --from: a branch made from the default branch counts only its own work, also once it took the default branch in, and still once the default branch has it', async () => {
  const repo = await repoWithOrigin()
  try {
    const start = (await git(['rev-parse', 'origin/main'], repo)).trim()
    const { path } = await createCheckout(repo, { agentId: 'a1' })
    await commit(path, 'notes.md', 'notes\n', 'notes')

    // The default branch moves on, and the branch takes it in: that is not the branch's own work.
    await commit(repo, 'other.md', 'other\n', 'somebody else')
    await git(['push', '-q', 'origin', 'main'], repo)
    await git(['merge', '-q', '--no-ff', '-m', 'take main in', 'origin/main'], path)
    const [state] = await readBranchStates(repo, ['agent-a1'], git, start)
    assert.equal(state!.base, 'origin/main', 'measured from the default branch while it lacks the work')
    assert.deepEqual(state!.commits.map(c => c.subject), ['take main in', 'notes'])
    assert.deepEqual(state!.files.map(f => f.path), ['notes.md'])
    assert.equal(state!.merged, false)

    // Merged: the default branch has it all, and what the branch did is still read, from its start.
    await git(['merge', '-q', '--ff-only', 'agent-a1'], repo)
    await git(['push', '-q', 'origin', 'main'], repo)
    const [merged] = await readBranchStates(repo, ['agent-a1'], git, start)
    assert.equal(merged!.merged, true)
    assert.equal(merged!.base, start)
    assert.ok(merged!.commits.some(c => c.subject === 'notes'))
    assert.ok(merged!.files.some(f => f.path === 'notes.md'))
    // With no start named there is nothing to measure it from once it is merged.
    const [unnamed] = await readBranchStates(repo, ['agent-a1'], git)
    assert.deepEqual(unnamed!.commits, [])
  } finally {
    await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
  }
})

test('show --from: a branch started from another branch is measured from the commit it started at, not from the default branch', async () => {
  const repo = await repoWithOrigin()
  try {
    // A main agent's branch with work of its own, and a subagent's branch started from it.
    const main = await createCheckout(repo, { agentId: 'm1' })
    await commit(main.path, 'feature.md', 'feature\n', 'the main agent\'s work')
    const start = (await git(['rev-parse', 'HEAD'], main.path)).trim()
    const sub = await createCheckout(repo, { agentId: 's1', base: 'agent-m1' })
    await commit(sub.path, 'part.md', 'part\n', 'the subagent\'s part')
    const tip = (await git(['rev-parse', 'HEAD'], sub.path)).trim()

    const [fromDefault] = await readBranchStates(repo, ['agent-s1'], git)
    assert.deepEqual(fromDefault!.files.map(f => f.path), ['feature.md', 'part.md'], 'beyond the default branch it holds the main agent\'s work too')

    const [state] = await readBranchStates(repo, ['agent-s1'], git, start)
    assert.equal(state!.base, start)
    assert.deepEqual(state!.commits.map(c => c.subject), ['the subagent\'s part'])
    assert.deepEqual(state!.files, [{ path: 'part.md', insertions: 1, deletions: 0, binary: false }])
    assert.equal(state!.merged, false, 'merged is still the default branch\'s answer: a branch that holds nothing beyond its start is not merged')
    const [empty] = await readBranchStates(repo, ['agent-m1'], git, start)
    assert.deepEqual(empty!.commits, [])
    assert.equal(empty!.merged, false)

    // The command line says the same.
    const printed: string[] = []
    assert.equal(await runCli(['show', '--from', start, 'agent-s1'], { cwd: repo, stdout: line => printed.push(line), stderr: () => {} }, git), 0)
    assert.deepEqual(JSON.parse(printed.join('\n'))[0].files.map((f: { path: string }) => f.path), ['part.md'])

    // A commit this machine does not have is no base: the default branch is.
    const [unknown] = await readBranchStates(repo, ['agent-s1'], git, '0'.repeat(40))
    assert.equal(unknown!.base, 'origin/main')
    assert.equal(unknown!.files.length, 2)

    // The branch gone, its last commit kept: the commit id in its place reads what the branch held.
    await git(['update-ref', 'refs/landed/s1', tip], repo)
    await git(['worktree', 'remove', '--force', sub.path], repo)
    await git(['branch', '-D', 'agent-s1'], repo)
    const [gone] = await readBranchStates(repo, ['agent-s1'], git, start)
    assert.equal(gone!.exists, false)
    const [kept] = await readBranchStates(repo, [tip], git, start)
    assert.equal(kept!.exists, true)
    assert.equal(kept!.branch, tip)
    assert.deepEqual(kept!.commits.map(c => c.subject), ['the subagent\'s part'])
    assert.deepEqual(kept!.files.map(f => f.path), ['part.md'])
    assert.equal(kept!.pushed, false)
    assert.equal(kept!.pendingFiles, undefined)
    // Only a full commit id is read so: a short one, or any other name, is a branch that is gone.
    const [short] = await readBranchStates(repo, [tip.slice(0, 12)], git, start)
    assert.equal(short!.exists, false)
  } finally {
    await rm(join(repo, '..'), { recursive: true, force: true, maxRetries: 10 })
  }
})
