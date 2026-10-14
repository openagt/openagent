import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { ModuleServerHost, RunFacts } from '@openagt/dashboard/module-server'
import server from './server.js'

let dir: string
let root: string
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** The host for the project at `root` whose runs have the given facts. */
const host = (runs: Record<string, RunFacts> = {}): ModuleServerHost => ({
  root,
  run: async id => runs[id],
  mergeCommit: async () => ({ pending: false }),
})
const read = (name: string, input: Record<string, unknown>, runs?: Record<string, RunFacts>) => server.reads[name]!(host(runs), input)

before(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'changes-server-')))
  root = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  git(root, 'config', 'user.email', 't@t')
  git(root, 'config', 'user.name', 't')
  await writeFile(join(root, 'a.txt'), 'a\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'base')
  // The person's own edit in the project folder, and a new file.
  await writeFile(join(root, 'a.txt'), 'mine\n')
  await writeFile(join(root, 'new.txt'), 'new\n')
})
after(() => rm(dir, { recursive: true, force: true }))

test('the project read marks what is changed on disk, uncommitted', async () => {
  assert.deepEqual(await read('project', {}), { 'a.txt': { status: 'modified', committed: false, added: 1, removed: 1 }, 'new.txt': { status: 'untracked', committed: false, added: 1, removed: 0 } })
})

test('a diff without a run is the project folder’s', async () => {
  const diff = (await read('diff', { path: 'a.txt' })) as { patch: string }
  assert.match(diff.patch, /\+mine/)
  assert.equal(await read('diff', { path: 'nothing-changed.txt' }), null)
  assert.equal(await read('diff', { path: '../outside' }), null)
})

test('a working run’s counts are its own checkout’s; a run with none never shows the project folder’s as its own', async () => {
  const checkout = join(dir, 'wt')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-x', checkout)
  await writeFile(join(checkout, 'b.txt'), 'b\n')
  const runs = { 'run-x': { checkout, changedNothing: false }, 'run-ended': { record: { status: 'done' }, changedNothing: false } }
  assert.deepEqual(((await read('counts', { agentId: 'run-x' }, runs)) as { path: string }[]).map(c => c.path), ['b.txt'])
  assert.deepEqual(await read('counts', { agentId: 'run-ended' }, runs), [])
  assert.deepEqual(await read('counts', {}, runs), [])
})

test('a run the host does not know yet is starting, nothing changed; a read naming no run is gone', async () => {
  assert.deepEqual(await read('run', { agentId: 'run-unknown' }), { source: 'starting', changes: {}, from: 'main' })
  assert.deepEqual(await read('run', {}), { source: 'gone' })
})

test('a run’s commits and one commit’s changes and diff are read for the run; with no run, or a commit that is not the run’s, nothing is', async () => {
  const checkout = join(dir, 'wt-commits')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-c', checkout, 'main')
  await writeFile(join(checkout, 'c.txt'), 'c\n')
  git(checkout, 'add', '-A')
  git(checkout, 'commit', '-q', '-m', 'Add c')
  const sha = git(checkout, 'rev-parse', 'HEAD')
  const runs = { 'run-c': { checkout, changedNothing: false } }
  assert.deepEqual(((await read('commits', { agentId: 'run-c' }, runs)) as { sha: string; subject: string }[]).map(c => [c.sha, c.subject]), [[sha, 'Add c']])
  assert.deepEqual(await read('commits', {}, runs), [])
  assert.deepEqual(await read('commit', { agentId: 'run-c', commit: sha }, runs), { 'c.txt': { status: 'added', committed: true, added: 1, removed: 0 } })
  assert.equal(await read('commit', { agentId: 'run-c', commit: git(root, 'rev-parse', 'main') }, runs), null)
  assert.equal(await read('commit', { commit: sha }, runs), null)
  // A later commit changes the file again: the first commit's diff is still its own, not the run's whole change.
  await writeFile(join(checkout, 'c.txt'), 'c\nmore\n')
  git(checkout, 'commit', '-q', '-am', 'More c')
  const inCommit = ((await read('diff', { agentId: 'run-c', path: 'c.txt', commit: sha }, runs)) as { patch: string }).patch
  assert.match(inCommit, /\+c/)
  assert.doesNotMatch(inCommit, /\+more/)
  assert.match(((await read('diff', { agentId: 'run-c', path: 'c.txt' }, runs)) as { patch: string }).patch, /\+more/)
  assert.equal(await read('diff', { agentId: 'run-c', path: 'a.txt', commit: sha }, runs), null)
})

test('a run’s read names the branch it is measured from and its own; a diff asked for whole shows every line', async () => {
  const checkout = join(dir, 'wt-names')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-names', checkout, 'main')
  await writeFile(join(checkout, 'many.txt'), Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n')
  git(checkout, 'add', '-A')
  git(checkout, 'commit', '-q', '-m', 'Many lines')
  await writeFile(join(checkout, 'many.txt'), Array.from({ length: 20 }, (_, i) => (i === 10 ? 'changed' : `line ${i}`)).join('\n') + '\n')
  const runs = { 'run-n': { checkout, record: { branch: 'agent-names' }, changedNothing: false } }
  const answer = (await read('run', { agentId: 'run-n' }, runs)) as { from?: string; to?: string }
  assert.deepEqual([answer.from, answer.to], ['main', 'agent-names'])
  const near = ((await read('diff', { agentId: 'run-n', path: 'many.txt' }, runs)) as { patch: string }).patch
  const whole = ((await read('diff', { agentId: 'run-n', path: 'many.txt', whole: true }, runs)) as { patch: string }).patch
  assert.doesNotMatch(near, /line 0\n/)
  assert.match(whole, /line 0\n/)
  assert.equal(((await read('diff', { agentId: 'run-n', path: 'many.txt' }, runs)) as { lines?: number }).lines, 20, 'the file’s own length, so the pane knows lines are left under the change')
})

test('a new folder on disk is listed file by file, with its lines', async () => {
  const checkout = join(dir, 'wt-folder')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-folder', checkout, 'main')
  await mkdir(join(checkout, 'feature'))
  await writeFile(join(checkout, 'feature', 'a.ts'), 'a\n')
  await writeFile(join(checkout, 'feature', 'b.ts'), 'b\nb\n')
  const runs = { 'run-f': { checkout, changedNothing: false } }
  const answer = (await read('run', { agentId: 'run-f' }, runs)) as { changes: Record<string, unknown> }
  assert.deepEqual(answer.changes, {
    'feature/a.ts': { status: 'untracked', committed: false, added: 1, removed: 0 },
    'feature/b.ts': { status: 'untracked', committed: false, added: 2, removed: 0 },
  })
})

test('a file with a name that is not plain English is counted in the project folder too', async () => {
  await writeFile(join(root, 'café.txt'), 'one\ntwo\n')
  const marks = (await read('project', {})) as Record<string, { added?: number }>
  assert.equal(marks['café.txt']?.added, 2)
})
