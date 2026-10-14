import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
  dir = await realpath(await mkdtemp(join(tmpdir(), 'files-server-')))
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

test('the project read lists the files in its folder, changed or not', async () => {
  assert.deepEqual(await read('project', {}), ['a.txt', 'new.txt'])
})

test('a file without a run is the project folder’s', async () => {
  assert.equal(((await read('content', { path: 'a.txt' })) as { text: string }).text, 'mine')
  assert.equal(((await read('content', { path: 'new.txt' })) as { text: string }).text, 'new')
  assert.equal(await read('content', { path: '../outside' }), null)
})

test('a run’s tree and files are its own checkout’s', async () => {
  const checkout = join(dir, 'wt')
  git(root, 'worktree', 'add', '-q', '-b', 'agent-x', checkout)
  await writeFile(join(checkout, 'b.txt'), 'b\n')
  const runs = { 'run-x': { checkout, changedNothing: false } }
  assert.deepEqual(await read('tree', { agentId: 'run-x' }, runs), { source: 'checkout', files: ['a.txt', 'b.txt'] })
  assert.equal(((await read('content', { agentId: 'run-x', path: 'a.txt' }, runs)) as { text: string }).text, 'a', 'the run’s copy, not the person’s edit in the project folder')
})

test('a tree read for a run the host does not know yet is starting, from the project HEAD; a read naming no run is gone', async () => {
  assert.deepEqual(await read('tree', { agentId: 'run-unknown' }), { source: 'starting', files: ['a.txt'] })
  assert.deepEqual(await read('tree', {}), { source: 'gone' })
})
