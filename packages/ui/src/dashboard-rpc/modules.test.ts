import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId, sessionsHome } from '@openagt/agent-data'
import { SESSIONS_ID } from '../project-address.js'
import { addProject } from '../registry.js'
import { onModules, runComputerCommand, runModuleCommand } from './modules.js'
import { callModule } from './module-calls.js'

import { provideTestContext } from './test-context.js'
import { testPackagesBut, withDistribution } from '../test-distribution.js'
import { distributionHooks, projectRefAt } from '../distribution-hooks.js'

// The host's capabilities, wired as the daemon wires them (D3); a test that needs other ones wires its own.
provideTestContext()

/** Packages installed under `dir`'s `node_modules`, each `{ exports, bin }` plus files: what a test's distribution lists ({@link withDistribution}). */
async function install(dir: string, packages: Record<string, { manifest: Record<string, unknown>; files?: Record<string, string> }>): Promise<void> {
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

/** A project folder. */
async function project(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/** Switch the plugin `name` on in the project at `dir`, as Settings › Plugins does. */
async function switchOn(dir: string, name: string): Promise<void> {
  await (await distributionHooks()).setEnabled(name, true, await projectRefAt(projectId(dir), dir))
}

/** The computer's packages of the tests' distribution, as it lists them. */
const COMPUTER = testPackagesBut().filter(pkg => pkg.for === 'computer')

const module = (bin: string) => ({
  manifest: { exports: { './dashboard': './w.js' }, bin: { [bin]: `bin/${bin}` } },
  files: { 'w.js': 'export default {}', [`bin/${bin}`]: `console.log(JSON.stringify(${JSON.stringify(bin)}))` },
})

/** A module whose package is a plugin's, kept per project: a project has it once the plugin is on there. */
const plugin = (bin: string) => ({
  manifest: { exports: { './dashboard': './w.js', './module': './module.mjs' }, bin: { [bin]: `bin/${bin}` } },
  files: { ...module(bin).files, 'module.mjs': `export default { name: ${JSON.stringify(bin)}, plugin: { scope: 'project' }, hooks: {} }` },
})

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
    await install(dir, { logs: module('logs'), queue: plugin('queue'), plain: { manifest: { bin: { plain: 'bin/plain' } }, files: { 'bin/plain': 'console.log("1")' } } })
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    await project(a)
    await project(b)
    await addProject(a, '2026-09-19T00:00:00.000Z')
    await addProject(b, '2026-09-19T00:00:01.000Z')

    await withDistribution(dir, [...COMPUTER, '@openagt/store-filesystem', '@openagt/ui-pane-changes', '@openagt/ui-pane-files', 'logs', 'plain', 'queue'], async () => {
      await switchOn(b, 'queue')
      // The computer's modules (the notifications, the accounts, the Human Queue, how markdown looks, Profile) come first, and are no project's. Then the ones every project has, from the first, which the sessions with no project have too; then queue, which only the project it is on in has.
      assert.deepEqual(await listed(), [
        { package: '@openagt/agent-driver', url: '/_computer-modules/%40openagt%2Fagent-driver/dashboard.js', projects: [], computer: true },
        { package: '@openagt/notifications-browser', url: '/_computer-modules/%40openagt%2Fnotifications-browser/dashboard.js', projects: [], computer: true },
        { package: '@openagt/store-git-repository', url: '/_computer-modules/%40openagt%2Fstore-git-repository/dashboard.js', projects: [], computer: true },
        { package: '@openagt/ui-card-waiting', url: '/_computer-modules/%40openagt%2Fui-card-waiting/dashboard.js', projects: [], computer: true },
        { package: '@openagt/ui-renderer-markdown', url: '/_computer-modules/%40openagt%2Fui-renderer-markdown/dashboard.js', projects: [], computer: true },
        { package: '@openagt/user-info', url: '/_computer-modules/%40openagt%2Fuser-info/dashboard.js', projects: [], computer: true },
        { package: '@openagt/ui-pane-changes', url: `/_modules/${projectId(a)}/%40openagt%2Fui-pane-changes/dashboard.js`, projects: [projectId(a), projectId(b)], sessions: true },
        { package: '@openagt/ui-pane-files', url: `/_modules/${projectId(a)}/%40openagt%2Fui-pane-files/dashboard.js`, projects: [projectId(a), projectId(b)], sessions: true },
        { package: 'logs', url: `/_modules/${projectId(a)}/logs/w.js`, projects: [projectId(a), projectId(b)], sessions: true },
        { package: 'queue', url: `/_modules/${projectId(b)}/queue/w.js`, projects: [projectId(b)] },
      ])

      assert.deepEqual(await runModuleCommand(projectId(b), 'queue', []), { ok: true, output: 'queue' })
      // A package the project has but that brings no module, a module of another project, an unknown project: refused.
      assert.deepEqual(await runModuleCommand(projectId(a), 'plain', []), { ok: false, error: 'plain brings no module to this project' })
      assert.deepEqual(await runModuleCommand(projectId(a), 'queue', []), { ok: false, error: 'queue brings no module to this project' })
      assert.deepEqual(await runModuleCommand('nowhere-1', 'logs', []), { ok: false, error: 'unknown project' })
    })
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test("with no project added, the computer's modules are there and run their own commands, and the sessions with no project have theirs, OpenAgent's own copy; no other package runs so, and none of the computer's runs in a project", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-modules-rpc-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    await install(dir, { queue: module('queue') })
    await withDistribution(dir, [...COMPUTER, '@openagt/store-filesystem', '@openagt/ui-pane-files', 'queue'], async () => {
      assert.deepEqual(await listed(), [
        { package: '@openagt/agent-driver', url: '/_computer-modules/%40openagt%2Fagent-driver/dashboard.js', projects: [], computer: true },
        { package: '@openagt/notifications-browser', url: '/_computer-modules/%40openagt%2Fnotifications-browser/dashboard.js', projects: [], computer: true },
        { package: '@openagt/store-git-repository', url: '/_computer-modules/%40openagt%2Fstore-git-repository/dashboard.js', projects: [], computer: true },
        { package: '@openagt/ui-card-waiting', url: '/_computer-modules/%40openagt%2Fui-card-waiting/dashboard.js', projects: [], computer: true },
        { package: '@openagt/ui-renderer-markdown', url: '/_computer-modules/%40openagt%2Fui-renderer-markdown/dashboard.js', projects: [], computer: true },
        { package: '@openagt/user-info', url: '/_computer-modules/%40openagt%2Fuser-info/dashboard.js', projects: [], computer: true },
        { package: '@openagt/ui-pane-files', url: '/_brought-modules/%40openagt%2Fui-pane-files/dashboard.js', projects: [], sessions: true },
        { package: 'queue', url: '/_brought-modules/queue/w.js', projects: [], sessions: true },
      ])
      // agent-driver's own command, answering what it keeps for this computer: no sign-in under way,
      // and, on Linux with no display, no browser to sign in with.
      const where = process.platform === 'linux' && !process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY'] ? { noBrowser: true } : {}
      assert.deepEqual(await runComputerCommand('@openagt/agent-driver', ['adding'], 'account-rotation'), { ok: true, output: { claude: where, codex: where } })
      assert.deepEqual(await runComputerCommand('@openagt/agent-driver', ['adding'], 'servers'), { ok: false, error: '@openagt/agent-driver has no command servers' })
      // A command that reads standard input is handed it, and answers: here a code, with no sign-in waiting for one.
      assert.deepEqual(await runComputerCommand('@openagt/agent-driver', ['add-code', 'claude'], 'account-rotation', 'KQ7M-4XPD'), { ok: false, error: 'No login waits for a code: start it again.' })
      assert.deepEqual(await runComputerCommand('@openagt/ui-pane-files', []), { ok: false, error: "@openagt/ui-pane-files is not this computer's" })
      assert.deepEqual(await runComputerCommand('queue', []), { ok: false, error: "queue is not this computer's" })

      const a = join(dir, 'a')
      await project(a)
      await addProject(a, '2026-09-19T00:00:00.000Z')
      assert.deepEqual(await runComputerCommand('queue', []), { ok: false, error: "queue is not this computer's" })
      assert.deepEqual(await runModuleCommand(projectId(a), '@openagt/agent-driver', ['adding']), { ok: false, error: '@openagt/agent-driver brings no module to this project' })
    })
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test("a module calls its own server part's functions, in its own project, which the function is given, or in a session with no project, which gives none; nothing else is called", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'openagent-modules-read-')))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  try {
    await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true })
    await install(dir, {
      reader: {
        manifest: { exports: { './dashboard': './w.js', './server': './s.mjs' } },
        files: { 'w.js': 'export default {}', 's.mjs': `import { read } from ${JSON.stringify(import.meta.resolve('@openagt/hooks/rpc'))}\nexport const where = read(async (host, input) => ({ root: host.root, project: await host.project(), input }))\n` },
      },
      logs: module('logs'),
    })
    const a = join(dir, 'a')
    await project(a)
    await addProject(a, '2026-09-19T00:00:00.000Z')

    await withDistribution(dir, ['reader', 'logs', '@openagt/ui-pane-files'], async () => {
      assert.deepEqual(await callModule(projectId(a), 'reader', 'where', { path: 'x' }), { ok: true, output: { root: a, project: { id: projectId(a), name: 'a', dir: a }, input: { path: 'x' } } })
      assert.deepEqual(await callModule(SESSIONS_ID, 'reader', 'where', {}), { ok: true, output: { root: sessionsHome(), project: undefined, input: {} } })
      assert.deepEqual(await callModule(projectId(a), 'logs', 'where', {}), { ok: false, error: 'logs has no server part' })
      assert.deepEqual(await callModule(projectId(a), 'nothing', 'where', {}), { ok: false, error: 'nothing is no module of this project' })
      assert.deepEqual(await callModule('nowhere-1', 'reader', 'where', {}), { ok: false, error: 'unknown project' })
      // The Files module reads the project's own files: none that git sees, in a folder that is no repository.
      await writeFile(join(a, 'hello.txt'), 'hi')
      const files = await callModule(projectId(a), '@openagt/ui-pane-files', 'project', {})
      assert.equal(files.ok, true)
      assert.ok(files.ok && Array.isArray(files.output))
    })
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
