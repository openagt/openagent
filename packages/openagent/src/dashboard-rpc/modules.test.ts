import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addProject, projectId } from '../registry.js'
import { projectQueue } from '../store/queue.js'
import { onModules, readModule, runModuleCommand } from './modules.js'

/** A project with a package.json and installed packages, each `{ exports, bin }` plus files. */
async function project(dir: string, packages: Record<string, { manifest: Record<string, unknown>; files?: Record<string, string> }>): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(Object.keys(packages).map(name => [name, '1'])) }))
  for (const [name, { manifest, files = {} }] of Object.entries(packages)) {
    const pkgDir = join(dir, 'node_modules', name)
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name, ...manifest }))
    for (const [rel, body] of Object.entries(files)) {
      await mkdir(join(pkgDir, rel, '..'), { recursive: true })
      await writeFile(join(pkgDir, rel), body)
    }
  }
}

const module = (bin: string) => ({
  manifest: { exports: { './dashboard': './w.js' }, bin: { [bin]: `bin/${bin}` } },
  files: { 'w.js': 'export default {}', [`bin/${bin}`]: `console.log(JSON.stringify(${JSON.stringify(bin)}))` },
})

/** A queue provider that is also a module: `--local` prints its file; `add` appends to it. */
const queueModule = {
  manifest: { exports: { './dashboard': './w.js' }, bin: { queue: 'bin/queue' }, openagent: { queue: 'queue' } },
  files: {
    'w.js': 'export default {}',
    'bin/queue': `
const fs = require('node:fs'); const path = require('node:path'); const file = path.join(__dirname, '..', 'queue.json')
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'))
if (process.argv[2] === 'add') { fs.writeFileSync(file, JSON.stringify([...read(), process.argv[3]])); console.log('{"ok":true}') }
else console.log(JSON.stringify(read()))`,
    'queue.json': '[]',
  },
}

test('the dashboard\'s modules are every registered project\'s, one per package, and a module runs only its own package\'s commands', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-modules-rpc-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await project(a, { logs: module('logs'), plain: { manifest: { bin: { plain: 'bin/plain' } }, files: { 'bin/plain': 'console.log("1")' } } })
    await project(b, { logs: module('logs'), queue: module('queue') })
    await addProject(a, '2026-09-19T00:00:00.000Z')
    await addProject(b, '2026-09-19T00:00:01.000Z')

    // The built-in modules (Files, the Devices section, the logs package's) are every project's, from the first; then the projects' own.
    assert.deepEqual(await onModules(), [
      { package: '@openagt/files', url: `/_modules/${projectId(a)}/%40openagt%2Ffiles/dashboard.js`, projects: [projectId(a), projectId(b)] },
      { package: '@openagt/remote-access', url: `/_modules/${projectId(a)}/%40openagt%2Fremote-access/dashboard.js`, projects: [projectId(a), projectId(b)] },
      { package: '@openagt/skill-logs', url: `/_modules/${projectId(a)}/%40openagt%2Fskill-logs/dashboard.js`, projects: [projectId(a), projectId(b)] },
      { package: 'logs', url: `/_modules/${projectId(a)}/logs/w.js`, projects: [projectId(a), projectId(b)] },
      { package: 'queue', url: `/_modules/${projectId(b)}/queue/w.js`, projects: [projectId(b)] },
    ])

    assert.deepEqual(await runModuleCommand(projectId(b), 'queue', []), { ok: true, output: 'queue' })
    // A package the project has but that brings no module, a module of another project, an unknown project: refused.
    assert.deepEqual(await runModuleCommand(projectId(a), 'plain', []), { ok: false, error: 'plain brings no module to this project' })
    assert.deepEqual(await runModuleCommand(projectId(a), 'queue', []), { ok: false, error: 'queue brings no module to this project' })
    assert.deepEqual(await runModuleCommand('nowhere-1', 'logs', []), { ok: false, error: 'unknown project' })
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('a module\'s command may write what OpenAgent reads through a provider: the next read sees it, not a cached copy (#1774)', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-modules-rpc-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    const a = join(dir, 'a')
    await project(a, { queue: queueModule })
    await addProject(a, '2026-09-19T00:00:00.000Z')
    const queue = (await projectQueue(a))!
    assert.deepEqual(await queue.list(), [], 'read once: cached for the window')
    assert.deepEqual(await runModuleCommand(projectId(a), 'queue', ['add', 'ship it']), { ok: true, output: { ok: true } })
    assert.deepEqual(await queue.list(), ['ship it'], 'the module wrote through its command, and OpenAgent forgot its read')
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('a module reads through its own server part, in its own project; nothing else is read', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-modules-read-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    const a = join(dir, 'a')
    await project(a, {
      reader: {
        manifest: { exports: { './dashboard': './w.js', './server': './s.mjs' } },
        files: { 'w.js': 'export default {}', 's.mjs': 'export default { reads: { where: async (host, input) => ({ root: host.root, input }) } }' },
      },
      logs: module('logs'),
    })
    await addProject(a, '2026-09-19T00:00:00.000Z')

    assert.deepEqual(await readModule(projectId(a), 'reader', 'where', { path: 'x' }), { ok: true, output: { root: a, input: { path: 'x' } } })
    assert.deepEqual(await readModule(projectId(a), 'logs', 'where', {}), { ok: false, error: 'logs has no server part' })
    assert.deepEqual(await readModule(projectId(a), 'nothing', 'where', {}), { ok: false, error: 'nothing is no module of this project' })
    assert.deepEqual(await readModule('nowhere-1', 'reader', 'where', {}), { ok: false, error: 'unknown project' })
    // The built-in Files module reads the project's own files.
    await writeFile(join(a, 'hello.txt'), 'hi')
    const files = await readModule(projectId(a), '@openagt/files', 'project', {})
    assert.equal(files.ok, true)
    assert.ok(files.ok && (files.output as { files: string[] }).files !== undefined)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
