import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBranchesAhead, parseBranchStates, parseCheckouts, providedBranches } from './branches.js'

// The branches contract (#1774): a project's package declares `"openagent": { "branches": "<command>" }`
// and OpenAgent reads its checkouts, a branch's state, and moves them, by running that command.
// Real processes: a tiny provider script that logs each call it answers, in a throwaway project.

/** A provider command: answers each command line of the contract from JSON files, logging every call. */
const PROVIDER = `
const { readFileSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
appendFileSync(join(__dirname, 'calls.log'), args.join(' ') + '\\n')
const answer = name => process.stdout.write(readFileSync(join(__dirname, name), 'utf8'))
if (args[0] === 'list') answer('list.json')
else if (args[0] === 'show') answer('show.json')
else if (args[0] === 'push') process.stdout.write(args[2] === 'remote-only' ? '{"ok":true,"branch":"remote-only","pushed":false}' : args[2] === 'dirty' ? (process.stderr.write('agent-dirty has uncommitted work; commit or delete it, then push\\n'), process.exit(1)) : '{"ok":true,"branch":"agent-run-1","pushed":true}')
else if (args[0] === 'merge') { if (args[1] === 'clash') { process.stderr.write('agent-clash does not merge cleanly into main: it conflicts in a.ts; nothing was changed\\n'); process.exit(1) } process.stdout.write('{"ok":true,"branch":"' + args[1] + '","into":"main","commit":"c1","from":"b1","deleted":true}') }
else if (args[0] === 'remove') { if (args[1] === 'kept') { process.stderr.write('agent-kept has uncommitted work; the checkout was kept\\n'); process.exit(1) } process.stdout.write(args[1] === 'run-1' && !args.includes('--discard') ? '{"ok":true,"branchesDeleted":["agent-run-1"]}' : '{"ok":true}') }
`

const ROW = { agentId: 'run-1', path: '/p/.branches/agent-run-1', branch: 'agent-run-1' }
const STATE = { branch: 'agent-run-1', exists: true, base: 'origin/main', commits: [{ sha: 'abc', subject: 'a' }], files: [{ path: 'a.ts', insertions: 1, deletions: 0, binary: false }], hasRemote: true, pushed: false, merged: false, pendingFiles: [] }

/** A project whose package.json lists `deps`, each installed under node_modules with its own package.json. */
async function project(deps: Record<string, Record<string, unknown>>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-branches-')))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: Object.fromEntries(Object.keys(deps).map(name => [name, '*'])) }))
  for (const [name, manifest] of Object.entries(deps)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
    await writeFile(join(dir, 'provider.cjs'), PROVIDER)
    await writeFile(join(dir, 'list.json'), JSON.stringify([ROW]))
    await writeFile(join(dir, 'show.json'), JSON.stringify([STATE]))
  }
  return root
}

const BRANCHES = { branches: { bin: { branches: 'provider.cjs' }, openagent: { branches: 'branches' } } }

const calls = async (root: string, pkg: string): Promise<string[]> =>
  (await readFile(join(root, 'node_modules', pkg, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)

test('a project with no branches provider of its own is read by the built-in one; one with a provider is read and moved through its command line', async () => {
  const none = await project({ plain: { bin: { plain: 'provider.cjs' } } })
  const root = await project(BRANCHES)
  try {
    assert.ok(await providedBranches()(none), 'the built-in branches package')
    const branches = (await providedBranches()(root))!
    assert.ok(branches)
    assert.deepEqual(await branches.list(), [{ id: 'run-1', path: ROW.path, branch: ROW.branch }])
    assert.deepEqual(await branches.list({ sizes: true }), [{ id: 'run-1', path: ROW.path, branch: ROW.branch }])
    assert.deepEqual(await branches.show(['agent-run-1', 'agent-run-2']), [STATE])
    assert.deepEqual(await branches.show([]), [], 'nothing asked is nothing run')
    assert.deepEqual(await branches.show(['agent-run-1'], 'abc123'), [STATE], 'measured from the commit the branch started at')
    assert.deepEqual(await branches.merge('agent-run-1'), { ok: true, into: 'main', commit: 'c1', from: 'b1', deleted: true })
    assert.deepEqual(await branches.merge('clash'), { ok: false, error: 'agent-clash does not merge cleanly into main: it conflicts in a.ts; nothing was changed' }, "a conflict is the provider's own line")
    assert.deepEqual(await branches.push('agent-run-1'), { ok: true, pushed: true })
    assert.deepEqual(await branches.push('remote-only'), { ok: true, pushed: false }, 'a branch only the remote has: nothing to push, and nothing missing')
    assert.deepEqual(await branches.push('dirty'), { ok: false, error: 'agent-dirty has uncommitted work; commit or delete it, then push' }, "a refusal is the provider's own line")
    assert.deepEqual(await branches.remove('run-1'), { ok: true, branchesDeleted: ['agent-run-1'] }, 'the branches that went with the checkout ride along')
    assert.deepEqual(await branches.remove('run-1', { discard: true }), { ok: true })
    assert.deepEqual(await branches.remove('run-2', { from: 'abc123' }), { ok: true }, 'reclaimed under the rule, its branch measured from the commit it started at')
    assert.deepEqual(await branches.remove('kept'), { ok: false, error: 'agent-kept has uncommitted work; the checkout was kept' }, "a refusal is the provider's own line")
    assert.deepEqual(await branches.remove('../x'), { ok: false, error: 'not a run id: ../x' })
    assert.deepEqual(await calls(root, 'branches'), [
      'list',
      'list --sizes',
      'show agent-run-1 agent-run-2',
      'show --from abc123 agent-run-1',
      'merge agent-run-1',
      'merge clash',
      'push --branch agent-run-1',
      'push --branch remote-only',
      'push --branch dirty',
      'remove run-1',
      'remove run-1 --discard',
      'remove run-2 --from abc123',
      'remove kept',
    ])
  } finally {
    await rm(none, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test('reads within the window share one call; a write and changed() forget them; a failed read is not kept', async () => {
  const root = await project(BRANCHES)
  try {
    let clock = 1_000_000
    const reader = providedBranches(() => clock)
    const branches = (await reader(root))!
    const [a, b] = await Promise.all([branches.list(), branches.list()])
    assert.equal(a, b, 'two reads at once are one call')
    await branches.list()
    await branches.show(['agent-run-1'])
    await branches.show(['agent-run-1'])
    assert.equal((await calls(root, 'branches')).length, 2, 'a read within the window is served from the last')
    await branches.list({ fresh: true })
    assert.equal((await calls(root, 'branches')).length, 2, 'a fresh ask within a second of a read is that read')
    clock += 1_500
    await branches.list({ fresh: true })
    assert.equal((await calls(root, 'branches')).length, 3, 'past a second, fresh runs the list again')
    await branches.remove('run-1')
    await branches.list()
    assert.equal((await calls(root, 'branches')).length, 5, 'a write drops the reads')
    reader.changed(root)
    await branches.list()
    assert.equal((await calls(root, 'branches')).length, 6, 'changed() runs the command again')
    await branches.show(['agent-run-1'])
    await branches.show(['agent-run-1'], 'abc123')
    await branches.show(['agent-run-1'], 'abc123')
    await branches.show(['agent-run-1'])
    assert.equal((await calls(root, 'branches')).length, 8, 'the same branch measured from a commit is a read of its own, kept the same way')
    clock += 6_000
    await writeFile(join(root, 'node_modules', 'branches', 'list.json'), 'not json')
    assert.deepEqual(await (await reader(root))!.list(), [], 'a provider printing no JSON is no checkouts')
    await writeFile(join(root, 'node_modules', 'branches', 'list.json'), JSON.stringify([ROW]))
    assert.equal((await (await reader(root))!.list()).length, 1, 'the failed read was not kept for the window')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('parseCheckouts keeps the rows with an id and a path; parseBranchStates the states with a branch and its three verdicts', () => {
  assert.deepEqual(parseCheckouts('nope'), [])
  assert.deepEqual(parseCheckouts([ROW, { id: 'run-2', path: '/p', sizeBytes: 3 }, { agentId: '../x', path: '/p' }, { agentId: 'run-3' }, null]), [
    { id: 'run-1', path: ROW.path, branch: ROW.branch },
    { id: 'run-2', path: '/p', sizeBytes: 3 },
  ])
  // The name the provider answers is kept as printed, and only as a non-empty string: OpenAgent never derives one.
  assert.deepEqual(parseCheckouts([{ ...ROW, name: 'fix-login' }, { ...ROW, name: '' }]), [{ id: 'run-1', path: ROW.path, branch: ROW.branch, name: 'fix-login' }, { id: 'run-1', path: ROW.path, branch: ROW.branch }])
  assert.deepEqual(parseBranchStates([{ ...STATE, name: 'fix-login' }, { ...STATE, name: 7 }]), [{ ...STATE, name: 'fix-login' }, STATE])
  assert.deepEqual(parseBranchStates([STATE, { branch: 'b', exists: false, pushed: false, merged: false, commits: 'x', files: [{ path: '' }, { path: 'f' }] }, { branch: 'c' }]), [
    STATE,
    { branch: 'b', exists: false, commits: [], files: [{ path: 'f', insertions: 0, deletions: 0, binary: false }], hasRemote: false, pushed: false, merged: false },
  ])
})

test('parseBranchesAhead keeps the counts with a branch, a number and every verdict; anything else is no answer', () => {
  const counted = { branch: 'agent-a', exists: true, agent: true, ahead: 2, hasRemote: true, pushed: false, gone: false, merged: false, uncommitted: 1 }
  assert.deepEqual(parseBranchesAhead('nope'), [])
  assert.deepEqual(parseBranchesAhead([counted, { ...counted, ahead: '2' }, { ...counted, uncommitted: undefined }, { ...counted, gone: undefined }, { ...counted, branch: '' }, null, { ...counted, extra: 1 }]), [counted, counted])
})

/** The provider's command line as the function its command calls, exported by the package: each call logged as `in <args>` with where it ran. */
const PROVIDER_CLI = `
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
export async function runCli(args, io) {
  appendFileSync(join(dir, 'calls.log'), 'in ' + args.join(' ') + ' @' + io.cwd + '\\n')
  return io.stdout(readFileSync(join(dir, args[0] === 'list' ? 'list.json' : 'show.json'), 'utf8')), 0
}
`

test("a provider whose package exports its command's function is read in this process: no command is run for a read", async () => {
  const root = await project({ inbranches: { type: 'module', exports: { '.': './cli.mjs' }, bin: { branches: 'provider.cjs' }, openagent: { branches: 'branches' } } })
  try {
    await writeFile(join(root, 'node_modules', 'inbranches', 'cli.mjs'), PROVIDER_CLI)
    const branches = (await providedBranches()(root))!
    assert.deepEqual(await branches.list(), [{ id: 'run-1', path: ROW.path, branch: ROW.branch }])
    assert.deepEqual(await branches.show(['agent-run-1']), [STATE])
    assert.deepEqual(await branches.ahead(['agent-run-1'], 'abc123'), [])
    assert.deepEqual(await calls(root, 'inbranches'), [`in list @${root}`, `in show agent-run-1 @${root}`, `in ahead --from abc123 agent-run-1 @${root}`], 'every answer came from the function, in the project; the command never ran')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
