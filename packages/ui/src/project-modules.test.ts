import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findBroughtModule, findProjectModule, moduleFile, readProjectModules, runModuleCommand } from './project-modules.js'
import { handDownTestDistribution, withDistribution } from './test-distribution.js'

handDownTestDistribution()

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

test("a distribution's modules are the packages it lists that export ./dashboard to a file inside them", async () => {
  const dir = await tempDir('openagent-modules-')
  const elsewhere = await tempDir('openagent-modules-linked-')
  try {
    const nodeModules = join(dir, 'node_modules')
    await pkg(join(nodeModules, '@acme/logs'), { name: '@acme/logs', version: '1.2.3', exports: { '.': './index.js', './dashboard': './dist/dashboard.js' }, bin: { logs: 'bin/logs' } }, { 'dist/dashboard.js': 'export default {}' })
    // No module: a package without the export, one whose export leaves the package, one whose file is absent.
    await pkg(join(nodeModules, 'plain'), { name: 'plain', exports: { '.': './index.js' } })
    await pkg(join(nodeModules, 'escapes'), { name: 'escapes', exports: { './dashboard': '../plain/package.json' } })
    await pkg(join(nodeModules, 'no-file'), { name: 'no-file', exports: { './dashboard': './dist/dashboard.js' } })
    // A workspace link reads like an install; a conditional export is read through its browser/import/default target.
    await pkg(elsewhere, { name: 'linked', bin: './cli.js', exports: { './dashboard': './w/index.js' } }, { 'w/index.js': 'export default {}' })
    await symlink(elsewhere, join(nodeModules, 'linked'))
    await pkg(join(nodeModules, 'conditional'), { name: 'conditional', exports: { './dashboard': { types: './d.ts', import: './esm/w.js' } } }, { 'esm/w.js': 'export default {}' })

    await withDistribution(dir, ['@acme/logs', 'plain', 'escapes', 'no-file', 'linked', 'conditional'], async () => {
      const modules = await readProjectModules(join(dir, 'a-project'))
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
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(elsewhere, { recursive: true, force: true })
  }
})

test("a module may bring a server part; every project has the distribution's modules, and one of their names among its own dependencies is not read", async () => {
  const root = await tempDir('openagent-modules-server-')
  try {
    await pkg(root, { dependencies: { '@openagt/ui-pane-files': '1' } })
    await pkg(join(root, 'node_modules', '@openagt/ui-pane-files'), { name: '@openagt/ui-pane-files', version: '9.9.9', exports: { './dashboard': './d.js' } }, { 'd.js': 'export default {}' })
    const files = (await readProjectModules(root)).filter(module => module.package === '@openagt/ui-pane-files')
    assert.equal(files.length, 1)
    assert.notEqual(files[0]!.version, '9.9.9', 'the distribution’s copy, not the one the project lists')
    assert.ok(files[0]!.server, 'with its server part, which the project’s copy has none of')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a module serves only the files inside its module\'s own directory', async () => {
  const root = await tempDir('openagent-module-files-')
  try {
    const dir = join(root, 'node_modules', 'w')
    await pkg(dir, { name: 'w', exports: { './dashboard': './dist/dashboard.js' } }, { 'dist/dashboard.js': 'x', 'dist/dashboard.css': 'y', 'dist/chunks/a.js': 'z', 'secret.txt': 's' })
    await symlink(join(dir, 'secret.txt'), join(dir, 'dist', 'sneaky.txt'))
    await withDistribution(root, ['w'], async () => {
      const module = (await findProjectModule(root, 'w'))!
      assert.equal(await moduleFile(module, 'dashboard.css'), join(dir, 'dist', 'dashboard.css'))
      assert.equal(await moduleFile(module, 'chunks/a.js'), join(dir, 'dist', 'chunks', 'a.js'))
      for (const outside of ['../secret.txt', '../package.json', '../../../package.json', 'sneaky.txt', 'chunks', '', 'nope.js'])
        assert.equal(await moduleFile(module, outside), undefined, `${JSON.stringify(outside)} is not served`)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a module runs its own package\'s command in the project and gets its JSON, or the reason it has none', async () => {
  const root = await tempDir('openagent-module-command-')
  try {
    const script = (body: string) => `#!/usr/bin/env node\n${body}\n`
    await pkg(join(root, 'node_modules', 'one'), { name: 'one', bin: { one: 'bin/one' }, exports: { './dashboard': './w.js' } }, {
      'w.js': 'export default {}',
      'bin/one': script(`
const args = process.argv.slice(2)
if (args[0] === 'fail') { console.error('first line'); console.error('refused: no such run'); process.exit(1) }
if (args[0] === 'words') { console.log('not json'); process.exit(0) }
console.log(JSON.stringify({ args, cwd: process.cwd() }))`),
    })
    await pkg(join(root, 'node_modules', 'two'), { name: 'two', bin: { a: 'bin/a', b: 'bin/b' }, exports: { './dashboard': './w.js' } }, {
      'w.js': 'export default {}',
      'bin/a': script('console.log(JSON.stringify("a"))'),
      'bin/b': script('console.log(JSON.stringify("b"))'),
    })
    let one!: NonNullable<Awaited<ReturnType<typeof findProjectModule>>>
    let two!: typeof one
    await withDistribution(root, ['one', 'two'], async () => {
      one = (await findProjectModule(root, 'one'))!
      two = (await findProjectModule(root, 'two'))!
    })

    assert.deepEqual(await runModuleCommand(root, one, ['--limit', '5']), { ok: true, output: { args: ['--limit', '5'], cwd: root } })
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

test("the Queue's, Tickets', Automations' and Logs' packages read through their server parts", async () => {
  for (const name of ['@openagt/queue', '@openagt/tickets', '@openagt/scheduled-agents', '@openagt/logs']) assert.match((await findBroughtModule(name))?.server ?? '', /server\.js$/, name)
  // The distribution's own copy is only of the packages a project can have.
  assert.equal(await findBroughtModule('@openagt/agent-driver'), undefined)
  assert.equal(await findBroughtModule('left-pad'), undefined)
})
