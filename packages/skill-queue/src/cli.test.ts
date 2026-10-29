import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, withFileBranch, writeSharing, DATA_BRANCH } from '@openagt/agent-data'
import { runCli, USAGE } from './cli.js'
import { QUEUE_FILE } from './names.js'
import { addTextArgs, doneArgs } from './module.js'

const git = nodeGitRunner()
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const

/** A bare origin with an `agent-data` branch (holding `queue` when given), plus N clones acting as agents. */
async function rig(clones: number, queue?: string) {
  const bare = await realpath(await mkdtemp(join(tmpdir(), 'queue-cli-bare-')))
  await git(['init', '--bare', '-b', 'main', bare], bare)
  const seed = await realpath(await mkdtemp(join(tmpdir(), 'queue-cli-seed-')))
  await git(['clone', bare, seed], seed)
  await git(['config', 'user.email', 's@s'], seed)
  await git(['config', 'user.name', 's'], seed)
  await writeFile(join(seed, 'README.md'), '# t\n')
  await git(['add', '-A'], seed)
  await git(['commit', '-m', 'init'], seed)
  await git(['push', 'origin', 'main'], seed)
  const commit = (await git(['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'create the agent-data branch'], seed)).trim()
  await git(['checkout', '-B', DATA_BRANCH, commit], seed)
  if (queue !== undefined) {
    await writeFile(join(seed, QUEUE_FILE), queue)
    await git(['add', '-A'], seed)
    await git(['commit', '-m', 'seed'], seed)
  }
  await git(['push', 'origin', DATA_BRANCH], seed)
  // Every clone here shares the records with origin: the person's yes, given once per clone.
  await writeSharing(seed, true)
  const agents: string[] = []
  for (let i = 0; i < clones; i++) {
    const parent = await realpath(await mkdtemp(join(tmpdir(), `queue-cli-agent${i}-`)))
    const clone = join(parent, 'clone')
    await git(['clone', bare, clone], parent)
    await git(['config', 'user.email', `a${i}@a`], clone)
    await git(['config', 'user.name', `a${i}`], clone)
    await git(['checkout', '-b', `agent-a${i}`], clone)
    await writeSharing(clone, true)
    agents.push(clone)
  }
  const cleanup = async () => {
    for (const dir of [bare, seed, ...agents.map(a => join(a, '..'))]) await rm(dir, RETRIED_RM)
  }
  return { bare, seed, agents, cleanup }
}

/** Run one command, capturing the contract: parsed stdout, stderr lines, exit code. */
async function run(cwd: string, argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(argv, { cwd, stdout: line => out.push(line), stderr: line => err.push(line) })
  return { code, json: out.length ? JSON.parse(out.join('\n')) : undefined, stderr: err.join('\n') }
}

test('the page\'s own command lines: a task that opens with a dash is added and removed after `--`, where it is the task and no flag', async () => {
  const { agents, cleanup } = await rig(1, '## Priority 5\n\n- Tidy the loader\n')
  const [a] = agents
  try {
    // Without `--` the command reads the text as a flag, and says so.
    assert.equal((await run(a!, ['add', '--force the cache', '--priority', '5'])).code, 2)
    assert.deepEqual((await run(a!, addTextArgs('--force the cache', 5))).json, { ok: true, entry: '--force the cache', priority: 5 })
    assert.deepEqual((await run(a!, [])).json, ['Tidy the loader', '--force the cache'])
    assert.deepEqual((await run(a!, doneArgs('--force the cache'))).json, { ok: true, entry: '--force the cache' })
    assert.deepEqual((await run(a!, [])).json, ['Tidy the loader'])
  } finally {
    await cleanup()
  }
})

test('the bare command reads the queue off origin; add places an entry by priority as one pushed commit; done deletes the line', async () => {
  const { bare, agents, cleanup } = await rig(2, '## Priority 5\n\n- [Do B](tickets/2026-08-29_b.md)\n')
  const [a, b] = agents
  try {
    const listed = await run(a!, [])
    assert.equal(listed.code, 0)
    assert.deepEqual(listed.json, ['[Do B](tickets/2026-08-29_b.md)'])
    const added = await run(a!, ['add', 'Tidy the loader', '--priority', '3'])
    assert.deepEqual(added.json, { ok: true, entry: 'Tidy the loader', priority: 3 })
    assert.deepEqual((await run(a!, ['add', '[Do A](tickets/2026-08-30_a.md)', '--priority', '8'])).json, { ok: true, entry: '[Do A](tickets/2026-08-30_a.md)', priority: 8 })
    const plain = await run(a!, ['add', 'Last, unranked'])
    assert.deepEqual(plain.json, { ok: true, entry: 'Last, unranked' })
    assert.equal(await git(['show', `${DATA_BRANCH}:${QUEUE_FILE}`], bare), '## Priority 8\n\n- [Do A](tickets/2026-08-30_a.md)\n\n## Priority 5\n\n- [Do B](tickets/2026-08-29_b.md)\n\n## Priority 3\n\n- Tidy the loader\n- Last, unranked\n')
    assert.equal((await git(['log', '-1', '--format=%s %an', DATA_BRANCH], bare)).trim(), 'queue add: Last, unranked a0')
    // The agent's own clone holds no local copy of the branch: the write was a remote writer's.
    await assert.rejects(git(['rev-parse', '--verify', DATA_BRANCH], a!))
    assert.equal((await git(['status', '--porcelain'], a!)).trim(), '', 'nothing lands in the agent\'s checkout')
    // Another clone reads every push, this one's included.
    assert.deepEqual((await run(b!, [])).json, ['[Do A](tickets/2026-08-30_a.md)', '[Do B](tickets/2026-08-29_b.md)', 'Tidy the loader', 'Last, unranked'])
    const done = await run(b!, ['done', '[Do B](tickets/2026-08-29_b.md)'])
    assert.deepEqual(done.json, { ok: true, entry: '[Do B](tickets/2026-08-29_b.md)' })
    assert.equal((await git(['log', '-1', '--format=%s', DATA_BRANCH], bare)).trim(), 'queue done: [Do B](tickets/2026-08-29_b.md)')
    const md = await git(['show', `${DATA_BRANCH}:${QUEUE_FILE}`], bare)
    assert.ok(!md.includes('Do B'))
    assert.ok(!md.includes('[x]'), 'deleted, not checked off')
    const gone = await run(a!, ['done', 'never there'])
    assert.equal(gone.code, 1)
    assert.deepEqual(gone.json, { ok: false, reason: 'no-entry', entry: 'never there' })
    assert.match(gone.stderr, /no open queue entry reads "never there"/)
  } finally {
    await cleanup()
  }
})

test('add creates the queue file when the branch has none', async () => {
  const { bare, agents, cleanup } = await rig(1)
  const [a] = agents
  try {
    assert.deepEqual((await run(a!, [])).json, [])
    assert.equal((await run(a!, ['add', 'first ever', '--priority', '5'])).code, 0)
    assert.equal(await git(['show', `${DATA_BRANCH}:${QUEUE_FILE}`], bare), '## Priority 5\n\n- first ever\n')
    assert.deepEqual((await run(a!, [])).json, ['first ever'])
  } finally {
    await cleanup()
  }
})

test('--full prints each entry with its section\'s priority; --local reads this machine\'s copy with no fetch, the persistent checkout first', async () => {
  const { agents, seed, cleanup } = await rig(1, '## Priority 8\n\n- [Do A](tickets/2026-08-30_a.md)\n\n## Priority 5\n\n- Tidy the loader\n\n## Later\n\n- someday\n')
  const [a] = agents
  try {
    const full = await run(a!, ['--full'])
    assert.equal(full.code, 0)
    assert.deepEqual(full.json, [{ entry: '[Do A](tickets/2026-08-30_a.md)', priority: 8 }, { entry: 'Tidy the loader', priority: 5 }, { entry: 'someday' }])

    // A writer's persistent checkout (`.branches/agent-data`), as a daemon keeps it, is what --local reads.
    await mkdir(join(seed, '.branches'), { recursive: true })
    await withFileBranch(seed, DATA_BRANCH, 'noop', async () => {})
    await git(['checkout', 'main'], seed)
    const before = ['[Do A](tickets/2026-08-30_a.md)', 'Tidy the loader', 'someday']
    assert.deepEqual((await run(seed, ['--local'])).json, before)
    // Origin moves; a local read does not follow until this machine's copy is synced, while the bare read fetches.
    assert.equal((await run(a!, ['add', 'fresh from another machine', '--priority', '9'])).code, 0)
    assert.deepEqual((await run(seed, ['--local'])).json, before)
    assert.deepEqual((await run(seed, [])).json, ['fresh from another machine', ...before])
    assert.deepEqual((await run(seed, ['--local', '--full']))!.json![0], { entry: '[Do A](tickets/2026-08-30_a.md)', priority: 8 })
    // The flags belong to the bare command only.
    assert.equal((await run(a!, ['add', 'x', '--local'])).code, 2)
    assert.equal((await run(a!, ['done', 'x', '--full'])).code, 2)
  } finally {
    await cleanup()
  }
})

test('usage: an unknown command, a wrong argument count, an empty entry and a priority off the scale', async () => {
  const { agents, cleanup } = await rig(1, '- one\n')
  const [a] = agents
  try {
    const unknown = await run(a!, ['dance'])
    assert.equal(unknown.code, 2)
    assert.equal(unknown.json, undefined)
    assert.equal(unknown.stderr, USAGE)
    assert.equal((await run(a!, ['extra'])).code, 2)
    assert.equal((await run(a!, ['add'])).code, 2)
    assert.equal((await run(a!, ['add', '   '])).code, 2)
    assert.equal((await run(a!, ['add', 'x', '--priority', '11'])).code, 2)
    assert.equal((await run(a!, ['add', 'x', '--priority', 'high'])).code, 2)
    assert.equal((await run(a!, ['done'])).code, 2)
    assert.equal((await run(a!, ['done', 'one', 'two'])).code, 2)
    // Nothing was written by any of them.
    assert.deepEqual((await run(a!, [])).json, ['one'])
  } finally {
    await cleanup()
  }
})

test('a repository with no remote reads and writes its local branch; outside a repository is a refusal', async () => {
  const solo = await realpath(await mkdtemp(join(tmpdir(), 'queue-cli-solo-')))
  try {
    await git(['init', '-b', 'main'], solo)
    await git(['config', 'user.email', 's@s'], solo)
    await git(['config', 'user.name', 's'], solo)
    await writeFile(join(solo, 'README.md'), '# t\n')
    await git(['add', '-A'], solo)
    await git(['commit', '-m', 'init'], solo)
    const commit = (await git(['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'create the agent-data branch'], solo)).trim()
    await git(['branch', DATA_BRANCH, commit], solo)
    assert.deepEqual((await run(solo, [])).json, [])
    // Nothing to carry the change anywhere: it lands as a local commit, and the next read has it.
    assert.equal((await run(solo, ['add', 'x'])).code, 0)
    assert.equal(((await run(solo, [])).json as unknown[]).length, 1)
    assert.match(await git(['show', `${DATA_BRANCH}:${QUEUE_FILE}`], solo), /x/)
    const outside = await run(tmpdir(), [])
    assert.equal(outside.code, 1)
    assert.deepEqual(outside.json, { ok: false, reason: 'not-a-repo' })
  } finally {
    await rm(solo, RETRIED_RM)
  }
})

test("the package's main export is the function its command calls: OpenAgent reads the queue in its own process", async () => {
  const main = await import('./index.js')
  assert.equal(main.runCli, runCli)
})
