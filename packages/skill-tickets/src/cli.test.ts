import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, writeSharing, DATA_BRANCH } from '@openagt/agent-data'
import { runCli } from './cli.js'

const git = nodeGitRunner()
// The command reads AGENT_ID from the real environment, and the scheduler sets it for every run it
// starts, this test run included: drop it, so only the one test that sets it on purpose sees it.
delete process.env['AGENT_ID']
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const

/** A bare origin with an `agent-data` branch holding two tickets, plus N clones acting as agents. */
async function rig(clones: number) {
  const bare = await realpath(await mkdtemp(join(tmpdir(), 'tickets-cli-bare-')))
  await git(['init', '--bare', '-b', 'main', bare], bare)
  const seed = await realpath(await mkdtemp(join(tmpdir(), 'tickets-cli-seed-')))
  await git(['clone', bare, seed], seed)
  await git(['config', 'user.email', 's@s'], seed)
  await git(['config', 'user.name', 's'], seed)
  await writeFile(join(seed, 'README.md'), '# t\n')
  await git(['add', '-A'], seed)
  await git(['commit', '-m', 'init'], seed)
  await git(['push', 'origin', 'main'], seed)
  const commit = (await git(['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'create the agent-data branch'], seed)).trim()
  await git(['checkout', '-B', DATA_BRANCH, commit], seed)
  await mkdir(join(seed, 'tickets'))
  await writeFile(join(seed, 'tickets', '2026-08-30_a.md'), 'Priority: 8\n\n# A\n\n## TLDR\n\nThe first.\n')
  await writeFile(join(seed, 'tickets', '2026-08-29_b.md'), '# B\n')
  await writeFile(join(seed, 'tickets', '2026-08-29_b.plan.md'), 'Effort: 1\n\n# [Plan] B\n')
  await git(['add', '-A'], seed)
  await git(['commit', '-m', 'seed'], seed)
  await git(['push', 'origin', DATA_BRANCH], seed)
  // Every clone here shares the records with origin: the person's yes, given once per clone.
  await writeSharing(seed, true)
  const agents: string[] = []
  for (let i = 0; i < clones; i++) {
    const parent = await realpath(await mkdtemp(join(tmpdir(), `tickets-cli-agent${i}-`)))
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
async function run(cwd: string, argv: string[], stdin = '') {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(argv, { cwd, stdin: async () => stdin, stdout: line => out.push(line), stderr: line => err.push(line) })
  return { code, json: out.length ? JSON.parse(out.join('\n')) : undefined, stderr: err.join('\n') }
}

test('reads: list and show come off origin, and a missing ticket is a refusal', async () => {
  const { agents, cleanup } = await rig(1)
  const [a] = agents
  try {
    const list = await run(a!, ['list'])
    assert.equal(list.code, 0)
    assert.deepEqual(list.json.map((t: { file: string; priority?: string; planned: boolean; effort?: number }) => [t.file, t.priority, t.planned, t.effort]), [
      ['2026-08-30_a.md', '8', false, undefined],
      ['2026-08-29_b.md', undefined, true, 1],
    ])
    const show = await run(a!, ['show', '2026-08-29_b.md'])
    assert.equal(show.code, 0)
    assert.equal(show.json.ticket.content, '# B\n')
    assert.match(show.json.plan, /^Effort: 1/)
    assert.equal(show.json.holder, undefined)
    // The ticket may be named by its path too.
    assert.equal((await run(a!, ['show', 'tickets/2026-08-29_b.md'])).code, 0)
    const missing = await run(a!, ['show', '2026-08-28_nope.md'])
    assert.equal(missing.code, 1)
    assert.deepEqual(missing.json, { ok: false, reason: 'no-ticket', file: '2026-08-28_nope.md' })
    assert.match(missing.stderr, /no ticket tickets\/2026-08-28_nope.md/)
    const bad = await run(a!, ['show', '../x.md'])
    assert.equal(bad.json.reason, 'invalid-path')
    // Usage: an unknown command, a wrong argument count.
    const unknown = await run(a!, ['dance'])
    assert.equal(unknown.code, 2)
    assert.equal(unknown.stderr, 'unknown command: dance\nRun `tickets --help` for usage.')
    assert.equal((await run(a!, ['show'])).code, 2)
  } finally {
    await cleanup()
  }
})

test('claim writes the lock as one pushed commit naming the holder; the second claimer is refused with the holder; release lifts it', async () => {
  const { bare, agents, cleanup } = await rig(2)
  const [a, b] = agents
  try {
    const first = await run(a!, ['claim', '2026-08-30_a.md'])
    assert.equal(first.code, 0)
    assert.deepEqual(first.json, { ok: true, file: 'tickets/2026-08-30_a.md', holder: 'agent-a0', earlier: [] })
    assert.equal(await git(['show', `${DATA_BRANCH}:tickets/2026-08-30_a.lock.md`], bare), 'CLAIMED: agent-a0\n')
    assert.equal((await git(['log', '-1', '--format=%s %an', DATA_BRANCH], bare)).trim(), 'claim tickets/2026-08-30_a a0')
    // The agent's own clone holds no local copy of the branch: the write was a remote writer's.
    await assert.rejects(git(['rev-parse', '--verify', DATA_BRANCH], a!))
    assert.equal((await git(['status', '--porcelain'], a!)).trim(), '', 'nothing lands in the agent\'s checkout')
    // A second claimer, from another clone, back to back: refused, told who holds it.
    const second = await run(b!, ['claim', '2026-08-30_a.md'])
    assert.equal(second.code, 1)
    assert.deepEqual(second.json, { ok: false, reason: 'claimed', holder: 'agent-a0', file: '2026-08-30_a.md' })
    assert.match(second.stderr, /claimed by agent-a0/)
    // Exactly one lock commit on the remote.
    assert.equal((await git(['rev-list', '--count', DATA_BRANCH], bare)).trim(), '3')
    // The holder shows up on the reads.
    const show = await run(b!, ['show', '2026-08-30_a.md'])
    assert.equal(show.json.holder, 'agent-a0')
    assert.equal(show.json.ticket.lockedBy, 'agent-a0')
    // Claiming again yourself is fine: the lock is yours already.
    assert.deepEqual((await run(a!, ['claim', '2026-08-30_a.md'])).json, { ok: true, file: 'tickets/2026-08-30_a.md', holder: 'agent-a0', earlier: [] })
    // Only the holder may release.
    const notMine = await run(b!, ['release', '2026-08-30_a.md'])
    assert.equal(notMine.code, 1)
    assert.deepEqual(notMine.json, { ok: false, reason: 'not-holder', file: '2026-08-30_a.md', holder: 'agent-a0' })
    const mine = await run(a!, ['release', '2026-08-30_a.md'])
    assert.equal(mine.code, 0)
    await assert.rejects(git(['show', `${DATA_BRANCH}:tickets/2026-08-30_a.lock.md`], bare))
    assert.deepEqual((await run(a!, ['release', '2026-08-30_a.md'])).json, { ok: false, reason: 'no-lock', file: '2026-08-30_a.md' })
    // Now b gets it, and learns a claimed it before, though a's claim is gone.
    assert.deepEqual((await run(b!, ['claim', '2026-08-30_a.md'])).json, { ok: true, file: 'tickets/2026-08-30_a.md', holder: 'agent-a1', earlier: ['agent-a0'] })
    // Released again and claimed a third time: a0's own earlier claim is left out, b's is named.
    assert.equal((await run(b!, ['release', '2026-08-30_a.md'])).code, 0)
    assert.equal((await run(a!, ['release', '2026-08-30_a.md'])).code, 1)
    assert.deepEqual((await run(a!, ['claim', '2026-08-30_a.md'])).json.earlier, ['agent-a1'], 'your own earlier claim is not listed')
    // A ticket that does not exist cannot be claimed.
    assert.equal((await run(b!, ['claim', '2026-08-28_nope.md'])).json.reason, 'no-ticket')
  } finally {
    await cleanup()
  }
})

test('the holder is AGENT_ID when the process that started the agent set it, the branch elsewhere, and nobody when detached', async () => {
  const { agents, cleanup } = await rig(1)
  const [a] = agents
  const id = '2026-08-30T10-00-00-000Z'
  try {
    // An agent checkout under `.branches/`, as the scheduler lays it out; the folder name means nothing
    // to the command, only the environment and the branch do.
    const wt = join(a!, '.branches', `agent-${id}`)
    await git(['worktree', 'add', wt, '-b', `agent-${id}`], a!)
    assert.equal((await run(wt, ['claim', '2026-08-30_a.md'])).json.holder, `agent-${id}`, 'no AGENT_ID: the branch')
    assert.equal((await run(wt, ['release', '2026-08-30_a.md'])).code, 0)
    process.env['AGENT_ID'] = id
    try {
      assert.equal((await run(wt, ['claim', '2026-08-30_a.md'])).json.holder, id)
      // The id survives the session's rename: the environment keeps it, the branch does not.
      await git(['branch', '-m', `agent-${id}`, 'agent-named'], wt)
      assert.equal((await run(wt, ['release', '2026-08-30_a.md'])).json.holder, id)
    } finally {
      delete process.env['AGENT_ID']
    }
    // Detached, and nobody said who: nothing to claim as.
    await git(['checkout', '--detach'], a!)
    const detached = await run(a!, ['claim', '2026-08-30_a.md'])
    assert.equal(detached.code, 1)
    assert.deepEqual(detached.json, { ok: false, reason: 'no-identity' })
  } finally {
    await cleanup()
  }
})

test('put writes a ticket, a plan or meta.json from stdin, never a lock; close removes the ticket with its siblings', async () => {
  const { bare, agents, cleanup } = await rig(1)
  const [a] = agents
  try {
    const put = await run(a!, ['put', '2026-08-31_c.md'], '# C\n')
    assert.deepEqual(put.json, { ok: true, file: 'tickets/2026-08-31_c.md' })
    assert.equal(await git(['show', `${DATA_BRANCH}:tickets/2026-08-31_c.md`], bare), '# C\n')
    assert.equal((await git(['log', '-1', '--format=%s', DATA_BRANCH], bare)).trim(), 'put tickets/2026-08-31_c.md')
    assert.equal((await run(a!, ['put', 'tickets/2026-08-31_c.plan.md'], 'Effort: 2\n\n# [Plan] C\n')).code, 0, 'the tickets/ path form, as a queue entry links it')
    assert.deepEqual((await run(a!, ['meta'])).json, {}, 'no import recorded yet reads as an empty object')
    assert.equal((await run(a!, ['put', 'meta.json'], '{"lastImportedAt":"2026-08-31T00:00:00.000Z"}')).code, 0)
    assert.equal(await git(['show', `${DATA_BRANCH}:tickets/meta.json`], bare), '{"lastImportedAt":"2026-08-31T00:00:00.000Z"}')
    const meta = await run(a!, ['meta'])
    assert.equal(meta.code, 0)
    assert.deepEqual(meta.json, { lastImportedAt: '2026-08-31T00:00:00.000Z' })
    for (const bad of ['2026-08-31_c.lock.md', '../x.md', 'sub/x.md', 'x.txt']) {
      const refused = await run(a!, ['put', bad], 'x')
      assert.equal(refused.code, 1, bad)
      assert.equal(refused.json.reason, 'invalid-path', bad)
    }
    // The new ticket lists, planned.
    const listed = (await run(a!, ['list'])).json.find((t: { file: string }) => t.file === '2026-08-31_c.md')
    assert.equal(listed.planned, true)
    assert.equal(listed.effort, 2)
    await run(a!, ['claim', '2026-08-31_c.md'])
    // Closing takes the lock with the ticket, so someone else's claim refuses the close.
    const otherParent = await realpath(await mkdtemp(join(tmpdir(), 'tickets-cli-other-')))
    try {
      const b = join(otherParent, 'clone')
      await git(['clone', bare, b], otherParent)
      await git(['config', 'user.email', 'b@b'], b)
      await git(['config', 'user.name', 'b'], b)
      await git(['checkout', '-b', 'agent-b'], b)
      await writeSharing(b, true)
      await run(b, ['claim', '2026-08-30_a.md'])
      const theirs = await run(a!, ['close', '2026-08-30_a.md'])
      assert.equal(theirs.code, 1)
      assert.deepEqual(theirs.json, { ok: false, reason: 'not-holder', holder: 'agent-b', file: '2026-08-30_a.md' })
    } finally {
      await rm(otherParent, RETRIED_RM)
    }
    const closed = await run(a!, ['close', '2026-08-31_c.md'])
    assert.deepEqual(closed.json, { ok: true, file: 'tickets/2026-08-31_c.md' })
    const left = (await git(['ls-tree', '--name-only', `${DATA_BRANCH}:tickets`], bare)).split('\n').filter(Boolean)
    // b's claim on a.md stands: the close touched c's files only.
    assert.deepEqual(left.sort(), ['2026-08-29_b.md', '2026-08-29_b.plan.md', '2026-08-30_a.lock.md', '2026-08-30_a.md', 'meta.json'])
    assert.equal((await run(a!, ['close', '2026-08-31_c.md'])).json.reason, 'no-ticket')
  } finally {
    await cleanup()
  }
})

test('a repository with no remote, or one that keeps its records, reads and writes its local branch; outside a repository is a refusal', async () => {
  const solo = await realpath(await mkdtemp(join(tmpdir(), 'tickets-cli-solo-')))
  try {
    await git(['init', '-b', 'main'], solo)
    await git(['config', 'user.email', 's@s'], solo)
    await git(['config', 'user.name', 's'], solo)
    await writeFile(join(solo, 'README.md'), '# t\n')
    await git(['add', '-A'], solo)
    await git(['commit', '-m', 'init'], solo)
    const commit = (await git(['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'create the agent-data branch'], solo)).trim()
    await git(['branch', DATA_BRANCH, commit], solo)
    assert.deepEqual((await run(solo, ['list'])).json, [])
    // Nothing to carry the change anywhere: it lands as a local commit, and the next read has it.
    assert.equal((await run(solo, ['put', '2026-08-31_c.md'], '# C\n')).code, 0)
    assert.equal(((await run(solo, ['list'])).json as unknown[]).length, 1)
    // A remote the person does not share the records with changes nothing: the write stays here.
    const bare = join(solo, 'origin.git')
    await git(['init', '--bare', '-b', 'main', bare], solo)
    await git(['remote', 'add', 'origin', bare], solo)
    await git(['push', 'origin', 'main'], solo)
    assert.equal((await run(solo, ['put', '2026-08-31_d.md'], '# D\n')).code, 0)
    assert.equal(((await run(solo, ['list'])).json as unknown[]).length, 2)
    assert.equal((await git(['for-each-ref', '--format=%(refname)', 'refs/heads'], bare)).trim(), 'refs/heads/main')
    const outside = await run(tmpdir(), ['list'])
    assert.equal(outside.code, 1)
    assert.deepEqual(outside.json, { ok: false, reason: 'not-a-repo' })
  } finally {
    await rm(solo, RETRIED_RM)
  }
})

test('--local reads this machine\'s copy of the branch with no fetch, so a push from elsewhere shows only on the next sync', async () => {
  const { seed, agents, cleanup } = await rig(1)
  const [a] = agents
  try {
    // The seed clone holds the branch locally; a pushes a third ticket as a remote writer.
    assert.equal((await run(a!, ['put', '2026-08-31_c.md'], '# C\n')).code, 0)
    const local = await run(seed, ['list', '--local'])
    assert.equal(local.code, 0)
    assert.deepEqual(local.json.map((t: { file: string }) => t.file), ['2026-08-30_a.md', '2026-08-29_b.md'])
    // `show` and `meta` take the flag the same way.
    const show = await run(seed, ['show', '2026-08-29_b.md', '--local'])
    assert.equal(show.code, 0)
    assert.match(show.json.plan, /^Effort: 1/)
    assert.deepEqual((await run(seed, ['show', '2026-08-31_c.md', '--local'])).json, { ok: false, reason: 'no-ticket', file: '2026-08-31_c.md' })
    assert.deepEqual((await run(seed, ['meta', '--local'])).json, {})
    // The plain read fetches, and sees it.
    assert.deepEqual((await run(seed, ['list'])).json.map((t: { file: string }) => t.file), ['2026-08-31_c.md', '2026-08-30_a.md', '2026-08-29_b.md'])
  } finally {
    await cleanup()
  }
})

test('release --force lifts anyone\'s claim, needs no identity, and still refuses a ticket nobody holds', async () => {
  const { bare, agents, cleanup } = await rig(2)
  const [a, b] = agents
  try {
    assert.equal((await run(a!, ['claim', '2026-08-30_a.md'])).code, 0)
    // b is not the holder: refused without the flag, done with it.
    assert.equal((await run(b!, ['release', '2026-08-30_a.md'])).json.reason, 'not-holder')
    const forced = await run(b!, ['release', '2026-08-30_a.md', '--force'])
    assert.equal(forced.code, 0)
    assert.deepEqual(forced.json, { ok: true, file: 'tickets/2026-08-30_a.md' })
    await assert.rejects(git(['show', `${DATA_BRANCH}:tickets/2026-08-30_a.lock.md`], bare))
    assert.deepEqual((await run(b!, ['release', '2026-08-30_a.md', '--force'])).json, { ok: false, reason: 'no-lock', file: '2026-08-30_a.md' })
    // A detached HEAD has no identity to release as, but can still force.
    await git(['checkout', '--detach'], b!)
    assert.equal((await run(b!, ['claim', '2026-08-30_a.md'])).json.reason, 'no-identity')
    assert.equal((await run(a!, ['claim', '2026-08-30_a.md'])).code, 0)
    assert.equal((await run(b!, ['release', '2026-08-30_a.md', '--force'])).code, 0)
  } finally {
    await cleanup()
  }
})
