import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProvidedCommand } from '@openagt/agent-data'
import { parseRunCard, providedRuns } from './runs.js'

// The finished-runs contract (#1774): a project's package declares `"openagent": { "runs": "<command>" }`
// and OpenAgent reads finished runs by running that command. These tests use real processes:
// a tiny provider script that logs each call it answers, in a throwaway project.

/** A provider command: answers the contract's command line from a JSON file of runs, logging every call. */
const PROVIDER = `
const { readFileSync, writeFileSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')
const dir = __dirname
const args = process.argv.slice(2)
appendFileSync(join(dir, 'calls.log'), args.join(' ') + '\\n')
const runs = JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8'))
const save = () => writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs))
if (args[0] === 'show') {
  const run = runs.find(r => r.id === args[1])
  if (!run) { process.stdout.write(JSON.stringify({ ok: false, reason: 'no-run' })); process.exit(1) }
  process.stdout.write(JSON.stringify({ ...run, diary: [{ kind: 'said', text: 'hi' }] }))
} else if (args[0] === 'delete') {
  const i = runs.findIndex(r => r.id === args[1]); if (i < 0) process.exit(1)
  runs.splice(i, 1); save(); process.stdout.write('{"ok":true}')
} else if (args[0] === 'patch') {
  const run = runs.find(r => r.id === args[1]); if (!run) process.exit(1)
  const at = args.indexOf('--branch'); if (at > 0) run.branch = args[at + 1]
  save(); process.stdout.write('{"ok":true}')
} else {
  process.stdout.write(JSON.stringify(runs))
}
`

/** A project whose package.json lists `deps`, each installed under node_modules with its own package.json. */
async function project(deps: Record<string, Record<string, unknown>>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-runs-')))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: Object.fromEntries(Object.keys(deps).map(name => [name, '*'])) }))
  for (const [name, manifest] of Object.entries(deps)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
    await writeFile(join(dir, 'provider.cjs'), PROVIDER)
    await writeFile(join(dir, 'runs.json'), JSON.stringify([{ id: 'r2', startedAt: '2026-07-05T00:00:00.000Z', status: 'done', caller: { pid: 7 } }, { id: 'r1', startedAt: '2026-07-04T00:00:00.000Z', status: 'failed' }]))
  }
  return root
}

const calls = async (root: string, pkg: string): Promise<string[]> =>
  (await readFile(join(root, 'node_modules', pkg, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)

test('the runs provider is the dependency that declares it, naming one of its own commands; none declares it, the built-in one provides', async () => {
  const root = await project({
    plain: { bin: { plain: 'provider.cjs' } },
    'wrong-bin': { bin: { a: 'provider.cjs' }, openagent: { runs: 'b' } },
    logs: { bin: { records: 'provider.cjs' }, openagent: { runs: 'records' } },
  })
  try {
    const found = await readProvidedCommand(root, 'runs')
    assert.equal(found?.package, 'logs', 'a declaration naming no command of the package is skipped')
    assert.equal(found?.name, 'records')
    assert.equal(await readProvidedCommand(root, 'tickets'), undefined, 'another kind: nobody declares it')
    const none = await project({ plain: { bin: { plain: 'provider.cjs' } } })
    try {
      assert.equal(await readProvidedCommand(none, 'runs'), undefined, 'none of the project\'s own packages')
      assert.ok(await providedRuns()(none), 'no package of its own: the built-in logs package reads its runs')
    } finally {
      await rm(none, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a provider is read through its command: whole cards with caller, one run with its diary; reads within the window share one call', async () => {
  const root = await project({ logs: { bin: { logs: 'provider.cjs' }, openagent: { runs: 'logs' } } })
  try {
    let clock = 1_000_000
    const runs = await providedRuns(() => clock)(root)
    assert.ok(runs)
    const [a, b] = await Promise.all([runs.list(), runs.list()])
    assert.deepEqual(a.map(card => card.id), ['r2', 'r1'])
    assert.deepEqual(a[0]!.caller, { pid: 7 })
    assert.equal(a, b, 'two reads at once are one call')
    await runs.list()
    assert.deepEqual(await calls(root, 'logs'), ['--local --full --limit 10000'], 'a read within the window is not a call')
    await runs.list({ fresh: true })
    assert.equal((await calls(root, 'logs')).length, 2, 'fresh skips the window')
    clock += 5_000
    await runs.list()
    assert.equal((await calls(root, 'logs')).length, 3, 'past the window: read again')

    const shown = await runs.show('r1')
    assert.equal(shown?.card.status, 'failed')
    assert.deepEqual(shown?.diary, [{ kind: 'said', text: 'hi' }])
    assert.equal(await runs.show('nope'), undefined, 'a refusal is no run')
    assert.equal(await runs.show('../escape'), undefined, 'an unsafe id never reaches the command')
    assert.equal((await calls(root, 'logs')).filter(line => line.startsWith('show')).length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/** The provider's command line as the function its command calls, exported by the package: each answer logged as `in <args>` with where it ran. */
const PROVIDER_CLI = `
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
export async function runCli(args, io) {
  appendFileSync(join(dir, 'calls.log'), 'in ' + args.join(' ') + ' @' + io.cwd + '\\n')
  const runs = JSON.parse(readFileSync(join(dir, 'runs.json'), 'utf8'))
  if (args[0] !== 'show') return io.stdout(JSON.stringify(runs)), 0
  const run = runs.find(r => r.id === args[1])
  if (!run) return io.stdout(JSON.stringify({ ok: false, reason: 'no-run' })), io.stderr('no run ' + args[1]), 1
  return io.stdout(JSON.stringify({ ...run, diary: [{ kind: 'said', text: 'hi' }] })), 0
}
`

test('a provider whose package exports its command\'s function is answered in this process: no command is run', async () => {
  const root = await project({ inlogs: { type: 'module', exports: { '.': './cli.mjs' }, bin: { logs: 'provider.cjs' }, openagent: { runs: 'logs' } } })
  try {
    await writeFile(join(root, 'node_modules', 'inlogs', 'cli.mjs'), PROVIDER_CLI)
    const runs = (await providedRuns(() => 0)(root))!
    assert.deepEqual((await runs.list()).map(card => card.id), ['r2', 'r1'])
    assert.deepEqual((await runs.show('r1'))?.diary, [{ kind: 'said', text: 'hi' }])
    assert.equal(await runs.show('nope'), undefined, 'a refusal is no run')
    assert.deepEqual(await calls(root, 'inlogs'), [`in --local --full --limit 10000 @${root}`, `in show r1 --local --full @${root}`, `in show nope --local --full @${root}`], 'every answer came from the function, in the project; the command never ran')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a patch and a delete go through the command and drop what was read, so the next read sees them', async () => {
  const root = await project({ logs: { bin: { logs: 'provider.cjs' }, openagent: { runs: 'logs' } } })
  try {
    const runs = (await providedRuns(() => 0)(root))!
    assert.equal((await runs.list())[1]!.branch, undefined)
    assert.deepEqual(await runs.patch('r1', { branch: 'agent-fix' }), { ok: true })
    assert.equal((await runs.list())[1]!.branch, 'agent-fix', 'the clock never moved: only the drop explains a fresh read')
    assert.deepEqual(await runs.remove('r2'), { ok: true })
    assert.deepEqual((await runs.list()).map(card => card.id), ['r1'])
    const refused = await runs.remove('r2')
    assert.equal(refused.ok, false, 'the command refused: said, not thrown')
    assert.ok((await calls(root, 'logs')).includes('patch r1 --branch agent-fix'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('parseRunCard keeps the shape\'s fields with the right types, and refuses what is not a card', () => {
  assert.deepEqual(parseRunCard({ id: 'r1', startedAt: 'x', status: 'done', cost: '1', pr: { number: 3, url: 'u' }, caller: { pid: 1 }, extra: 1 }), {
    id: 'r1',
    startedAt: 'x',
    status: 'done',
    pr: { number: 3, url: 'u' },
    caller: { pid: 1 },
  })
  assert.equal(parseRunCard('{"id":"r1","startedAt":"x","status":"done"}')?.id, 'r1')
  // The person a provider's list says the run is kept under; a person that is no word is none.
  assert.equal(parseRunCard({ id: 'r1', startedAt: 'x', status: 'done', person: 'me@x.dev' })?.person, 'me@x.dev')
  assert.equal(parseRunCard({ id: 'r1', startedAt: 'x', status: 'done', person: 3 })?.person, undefined)
  assert.equal(parseRunCard({ id: 'r1', startedAt: 'x', status: 'sleeping' }), undefined)
  // `unknown` is how a run reads while its computer does not answer, never what a card says.
  assert.equal(parseRunCard({ id: 'r1', startedAt: 'x', status: 'unknown' }), undefined)
  assert.equal(parseRunCard({ id: '../r1', startedAt: 'x', status: 'done' }), undefined)
  assert.equal(parseRunCard('not json'), undefined)
})
