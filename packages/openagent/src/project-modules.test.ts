import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILT_IN_PACKAGES } from './built-in.js'
import { commandReads, findBroughtModule, findProjectModule, moduleFile, readProjectModules, runModuleCommand } from './project-modules.js'

async function tempDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)))
}

/** A package on disk: its package.json, plus any files by relative path. */
async function pkg(dir: string, manifest: Record<string, unknown>, files: Record<string, string> = {}): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(dir, rel, '..'), { recursive: true })
    await writeFile(join(dir, rel), body)
  }
}

test('a project\'s modules are the dependencies whose package exports ./dashboard to a file inside it', async () => {
  const root = await tempDir('openagent-modules-')
  const elsewhere = await tempDir('openagent-modules-linked-')
  try {
    await pkg(root, {
      dependencies: { '@acme/logs': '1', plain: '1', missing: '1', escapes: '1', 'no-file': '1' },
      devDependencies: { linked: '1', conditional: '1' },
    })
    const nodeModules = join(root, "node_modules")
    await pkg(join(nodeModules, '@acme/logs'), { name: '@acme/logs', version: '1.2.3', exports: { '.': './index.js', './dashboard': './dist/dashboard.js' }, bin: { logs: 'bin/logs' } }, { 'dist/dashboard.js': 'export default {}' })
    // No module: a package without the export, one not installed, one whose export leaves the package, one whose file is absent.
    await pkg(join(nodeModules, 'plain'), { name: 'plain', exports: { '.': './index.js' } })
    await pkg(join(nodeModules, 'escapes'), { name: 'escapes', exports: { './dashboard': '../plain/package.json' } })
    await pkg(join(nodeModules, 'no-file'), { name: 'no-file', exports: { './dashboard': './dist/dashboard.js' } })
    // A workspace link reads like an install; a conditional export is read through its browser/import/default target.
    await pkg(elsewhere, { name: 'linked', bin: './cli.js', exports: { './dashboard': './w/index.js' } }, { 'w/index.js': 'export default {}' })
    await symlink(elsewhere, join(nodeModules, 'linked'))
    await pkg(join(nodeModules, 'conditional'), { name: 'conditional', exports: { './dashboard': { types: './d.ts', import: './esm/w.js' } } }, { 'esm/w.js': 'export default {}' })

    const modules = (await readProjectModules(root)).filter(module => !BUILT_IN_PACKAGES.includes(module.package))
    assert.deepEqual(
      modules.map(w => ({ package: w.package, entry: w.entry, bins: Object.keys(w.bins) })),
      [
        { package: '@acme/logs', entry: 'dashboard.js', bins: ['logs'] },
        { package: 'conditional', entry: 'w.js', bins: [] },
        { package: 'linked', entry: 'index.js', bins: ['linked'] },
      ],
    )
    assert.equal(modules[0]!.version, '1.2.3')
    assert.equal(modules[0]!.dir, join(nodeModules, '@acme/logs', 'dist'))
    assert.equal(modules[2]!.dir, join(elsewhere, 'w'), 'the link is followed to the package itself')

    // A project with no package.json brings none of its own: it has the built-in packages that are modules, only.
    assert.deepEqual((await readProjectModules(join(root, 'node_modules'))).map(module => module.package), ['@openagt/changes', '@openagt/files', '@openagt/skill-logs'])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(elsewhere, { recursive: true, force: true })
  }
})

test('a module may bring a server part; every project has the built-in modules, and one of their names among its own dependencies is not read', async () => {
  const root = await tempDir('openagent-modules-server-')
  try {
    await pkg(root, { dependencies: { withServer: '1', '@openagt/files': '1' } })
    const nodeModules = join(root, 'node_modules')
    await pkg(join(nodeModules, 'withServer'), { name: 'withServer', exports: { './dashboard': './d.js', './server': { node: './s.js' } } }, { 'd.js': 'export default {}', 's.js': 'export default { reads: {} }' })
    await pkg(join(nodeModules, '@openagt/files'), { name: '@openagt/files', version: '9.9.9', exports: { './dashboard': './d.js' } }, { 'd.js': 'export default {}' })

    const modules = await readProjectModules(root)
    assert.equal(modules.find(module => module.package === 'withServer')?.server, join(nodeModules, 'withServer', 's.js'))
    const files = modules.filter(module => module.package === '@openagt/files')
    assert.equal(files.length, 1)
    assert.notEqual(files[0]!.version, '9.9.9', 'OpenAgent’s copy, not the one the project lists')
    assert.ok(files[0]!.server, 'with its server part, which the project’s copy has none of')

    // Without its own copy, a project has OpenAgent's: its browser part and its server part.
    const builtIn = (await readProjectModules(join(root, 'no-such-project'))).find(module => module.package === '@openagt/files')
    assert.ok(builtIn, 'the built-in Files module is there for every project')
    assert.ok(builtIn.server, 'with its server part')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a module serves only the files inside its module\'s own directory', async () => {
  const root = await tempDir('openagent-module-files-')
  try {
    await pkg(root, { dependencies: { w: '1' } })
    const dir = join(root, 'node_modules', 'w')
    await pkg(dir, { name: 'w', exports: { './dashboard': './dist/dashboard.js' } }, { 'dist/dashboard.js': 'x', 'dist/dashboard.css': 'y', 'dist/chunks/a.js': 'z', 'secret.txt': 's' })
    await symlink(join(dir, 'secret.txt'), join(dir, 'dist', 'sneaky.txt'))
    const module = (await findProjectModule(root, 'w'))!

    assert.equal(await moduleFile(module, 'dashboard.css'), join(dir, 'dist', 'dashboard.css'))
    assert.equal(await moduleFile(module, 'chunks/a.js'), join(dir, 'dist', 'chunks', 'a.js'))
    for (const outside of ['../secret.txt', '../package.json', '../../../package.json', 'sneaky.txt', 'chunks', '', 'nope.js'])
      assert.equal(await moduleFile(module, outside), undefined, `${JSON.stringify(outside)} is not served`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a module runs its own package\'s command in the project and gets its JSON, or the reason it has none', async () => {
  const root = await tempDir('openagent-module-command-')
  try {
    await pkg(root, { dependencies: { one: '1', two: '1' } })
    const script = (body: string) => `#!/usr/bin/env node\n${body}\n`
    await pkg(join(root, 'node_modules', 'one'), { name: 'one', bin: { one: 'bin/one' }, exports: { './dashboard': './w.js' } }, {
      'w.js': 'export default {}',
      'bin/one': script(`
const args = process.argv.slice(2)
if (args[0] === 'fail') { console.error('first line'); console.error('refused: no such run'); process.exit(1) }
if (args[0] === 'words') { console.log('not json'); process.exit(0) }
if (args[0] === 'said') { console.log(JSON.stringify(process.env.OPENAGENT_COMPUTER ?? null)); process.exit(0) }
console.log(JSON.stringify({ args, cwd: process.cwd() }))`),
    })
    await pkg(join(root, 'node_modules', 'two'), { name: 'two', bin: { a: 'bin/a', b: 'bin/b' }, exports: { './dashboard': './w.js' } }, {
      'w.js': 'export default {}',
      'bin/a': script('console.log(JSON.stringify("a"))'),
      'bin/b': script('console.log(JSON.stringify("b"))'),
    })
    const one = (await findProjectModule(root, 'one'))!
    const two = (await findProjectModule(root, 'two'))!

    assert.deepEqual(await runModuleCommand(root, one, ['--limit', '5']), { ok: true, output: { args: ['--limit', '5'], cwd: root } })
    // What the caller hands over is what the command is started with: which computer this is, for a command of the computer's own, and nothing for any other.
    assert.deepEqual(await runModuleCommand(root, one, ['said'], undefined, { OPENAGENT_COMPUTER: 'a'.repeat(32) }), { ok: true, output: 'a'.repeat(32) })
    assert.deepEqual(await runModuleCommand(root, one, ['said']), { ok: true, output: null })
    assert.deepEqual(await runModuleCommand(root, one, ['fail']), { ok: false, error: 'refused: no such run' })
    assert.deepEqual(await runModuleCommand(root, one, ['words']), { ok: false, error: 'one printed no JSON' })
    assert.deepEqual(await runModuleCommand(root, one, [], 'other'), { ok: false, error: 'one has no command other' })
    assert.deepEqual(await runModuleCommand(root, one, Array.from({ length: 40 }, () => 'x')), { ok: false, error: 'too many or too long arguments' })
    // A package with several commands must name one; named, it runs that one.
    assert.deepEqual(await runModuleCommand(root, two, []), { ok: false, error: 'two has several commands; name one' })
    assert.deepEqual(await runModuleCommand(root, two, [], 'b'), { ok: true, output: 'b' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a package says which of its commands only read; any other command, or a word after flags, changes something', async () => {
  const root = await tempDir('openagent-modules-reads-')
  try {
    await pkg(root, { dependencies: { tool: '1' } })
    await pkg(
      join(root, 'node_modules', 'tool'),
      {
        name: 'tool',
        exports: { './dashboard': './w.js' },
        bin: { tool: 'bin/tool', other: 'bin/other' },
        // A command it does not have, a list that is no list, a flag for a word: dropped.
        openagent: { tool: 'tool', reads: { tool: ['list', '', '--local', 7], nope: ['list'], other: 'status' } },
      },
      { 'w.js': 'export default {}' },
    )
    const module = (await findProjectModule(root, 'tool'))!
    assert.deepEqual(module.reads, { tool: ['list', ''] })
    for (const args of [['list'], ['list', '--local'], [], ['--local', '--full']]) assert.equal(commandReads(module, args, 'tool'), true, JSON.stringify(args))
    for (const args of [['add', 'x'], ['--local', 'add', 'x'], ['list', 7]]) assert.equal(commandReads(module, args, 'tool'), false, JSON.stringify(args))
    // A command of the package that names no reads, and a package of several commands asked with none named.
    assert.equal(commandReads(module, ['status'], 'other'), false)
    assert.equal(commandReads(module, ['list']), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the Queue's, Tickets' and Automations' packages say their reads: everything that writes, starts a run or runs a line is a change", async () => {
  const queue = (await findBroughtModule('@openagt/skill-queue'))!
  const tickets = (await findBroughtModule('@openagt/skill-tickets'))!
  const scheduler = (await findBroughtModule('@openagt/skill-scheduler'))!
  assert.deepEqual([queue.reads, tickets.reads, scheduler.reads], [{ queue: [''] }, { tickets: ['list', 'show', 'meta'] }, { scheduler: ['status', 'show'] }])
  const reads = (module: typeof queue, ...args: string[]): boolean => commandReads(module, args)
  assert.deepEqual([reads(queue, '--local', '--full'), reads(queue, 'add', 'x'), reads(queue, 'done', 'x')], [true, false, false])
  assert.deepEqual([reads(tickets, 'list', '--local'), reads(tickets, 'show', 'a.md', '--local'), reads(tickets, 'meta'), reads(tickets, 'release', 'a.md', '--force'), reads(tickets, 'put', 'a.md')], [true, true, true, false, false])
  assert.deepEqual([reads(scheduler, 'status'), reads(scheduler, 'show', 'x'), reads(scheduler, 'now', 'x'), reads(scheduler, 'try', '--when=ls'), reads(scheduler, 'write-line', '--words=x'), reads(scheduler, 'switch', 'x', 'on')], [true, true, false, false, false, false])
  // OpenAgent's own copy is only of the packages it brings to projects.
  assert.equal(await findBroughtModule('@openagt/devices'), undefined)
  assert.equal(await findBroughtModule('left-pad'), undefined)
})
