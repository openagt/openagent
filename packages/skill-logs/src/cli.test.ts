import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, writeSharing, DATA_BRANCH } from '@openagt/agent-data'
import { runCli, USAGE, DEFAULT_LIMIT } from './cli.js'
import { RUNS_DIR } from './names.js'

const git = nodeGitRunner()
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const

const R1 = '2026-07-04T00-00-00-000Z'
const R2 = '2026-07-05T00-00-00-000Z'
const R3 = '2026-07-06T00-00-00-000Z'
const card = (id: string, over: Record<string, unknown> = {}) => ({ id, startedAt: id.replace(/-(\d\d)-(\d\d)-(\d\d\d)Z$/, ':$1:$2.$3Z'), status: 'done', ...over })

/** The runs on the branch: two people, three runs, one diary with the writer's lines among the agent's. */
const RUNS: Record<string, string> = {
  [`a@a/${R1}.json`]: JSON.stringify(card(R1, { intent: 'first try', branch: 'agent-r1', status: 'failed', caller: { pid: 1, host: 'laptop' } })),
  [`a@a/${R1}.jsonl`]: [
    '{"kind":"session","driver":"claude-code"}',
    '{"kind":"said","text":"Reading the ticket."}',
    '{"kind":"action","label":"Bash"}',
    '{"kind":"result","text":"Could not finish."}',
    '{"kind":"cost","usd":0.5,"inputTokens":9}',
    '{"kind":"ended","status":"failed","detail":"API 500"}',
    '',
  ].join('\n'),
  [`b@b/${R2}.json`]: JSON.stringify(card(R2, { intent: 'second try', branch: 'agent-r2', pr: { number: 3, url: 'https://x/pull/3' }, cost: 1.25 })),
  [`b@b/${R2}.jsonl`]: '{"kind":"ended","status":"done"}\n',
  [`b@b/${R3}.json`]: JSON.stringify(card(R3, { intent: 'unrelated', branch: 'agent-r3' })),
  'b@b/notes.md': 'not a run\n',
}

/** A bare origin with an `agent-data` branch holding `runs`, plus N clones acting as agents. */
async function rig(clones: number, runs: Record<string, string> = RUNS) {
  const bare = await realpath(await mkdtemp(join(tmpdir(), 'logs-cli-bare-')))
  await git(['init', '--bare', '-b', 'main', bare], bare)
  const seed = await realpath(await mkdtemp(join(tmpdir(), 'logs-cli-seed-')))
  await git(['clone', bare, seed], seed)
  await git(['config', 'user.email', 's@s'], seed)
  await git(['config', 'user.name', 's'], seed)
  await writeFile(join(seed, 'README.md'), '# t\n')
  await git(['add', '-A'], seed)
  await git(['commit', '-m', 'init'], seed)
  await git(['push', 'origin', 'main'], seed)
  const commit = (await git(['commit-tree', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-m', 'create the agent-data branch'], seed)).trim()
  await git(['checkout', '-B', DATA_BRANCH, commit], seed)
  for (const [rel, content] of Object.entries(runs)) {
    await mkdir(join(seed, RUNS_DIR, rel, '..'), { recursive: true })
    await writeFile(join(seed, RUNS_DIR, rel), content)
  }
  if (Object.keys(runs).length) {
    await git(['add', '-A'], seed)
    await git(['commit', '-m', 'seed'], seed)
  }
  await git(['push', 'origin', DATA_BRANCH], seed)
  // Every clone here shares the records with origin: the person's yes, given once per clone.
  await writeSharing(seed, true)
  const agents: string[] = []
  for (let i = 0; i < clones; i++) {
    const parent = await realpath(await mkdtemp(join(tmpdir(), `logs-cli-agent${i}-`)))
    const clone = join(parent, 'clone')
    await git(['clone', bare, clone], parent)
    await git(['checkout', '-b', `agent-a${i}`], clone)
    // `delete` and `patch` commit: a runner with no git identity (Linux CI) refuses to.
    await git(['config', 'user.email', `a${i}@a`], clone)
    await git(['config', 'user.name', `a${i}`], clone)
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

test('the bare command lists every person\'s runs off origin, newest first, the package\'s fields only; --branch and --limit narrow it', async () => {
  const { agents, cleanup } = await rig(1)
  const [a] = agents
  try {
    const all = await run(a!, [])
    assert.equal(all.code, 0)
    assert.deepEqual(
      all.json.map((c: { id: string }) => c.id),
      [R3, R2, R1],
    )
    assert.deepEqual(all.json[2], { ...card(R1), intent: 'first try', branch: 'agent-r1', status: 'failed', person: 'a@a' }, 'caller is the writer\'s, not printed; the person the run is kept under is')
    assert.deepEqual((await run(a!, ['--branch', 'agent-r3'])).json.map((c: { id: string }) => c.id), [R3])
    assert.deepEqual((await run(a!, ['--limit', '1'])).json.map((c: { id: string }) => c.id), [R3])
    assert.deepEqual((await run(a!, ['--branch', 'agent-r1', '--limit', '1'])).json.map((c: { id: string }) => c.id), [R1], 'the cap counts matches')
    // Nothing lands locally: the agent's clone holds no copy of the branch.
    await assert.rejects(git(['rev-parse', '--verify', DATA_BRANCH], a!))
    assert.equal((await git(['status', '--porcelain'], a!)).trim(), '')
  } finally {
    await cleanup()
  }
})

test('the bare command caps at the default limit', async () => {
  const many: Record<string, string> = {}
  for (let i = 0; i < DEFAULT_LIMIT + 5; i++) {
    const id = `2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z`
    many[`p@p/${id}.json`] = JSON.stringify(card(id))
  }
  const { agents, cleanup } = await rig(1, many)
  try {
    assert.equal((await run(agents[0]!, [])).json.length, DEFAULT_LIMIT)
    assert.equal((await run(agents[0]!, ['--limit', '100'])).json.length, DEFAULT_LIMIT + 5)
  } finally {
    await cleanup()
  }
})

test('show prints the card with the agent\'s lines of the diary, never the writer\'s; an unknown run is refused', async () => {
  const { agents, cleanup } = await rig(1)
  const [a] = agents
  try {
    const shown = await run(a!, ['show', R1])
    assert.equal(shown.code, 0)
    assert.deepEqual(shown.json, {
      ...card(R1),
      intent: 'first try',
      branch: 'agent-r1',
      status: 'failed',
      diary: [
        { kind: 'said', text: 'Reading the ticket.' },
        { kind: 'result', text: 'Could not finish.' },
        { kind: 'cost', usd: 0.5, inputTokens: 9 },
        { kind: 'ended', status: 'failed', detail: 'API 500' },
      ],
    })
    assert.deepEqual((await run(a!, ['show', R3])).json.diary, [], 'no diary file: no lines')
    const missing = await run(a!, ['show', '2026-01-01T00-00-00-000Z'])
    assert.equal(missing.code, 1)
    assert.deepEqual(missing.json, { ok: false, reason: 'no-run', id: '2026-01-01T00-00-00-000Z' })
    assert.match(missing.stderr, /no run is named/)
  } finally {
    await cleanup()
  }
})

test('usage: an unknown command, a stray argument, a bad limit and an unsafe id', async () => {
  const { agents, cleanup } = await rig(1, {})
  const [a] = agents
  try {
    const unknown = await run(a!, ['dance'])
    assert.equal(unknown.code, 2)
    assert.equal(unknown.json, undefined)
    assert.equal(unknown.stderr, USAGE)
    assert.equal((await run(a!, ['--limit', '0'])).code, 2)
    assert.equal((await run(a!, ['--limit', 'many'])).code, 2)
    assert.equal((await run(a!, ['--nope'])).code, 2)
    assert.equal((await run(a!, ['show'])).code, 2)
    assert.equal((await run(a!, ['show', 'a', 'b'])).code, 2)
    assert.equal((await run(a!, ['show', '../escape'])).code, 2)
    assert.deepEqual((await run(a!, [])).json, [], 'no runs yet reads as none')
  } finally {
    await cleanup()
  }
})

test('a repository with no remote reads its local branch; outside a repository is a refusal', async () => {
  const solo = await realpath(await mkdtemp(join(tmpdir(), 'logs-cli-solo-')))
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
    const outside = await run(tmpdir(), [])
    assert.equal(outside.code, 1)
    assert.deepEqual(outside.json, { ok: false, reason: 'not-a-repo' })
  } finally {
    await rm(solo, RETRIED_RM)
  }
})

test('--local reads the checkout kept at .branches/agent-data, no fetch; --full prints caller and every diary line', async () => {
  const { agents, seed, cleanup } = await rig(1)
  const [a] = agents
  try {
    assert.deepEqual((await run(a!, ['--local'])).json, [], 'no checkout yet: nothing local, and nothing fetched')
    // The writer's persistent checkout, made the way a writer makes it: a patch through the funnel.
    assert.equal((await run(a!, ['patch', R3, '--branch', 'agent-r3b'])).code, 0)
    // A run pushed to origin afterwards is not in the local copy until the writer syncs.
    await git(['checkout', DATA_BRANCH], seed)
    await git(['pull', '--rebase', 'origin', DATA_BRANCH], seed)
    const R4 = '2026-07-07T00-00-00-000Z'
    await mkdir(join(seed, RUNS_DIR, 'b@b'), { recursive: true })
    await writeFile(join(seed, RUNS_DIR, 'b@b', `${R4}.json`), JSON.stringify(card(R4)))
    await git(['add', '-A'], seed)
    await git(['commit', '-m', 'r4'], seed)
    await git(['push', 'origin', DATA_BRANCH], seed)
    const local = await run(a!, ['--local'])
    assert.deepEqual(local.json.map((c: { id: string }) => c.id), [R3, R2, R1])
    assert.equal(local.json[0].branch, 'agent-r3b')
    assert.equal(local.json[2].caller, undefined, 'caller only with --full')
    const full = await run(a!, ['--local', '--full', '--limit', '5'])
    assert.deepEqual(full.json[2].caller, { pid: 1, host: 'laptop' })
    // Each run with the person it is kept under, whichever way the list is read.
    const people = ['b@b', 'b@b', 'a@a']
    assert.deepEqual(local.json.map((c: { person: string }) => c.person), people)
    assert.deepEqual(full.json.map((c: { person: string }) => c.person), people)
    const fromOrigin = await run(a!, [])
    assert.deepEqual(fromOrigin.json.map((c: { id: string }) => c.id), [R4, R3, R2, R1], 'without --local: origin, as before')
    assert.deepEqual(fromOrigin.json.map((c: { person: string }) => c.person), ['b@b', ...people])
    const shown = await run(a!, ['show', R1, '--local', '--full'])
    assert.equal(shown.code, 0)
    assert.deepEqual(shown.json.caller, { pid: 1, host: 'laptop' })
    assert.deepEqual(shown.json.diary.map((l: { kind: string }) => l.kind), ['session', 'said', 'action', 'result', 'cost', 'ended'], 'every line, the writer\'s too')
    assert.deepEqual((await run(a!, ['show', R1, '--full'])).json.diary.length, 6, '--full off origin too')
    assert.equal((await run(a!, ['show', R4, '--local'])).code, 1, 'not in the local copy yet')
  } finally {
    await cleanup()
  }
})

test('delete removes a run as one commit; patch sets the branch and the pull request, or that the work landed; an unknown run is refused', async () => {
  const { agents, bare, cleanup } = await rig(1)
  const [a] = agents
  try {
    const patched = await run(a!, ['patch', R1, '--branch', 'agent-r1-fix', '--pr', '9', '--pr-url', 'https://x/pull/9'])
    assert.equal(patched.code, 0)
    assert.deepEqual(patched.json, { ok: true, id: R1 })
    const card1 = (await run(a!, ['show', R1])).json
    assert.equal(card1.branch, 'agent-r1-fix')
    assert.deepEqual(card1.pr, { number: 9, url: 'https://x/pull/9' })
    // Landed: the branch is gone from the card, and the two commits are kept under the writer's key.
    const C = 'c'.repeat(40)
    const B = 'b'.repeat(40)
    assert.equal((await run(a!, ['patch', R1, '--landed', C, '--from', B])).code, 0)
    const landed = (await run(a!, ['show', R1, '--full'])).json
    assert.equal('branch' in landed, false)
    assert.equal(landed.caller.landed, C)
    assert.equal(landed.caller.baseCommit, B)
    assert.deepEqual(landed.pr, { number: 9, url: 'https://x/pull/9' }, 'the rest of the card stays')
    assert.equal((await run(a!, ['patch', R1, '--landed', C])).code, 2, 'landed needs where the work began')
    assert.equal((await run(a!, ['patch', R1, '--landed', 'abc', '--from', B])).code, 2, 'a full commit id')
    assert.equal((await run(a!, ['patch', R1, '--landed', C, '--from', B, '--branch', 'x'])).code, 2)
    const deleted = await run(a!, ['delete', R2])
    assert.equal(deleted.code, 0)
    assert.deepEqual((await run(a!, [])).json.map((c: { id: string }) => c.id), [R3, R1], 'gone from origin too: pushed')
    assert.match(await git(['log', '-1', '--format=%s', DATA_BRANCH], bare), /delete run/)
    const missing = await run(a!, ['delete', R2])
    assert.equal(missing.code, 1)
    assert.deepEqual(missing.json, { ok: false, reason: 'no-run', id: R2 })
    assert.equal((await run(a!, ['patch', R2, '--branch', 'x'])).code, 1)
    // A malformed command line is a usage error.
    assert.equal((await run(a!, ['patch', R1])).code, 2, 'nothing to set')
    assert.equal((await run(a!, ['patch', R1, '--pr', '9'])).code, 2, 'a pull request needs its url')
    assert.equal((await run(a!, ['patch', R1, '--pr', 'nine', '--pr-url', 'u'])).code, 2)
    assert.equal((await run(a!, ['delete'])).code, 2)
    assert.equal((await run(a!, ['delete', '../x'])).code, 2)
  } finally {
    await cleanup()
  }
})
