import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseQueueEntries, providedQueue } from './queue.js'

// The queue contract (#1774): a project's package declares `"openagent": { "queue": "<command>" }`
// and OpenAgent reads the queue by running `<command> --local`. Real processes: a tiny
// provider script that logs each call it answers, in a throwaway project.

/** A provider command: prints the entries of a JSON file, logging every call. */
const PROVIDER = `
const { readFileSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')
appendFileSync(join(__dirname, 'calls.log'), process.argv.slice(2).join(' ') + '\\n')
process.stdout.write(readFileSync(join(__dirname, 'queue.json'), 'utf8'))
`

/** A project whose package.json lists `deps`, each installed under node_modules with its own package.json. */
async function project(deps: Record<string, Record<string, unknown>>, queue = '["- one", "two"]'): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-queue-')))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: Object.fromEntries(Object.keys(deps).map(name => [name, '*'])) }))
  for (const [name, manifest] of Object.entries(deps)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
    await writeFile(join(dir, 'provider.cjs'), PROVIDER)
    await writeFile(join(dir, 'queue.json'), queue)
  }
  return root
}

const calls = async (root: string, pkg: string): Promise<string[]> =>
  (await readFile(join(root, 'node_modules', pkg, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)

test('a project with no queue provider has no queue; one with a provider is read through `<command> --local`', async () => {
  const none = await project({ plain: { bin: { plain: 'provider.cjs' } } })
  const root = await project({ queue: { bin: { queue: 'provider.cjs' }, openagent: { queue: 'queue' } } })
  try {
    assert.equal(await providedQueue()(none), undefined)
    const queue = await providedQueue()(root)
    assert.ok(queue)
    assert.deepEqual(await queue.list(), ['- one', 'two'])
    assert.deepEqual(await calls(root, 'queue'), ['--local'])
  } finally {
    await rm(none, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test('reads within the window share one call; changed() forgets the read; a failed read is not kept', async () => {
  const root = await project({ queue: { bin: { queue: 'provider.cjs' }, openagent: { queue: 'queue' } } })
  try {
    let clock = 1_000_000
    const reader = providedQueue(() => clock)
    const queue = (await reader(root))!
    const [a, b] = await Promise.all([queue.list(), queue.list()])
    assert.equal(a, b, 'two reads at once are one call')
    await queue.list()
    assert.equal((await calls(root, 'queue')).length, 1, 'a read within the window is not a call')
    clock += 5_000
    await queue.list()
    assert.equal((await calls(root, 'queue')).length, 2, 'past the window: read again')
    reader.changed(root)
    await queue.list()
    assert.equal((await calls(root, 'queue')).length, 3, 'the clock never moved: only the forget explains a fresh read')
    reader.changed(root, '@acme/tickets')
    await queue.list()
    assert.equal((await calls(root, 'queue')).length, 3, 'another package\'s command ran: the queue stays read')
    reader.changed(root, 'queue')
    await queue.list()
    assert.equal((await calls(root, 'queue')).length, 4, 'the providing package\'s command ran: read again')

    await writeFile(join(root, 'node_modules', 'queue', 'queue.json'), 'not json')
    reader.changed(root)
    assert.deepEqual(await queue.list(), [], 'no JSON: no entries')
    await writeFile(join(root, 'node_modules', 'queue', 'queue.json'), '["back"]')
    assert.deepEqual(await queue.list(), ['back'], 'the failed read was not kept for the window')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('parseQueueEntries keeps the non-empty strings of an array, trimmed, and nothing of anything else', () => {
  assert.deepEqual(parseQueueEntries([' a ', '', 3, null, 'b']), ['a', 'b'])
  assert.deepEqual(parseQueueEntries({ entries: ['a'] }), [])
  assert.deepEqual(parseQueueEntries('a'), [])
})

/** The provider's command line as the function its command calls, exported by the package: each call logged as `in <args>` with where it ran. */
const PROVIDER_CLI = `
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
export async function runCli(args, io) {
  appendFileSync(join(dir, 'calls.log'), 'in ' + args.join(' ') + ' @' + io.cwd + '\\n')
  return io.stdout(readFileSync(join(dir, 'queue.json'), 'utf8')), 0
}
`

test("a provider whose package exports its command's function is read in this process: no command is run", async () => {
  const root = await project({ inqueue: { type: 'module', exports: { '.': './cli.mjs' }, bin: { queue: 'provider.cjs' }, openagent: { queue: 'queue' } } })
  try {
    await writeFile(join(root, 'node_modules', 'inqueue', 'cli.mjs'), PROVIDER_CLI)
    assert.deepEqual(await (await providedQueue()(root))!.list(), ['- one', 'two'])
    assert.deepEqual(await calls(root, 'inqueue'), [`in --local @${root}`], 'the answer came from the function, in the project; the command never ran')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
