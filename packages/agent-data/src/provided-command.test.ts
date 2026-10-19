import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lookupProvidedCommand, readProvidedCommand, runPackageCommand } from './provided-command.js'

// Which package provides a kind (#1774, #1820), against real files: a throwaway project whose
// package.json lists dependencies, each installed under node_modules with its own package.json.

const ECHO = `process.stdout.write(JSON.stringify(process.argv.slice(2)))`

/** A project listing `deps`; `named` is the project's own `openagent` key, when given. */
async function project(deps: Record<string, Record<string, unknown>>, named?: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'provided-command-')))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: Object.fromEntries(Object.keys(deps).map(name => [name, '*'])), ...(named ? { openagent: named } : {}) }))
  for (const [name, manifest] of Object.entries(deps)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
    await writeFile(join(dir, 'cmd.cjs'), ECHO)
  }
  return root
}

test('one package declaring a kind provides it; a declaration naming no command of the package is none; nobody declaring is nothing, and no problem', async () => {
  const root = await project({
    plain: { bin: { plain: 'cmd.cjs' } },
    'wrong-bin': { bin: { a: 'cmd.cjs' }, openagent: { runs: 'b' } },
    logs: { bin: { logs: 'cmd.cjs' }, openagent: { runs: 'logs' } },
  })
  try {
    const found = await lookupProvidedCommand(root, 'runs')
    assert.equal(found.command?.package, 'logs')
    assert.equal(found.command?.name, 'logs')
    assert.equal(found.command?.bin, join(root, 'node_modules', 'logs', 'cmd.cjs'))
    assert.equal(found.problem, undefined)
    assert.deepEqual(await lookupProvidedCommand(root, 'tickets'), {}, 'another kind: nobody declares it, and that is no problem')
    assert.equal(await readProvidedCommand(root, 'tickets'), undefined)
    assert.deepEqual(await lookupProvidedCommand(join(root, 'nowhere'), 'runs'), {}, 'no package.json: nothing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('two packages declaring a kind: the one the project names provides; none named is none, with the reason; a name that does not provide it is none, said', async () => {
  const two = { github: { bin: { github: 'cmd.cjs' }, openagent: { 'git-host': 'github' } }, gitlab: { bin: { gitlab: 'cmd.cjs' }, openagent: { 'git-host': 'gitlab' } } }
  const unnamed = await project(two)
  const named = await project(two, { 'git-host': 'gitlab' })
  const wrong = await project(two, { 'git-host': 'plain' })
  const wrongAlone = await project({ github: two.github }, { 'git-host': 'plain' })
  try {
    const none = await lookupProvidedCommand(unnamed, 'git-host')
    assert.equal(none.command, undefined, 'never the first in dependency order')
    assert.equal(none.problem, '2 packages provide git-host: github, gitlab; name one under "openagent" in package.json')
    assert.equal(await readProvidedCommand(unnamed, 'git-host'), undefined)

    const picked = await lookupProvidedCommand(named, 'git-host')
    assert.equal(picked.command?.package, 'gitlab')
    assert.equal(picked.problem, undefined)

    assert.deepEqual(await lookupProvidedCommand(wrong, 'git-host'), { problem: 'package.json names plain for git-host, which does not provide it; the providers are github, gitlab' })
    assert.deepEqual(await lookupProvidedCommand(wrongAlone, 'git-host'), { problem: 'package.json names plain for git-host, which does not provide it; the providers are github' }, 'a wrong name is wrong even with one provider')
  } finally {
    for (const root of [unnamed, named, wrong, wrongAlone]) await rm(root, { recursive: true, force: true })
  }
})

test('packages the caller ships provide a kind only when none of the project\'s own packages declares it', async () => {
  const shippedRoot = await project({ shipped: { bin: { s: 'cmd.cjs' }, openagent: { runs: 's' } } })
  const shipped = [{ name: 'shipped', dir: join(shippedRoot, 'node_modules', 'shipped'), manifest: { name: 'shipped', bin: { s: 'cmd.cjs' }, openagent: { runs: 's' } } }]
  const bare = await project({ plain: { bin: { plain: 'cmd.cjs' } } })
  const own = await project({ logs: { bin: { records: 'cmd.cjs' }, openagent: { runs: 'records' } } })
  try {
    assert.equal((await lookupProvidedCommand(bare, 'runs', shipped)).command?.package, 'shipped')
    assert.equal((await lookupProvidedCommand(join(bare, 'nowhere'), 'runs', shipped)).command?.package, 'shipped', 'no package.json at all')
    assert.equal((await lookupProvidedCommand(own, 'runs', shipped)).command?.package, 'logs', 'the project\'s own package wins')
    assert.deepEqual(await lookupProvidedCommand(bare, 'tickets', shipped), {}, 'a kind no shipped package declares')
    // A name the caller brings itself is not read from the project: its copy there does not provide, shipped to this project or not.
    assert.deepEqual(await lookupProvidedCommand(own, 'runs', [], ['logs']), {}, 'reserved, and not shipped to this project')
    assert.equal((await lookupProvidedCommand(own, 'runs', shipped, ['logs'])).command?.package, 'shipped', 'reserved: the caller\'s own package provides')
    assert.equal((await lookupProvidedCommand(own, 'runs', shipped, ['other'])).command?.package, 'logs', 'another name reserved changes nothing')
  } finally {
    for (const dir of [shippedRoot, bare, own]) await rm(dir, { recursive: true, force: true })
  }
})

test('a package command runs with Node in the project and answers its JSON, its last stderr line, or that it printed none', async () => {
  const root = await project({ tool: { bin: { tool: 'cmd.cjs' }, openagent: { thing: 'tool' } } })
  const dir = join(root, 'node_modules', 'tool')
  await writeFile(join(dir, 'fails.cjs'), `process.stderr.write('first\\nno such thing\\n'); process.exit(1)`)
  await writeFile(join(dir, 'text.cjs'), `process.stdout.write('hello')`)
  await writeFile(join(dir, 'cwd.cjs'), `process.stdout.write(JSON.stringify(process.cwd()))`)
  try {
    const command = (await readProvidedCommand(root, 'thing'))!
    assert.deepEqual(await runPackageCommand(root, command, ['list', '--all']), { ok: true, output: ['list', '--all'] })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'fails.cjs') }, []), { ok: false, error: 'no such thing' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'text.cjs') }, []), { ok: false, error: 'tool printed no JSON' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'cwd.cjs') }, []), { ok: true, output: await realpath(root) })
    // What a caller adds is what the command is started with, beside what this process has, and for that command alone.
    await writeFile(join(dir, 'said.cjs'), `process.stdout.write(JSON.stringify([process.env.OPENAGENT_TEST_SAID ?? null, typeof process.env.PATH]))`)
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'said.cjs') }, [], { OPENAGENT_TEST_SAID: 'a word' }), { ok: true, output: ['a word', 'string'] })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'said.cjs') }, []), { ok: true, output: [null, 'string'] })
    assert.equal(process.env.OPENAGENT_TEST_SAID, undefined)
    // What it is handed it reads on standard input; a command handed nothing reads an input that ended, and waits for nothing.
    await writeFile(join(dir, 'read.cjs'), `let s = ''; process.stdin.on('data', d => (s += d)).on('end', () => process.stdout.write(JSON.stringify(s)))`)
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'read.cjs') }, [], undefined, 'a login'), { ok: true, output: 'a login' })
    assert.deepEqual(await runPackageCommand(root, { name: 'tool', bin: join(dir, 'read.cjs') }, []), { ok: true, output: '' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
