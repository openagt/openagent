import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addProject, projectId } from '../registry.js'
import { projectQueue } from '../store/queue.js'
import { onModules, readModule, runComputerCommand, runModuleCommand } from './modules.js'
import { asCaller } from '../dashboard/person.js'
import { setDashboardContext } from './context.js'
import { NO_ELSEWHERE, testDashboardContext } from './test-context.js'

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

/** The modules listed, each URL without its file's version, once every one is seen to carry one. */
async function listed(): Promise<Awaited<ReturnType<typeof onModules>>> {
  const modules = await onModules()
  for (const module of modules) assert.match(module.url, /\.js\?v=[0-9a-z]+-[0-9a-z]+$/, `${module.package} is listed with its file's version, so a browser keeps it`)
  return modules.map(module => ({ ...module, url: module.url.replace(/\?v=.*$/, '') }))
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

    // The computer's module (the Devices and Machines sections) comes first, and is no project's. Then the built-in modules (Changes, Files, the logs package's), which are every project's, from the first; then the projects' own.
    assert.deepEqual(await listed(), [
      { package: '@openagt/devices', url: '/_computer-modules/%40openagt%2Fdevices/dashboard.js', projects: [], computer: true },
      { package: '@openagt/changes', url: `/_modules/${projectId(a)}/%40openagt%2Fchanges/dashboard.js`, projects: [projectId(a), projectId(b)] },
      { package: '@openagt/files', url: `/_modules/${projectId(a)}/%40openagt%2Ffiles/dashboard.js`, projects: [projectId(a), projectId(b)] },
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

test('with no project added, the computer\'s modules are there and run their own commands; no other package runs so, and none of them runs in a project', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-modules-rpc-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  // A run of these tests on a server: the commands answer as on a person's own computer.
  const onServer = process.env.OPENAGENT_SERVER
  delete process.env.OPENAGENT_SERVER
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    assert.deepEqual(await listed(), [
      { package: '@openagt/devices', url: '/_computer-modules/%40openagt%2Fdevices/dashboard.js', projects: [], computer: true },
    ])
    // The door's own command, answering what it keeps for this computer: nobody is in, and it is shut.
    assert.deepEqual(await runComputerCommand('@openagt/devices', ['status']), { ok: true, output: { on: false, listening: false, devices: [], lines: [], persons: [] } })
    assert.deepEqual(await runComputerCommand('@openagt/devices', ['server', 'status']), { ok: true, output: { servers: [] } })
    assert.deepEqual(await runComputerCommand('@openagt/devices', ['status'], 'servers'), { ok: false, error: '@openagt/devices has no command servers' })
    // A command is told when a person the owner invited asks, and decides what such a person may do: no computer of theirs is let in here.
    assert.deepEqual(await runComputerCommand('@openagt/devices', ['allow', 'a1b2c3d4e5f6']), { ok: false, error: 'That computer is no longer asking.' })
    assert.deepEqual(await asCaller(encodeURIComponent('Rom Ö'), () => runComputerCommand('@openagt/devices', ['allow', 'a1b2c3d4e5f6'])), { ok: false, error: "Only this computer's owner lets a computer in." })
    // What a command reads on standard input is handed over as it is.
    assert.deepEqual(await runComputerCommand('@openagt/devices', ['ask-cancel', 'http://127.0.0.1:9', '-'], null, ''), { ok: false, error: 'no secret on standard input' })
    assert.deepEqual(await runComputerCommand('@openagt/files', []), { ok: false, error: "@openagt/files is not this computer's" })
    assert.deepEqual(await runComputerCommand('queue', []), { ok: false, error: "queue is not this computer's" })

    const a = join(dir, 'a')
    await project(a, { queue: module('queue') })
    await addProject(a, '2026-09-19T00:00:00.000Z')
    assert.deepEqual(await runComputerCommand('queue', []), { ok: false, error: "queue is not this computer's" })
    assert.deepEqual(await runModuleCommand(projectId(a), '@openagt/devices', ['status']), { ok: false, error: '@openagt/devices brings no module to this project' })
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    if (onServer !== undefined) process.env.OPENAGENT_SERVER = onServer
    await rm(dir, { recursive: true, force: true })
  }
})

test('a module\'s action may write what OpenAgent reads through a provider: the next read sees it, not a cached copy (#1774); a read forgets nothing', async () => {
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
    assert.deepEqual(await runModuleCommand(projectId(a), 'queue', ['add', 'ship it'], undefined, true), { ok: true, output: { ok: true } })
    assert.deepEqual(await queue.list(), ['ship it'], 'the module wrote through its action, and OpenAgent forgot its read')
    // Another writer adds an entry; the page then reads the queue through the package's command.
    await writeFile(join(a, 'node_modules', 'queue', 'queue.json'), JSON.stringify(['ship it', 'and this']))
    assert.deepEqual(await runModuleCommand(projectId(a), 'queue', ['--local']), { ok: true, output: ['ship it', 'and this'] })
    assert.deepEqual(await queue.list(), ['ship it'], 'a read wrote nothing: what OpenAgent read stays, until its window ends')
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
    // The built-in Files module reads the project's own files: none that git sees, in a folder that is no repository.
    await writeFile(join(a, 'hello.txt'), 'hi')
    const files = await readModule(projectId(a), '@openagt/files', 'project', {})
    assert.equal(files.ok, true)
    assert.ok(files.ok && Array.isArray(files.output))
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test("another computer's project has the pages its computer said, from a copy here: a project's of this computer's, else OpenAgent's own; one with no copy here has none", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-modules-elsewhere-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    const a = join(dir, 'a')
    await project(a, { logs: module('logs') })
    await addProject(a, '2026-09-19T00:00:00.000Z')
    const theirs = { id: 'shop-1~abc', path: '/Users/ada/shop', name: 'shop', activated: true, gitHost: true, machine: 'http://127.0.0.1:4210', modules: ['logs', '@openagt/skill-queue', '@openagt/devices', 'left-pad'] }
    setDashboardContext(testDashboardContext({ remote: { ...testDashboardContext().remote, ...NO_ELSEWHERE, elsewhere: async () => [theirs] } }))
    const modules = await listed()
    // A package a project here has: its page is that one, for theirs too.
    assert.deepEqual(modules.find(m => m.package === 'logs')?.projects, [projectId(a), 'shop-1~abc'])
    // One no project here has, that OpenAgent brings: from OpenAgent's own copy.
    assert.deepEqual(modules.find(m => m.package === '@openagt/skill-queue'), { package: '@openagt/skill-queue', url: '/_brought-modules/%40openagt%2Fskill-queue/dashboard.js', projects: ['shop-1~abc'] })
    // The computer's own modules are no project's, and a package with no copy here brings nothing.
    assert.deepEqual(modules.find(m => m.package === '@openagt/devices')?.projects, [])
    assert.equal(modules.find(m => m.package === 'left-pad'), undefined)
  } finally {
    setDashboardContext(testDashboardContext())
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
