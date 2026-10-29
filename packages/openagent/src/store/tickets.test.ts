import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTickets, providedTickets } from './tickets.js'

// The tickets contract (#1774): a project's package declares `"openagent": { "tickets": "<command>" }`
// and OpenAgent reads the tickets by running `<command> list --local`. Real processes: a tiny
// provider script that logs each call it answers, in a throwaway project.

/** A provider command: prints the rows of a JSON file, logging every call. */
const PROVIDER = `
const { readFileSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')
appendFileSync(join(__dirname, 'calls.log'), process.argv.slice(2).join(' ') + '\\n')
process.stdout.write(readFileSync(join(__dirname, 'tickets.json'), 'utf8'))
`

const ROW = { file: '2026-01-01_a.md', title: 'A', summary: 'the first', date: '2026-01-01T00:00:00.000Z', planned: false, priority: '8' }

/** A project whose package.json lists `deps`, each installed under node_modules with its own package.json. */
async function project(deps: Record<string, Record<string, unknown>>, tickets = JSON.stringify([ROW])): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-tickets-')))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: Object.fromEntries(Object.keys(deps).map(name => [name, '*'])) }))
  for (const [name, manifest] of Object.entries(deps)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
    await writeFile(join(dir, 'provider.cjs'), PROVIDER)
    await writeFile(join(dir, 'tickets.json'), tickets)
  }
  return root
}

const calls = async (root: string, pkg: string): Promise<string[]> =>
  (await readFile(join(root, 'node_modules', pkg, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)

test('a project with no tickets provider has no tickets; one with a provider is read through `<command> list --local`', async () => {
  const none = await project({ plain: { bin: { plain: 'provider.cjs' } } })
  const root = await project({ tickets: { bin: { tickets: 'provider.cjs' }, openagent: { tickets: 'tickets' } } })
  try {
    assert.equal(await providedTickets()(none), undefined)
    const tickets = await providedTickets()(root)
    assert.ok(tickets)
    assert.deepEqual(await tickets.list(), [ROW])
    assert.deepEqual(await calls(root, 'tickets'), ['list --local'])
  } finally {
    await rm(none, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test('reads within the window share one call; changed() forgets the read; a failed read is not kept', async () => {
  const root = await project({ tickets: { bin: { tickets: 'provider.cjs' }, openagent: { tickets: 'tickets' } } })
  try {
    let clock = 1_000_000
    const reader = providedTickets(() => clock)
    const tickets = (await reader(root))!
    const [a, b] = await Promise.all([tickets.list(), tickets.list()])
    assert.equal(a, b, 'two reads at once are one call')
    await tickets.list()
    assert.equal((await calls(root, 'tickets')).length, 1, 'a read within the window is served from the last')
    reader.changed(root)
    await tickets.list()
    assert.equal((await calls(root, 'tickets')).length, 2, 'changed() runs the command again')
    clock += 6_000
    await writeFile(join(root, 'node_modules', 'tickets', 'tickets.json'), 'not json')
    assert.deepEqual(await (await reader(root))!.list(), [], 'a provider printing no JSON is no tickets')
    await writeFile(join(root, 'node_modules', 'tickets', 'tickets.json'), JSON.stringify([ROW]))
    assert.deepEqual(await (await reader(root))!.list(), [ROW], 'the failed read was not kept for the window')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('parseTickets keeps the rows with the five plain facts and drops the rest', () => {
  assert.deepEqual(parseTickets('nope'), [])
  assert.deepEqual(parseTickets([ROW, { file: 'x.md' }, null, 'row', { ...ROW, file: '' }]), [ROW])
})

/** The provider's command line as the function its command calls, exported by the package: each call logged as `in <args>` with where it ran. */
const PROVIDER_CLI = `
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
export async function runCli(args, io) {
  appendFileSync(join(dir, 'calls.log'), 'in ' + args.join(' ') + ' @' + io.cwd + '\\n')
  return io.stdout(readFileSync(join(dir, 'tickets.json'), 'utf8')), 0
}
`

test("a provider whose package exports its command's function is read in this process: no command is run", async () => {
  const root = await project({ intickets: { type: 'module', exports: { '.': './cli.mjs' }, bin: { tickets: 'provider.cjs' }, openagent: { tickets: 'tickets' } } })
  try {
    await writeFile(join(root, 'node_modules', 'intickets', 'cli.mjs'), PROVIDER_CLI)
    assert.deepEqual(await (await providedTickets()(root))!.list(), [ROW])
    assert.deepEqual(await calls(root, 'intickets'), [`in list --local @${root}`], 'the answer came from the function, in the project; the command never ran')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
