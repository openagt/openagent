import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId } from '@openagt/agent-data'
import { DISTRIBUTION_ENV } from '@openagt/hooks'
import { computerPackages, distributionPackages, lookupProvided, packagesOf, providedCommand, runCleanups, type DashboardPackage } from './distribution-packages.js'
import { distributionHooks, projectRefAt } from './distribution-hooks.js'
import { readComputerModules, readProjectModules } from './project-modules.js'
import { providedGitHost } from './store/git-host.js'
import TEST_DISTRIBUTION, { handDownTestDistribution } from './test-distribution.js'

handDownTestDistribution()

/** The packages the tests' distribution lists, by name, in its order. */
const LISTED = TEST_DISTRIBUTION.flatMap(item => ('module' in item ? [] : [item.package]))

/** A throwaway folder, its path with symlinks resolved. */
const scratch = async (name: string): Promise<string> => realpath(await mkdtemp(join(tmpdir(), `openagent-${name}-`)))

/**
 * A distribution of packages of this test's own, in a folder of its own: each package under its
 * `node_modules`, with a command (`bin/<name>`) running `script` and the package.json `fields`.
 * Handed down for the time of `run`.
 */
async function withPackages(packages: { entry: DashboardPackage; fields?: Record<string, unknown>; script?: string }[], run: () => Promise<void>): Promise<void> {
  const dir = await scratch('distribution')
  const before = process.env[DISTRIBUTION_ENV]
  try {
    for (const { entry, fields = {}, script = '' } of packages) {
      const pkg = join(dir, 'node_modules', entry.package)
      await mkdir(join(pkg, 'bin'), { recursive: true })
      await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: entry.package, version: '1.0.0', bin: { [entry.package]: `bin/${entry.package}` }, ...fields }))
      await writeFile(join(pkg, 'bin', entry.package), script)
    }
    const file = join(dir, 'distribution.mjs')
    await writeFile(file, `export default ${JSON.stringify(packages.map(({ entry }) => entry))}\n`)
    process.env[DISTRIBUTION_ENV] = file
    await run()
  } finally {
    if (before === undefined) delete process.env[DISTRIBUTION_ENV]
    else process.env[DISTRIBUTION_ENV] = before
    await rm(dir, { recursive: true, force: true })
  }
}

/** Switch the plugin `name` on in the project at `root`, or off, as Settings › Plugins does. */
async function switchPlugin(root: string, name: string, on = true): Promise<void> {
  await (await distributionHooks()).setEnabled(name, on, await projectRefAt(projectId(root), root))
}

test("every package the distribution lists is read from its install, in its order", async () => {
  assert.deepEqual((await distributionPackages()).map(pkg => pkg.name), LISTED)
  assert.deepEqual(await distributionPackages({}), [], 'no distribution handed down: no package')
})

test("a project with nothing installed gets its runs, its branches and a repository to create from the distribution's packages, and nothing of a plugin that is off", async () => {
  const root = await scratch('packages')
  try {
    assert.equal((await providedCommand(root, 'runs'))?.package, '@openagt/logs', "the runs' records, whatever logs says")
    assert.equal((await providedCommand(root, 'branches'))?.package, '@openagt/git-branches')
    assert.equal((await providedCommand(root, 'repository'))?.package, '@openagt/github', 'the package that can create its repository')
    assert.deepEqual(
      (await packagesOf(root)).map(pkg => pkg.name),
      ['@openagt/store-filesystem', '@openagt/store-git-branch', '@openagt/git-branches', '@openagt/github', '@openagt/skills', '@openagt/ui-pane-changes', '@openagt/ui-pane-files', '@openagt/saved-prompts', '@openagt/ask'],
      "every project's core packages, the plugin that starts on, and the git store, switched on its own entry; none of the others, none of the computer's",
    )
    assert.deepEqual((await readProjectModules(root)).map(module => module.package), ['@openagt/ask', '@openagt/saved-prompts', '@openagt/skills', '@openagt/store-git-branch', '@openagt/ui-pane-changes', '@openagt/ui-pane-files'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("every project keeps its runs' records through the logs package, and shows its Logs page once logs is on there", async () => {
  const root = await scratch('logs')
  const modules = async (): Promise<string[]> => (await readProjectModules(root)).map(module => module.package)
  try {
    assert.deepEqual(await modules(), ['@openagt/ask', '@openagt/saved-prompts', '@openagt/skills', '@openagt/store-git-branch', '@openagt/ui-pane-changes', '@openagt/ui-pane-files'])
    await switchPlugin(root, 'logs')
    assert.deepEqual(await modules(), ['@openagt/ask', '@openagt/logs', '@openagt/saved-prompts', '@openagt/skills', '@openagt/store-git-branch', '@openagt/ui-pane-changes', '@openagt/ui-pane-files'])
    assert.equal((await providedCommand(root, 'runs'))?.package, '@openagt/logs')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the person's own folder, the coding agents, how markdown looks, the Human Queue, the person's profile, the runs with their accounts and the notifications are the computer's: their parts are there with no project, and no project has them; the plugins' only while they are on", async () => {
  assert.deepEqual((await computerPackages()).map(pkg => pkg.name), ['@openagt/store-git-repository', '@openagt/agent-driver-claude-code', '@openagt/agent-driver-codex', '@openagt/ui-renderer-markdown', '@openagt/ui-card-waiting', '@openagt/user-info', '@openagt/notifications-browser', '@openagt/agent-driver'])
  assert.deepEqual((await readComputerModules()).map(module => module.package), ['@openagt/agent-driver', '@openagt/notifications-browser', '@openagt/store-git-repository', '@openagt/ui-card-waiting', '@openagt/ui-renderer-markdown', '@openagt/user-info'])
  assert.deepEqual((await readComputerModules()).map(module => Object.keys(module.bins)), [['agent-runner', 'account-rotation'], [], [], [], [], []])
  const hooks = await distributionHooks()
  await hooks.setEnabled('notifications-browser', false)
  await hooks.setEnabled('notifications-command', true)
  try {
    assert.deepEqual((await computerPackages()).map(pkg => pkg.name), ['@openagt/store-git-repository', '@openagt/agent-driver-claude-code', '@openagt/agent-driver-codex', '@openagt/ui-renderer-markdown', '@openagt/ui-card-waiting', '@openagt/user-info', '@openagt/notifications-command', '@openagt/agent-driver'])
    assert.deepEqual((await readComputerModules()).map(module => module.package), ['@openagt/agent-driver', '@openagt/notifications-command', '@openagt/store-git-repository', '@openagt/ui-card-waiting', '@openagt/ui-renderer-markdown', '@openagt/user-info'])
  } finally {
    await hooks.setEnabled('notifications-browser', true)
    await hooks.setEnabled('notifications-command', false)
  }
})

test("a plugin's package, its data and its page are a project's once the plugin is on there, in that project alone, and no longer once it is off", async () => {
  const root = await scratch('plugin')
  const other = await scratch('other')
  const modules = async (): Promise<string[]> => (await readProjectModules(root)).map(module => module.package)
  const has = async (at: string, name: string): Promise<boolean> => (await packagesOf(at)).some(pkg => pkg.name === name)
  try {
    assert.equal(await has(root, '@openagt/tickets'), false)
    await switchPlugin(root, 'tickets')
    assert.equal(await has(root, '@openagt/tickets'), true)
    assert.equal(await has(other, '@openagt/tickets'), false, "another project's row is its own")
    assert.equal(await has(root, '@openagt/queue'), false, 'a plugin that is off stays out')
    assert.deepEqual(await modules(), ['@openagt/ask', '@openagt/saved-prompts', '@openagt/skills', '@openagt/store-git-branch', '@openagt/tickets', '@openagt/ui-pane-changes', '@openagt/ui-pane-files'])

    await switchPlugin(root, 'queue')
    await switchPlugin(root, 'scheduled-agents')
    assert.equal(await has(root, '@openagt/queue'), true)
    assert.deepEqual(await modules(), ['@openagt/ask', '@openagt/queue', '@openagt/saved-prompts', '@openagt/scheduled-agents', '@openagt/skills', '@openagt/store-git-branch', '@openagt/tickets', '@openagt/ui-pane-changes', '@openagt/ui-pane-files'])

    await switchPlugin(root, 'tickets', false)
    await switchPlugin(root, 'queue', false)
    assert.equal(await has(root, '@openagt/tickets'), false)
    assert.deepEqual(await modules(), ['@openagt/ask', '@openagt/saved-prompts', '@openagt/scheduled-agents', '@openagt/skills', '@openagt/store-git-branch', '@openagt/ui-pane-changes', '@openagt/ui-pane-files'])
    await switchPlugin(root, 'ask', false)
    assert.ok(!(await packagesOf(root)).some(pkg => pkg.name === '@openagt/ask'), 'one that starts on goes off the same way')
    assert.deepEqual(await modules(), ['@openagt/saved-prompts', '@openagt/scheduled-agents', '@openagt/skills', '@openagt/store-git-branch', '@openagt/ui-pane-changes', '@openagt/ui-pane-files'])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  }
})

test("the scheduler is a project's once scheduled-agents is on there", async () => {
  const root = await scratch('tool')
  const has = async (): Promise<boolean> => (await packagesOf(root)).some(pkg => pkg.name === '@openagt/scheduled-agents')
  try {
    assert.equal(await has(), false, 'off until it is switched on')
    await switchPlugin(root, 'scheduled-agents')
    assert.equal(await has(), true)
    assert.ok((await readProjectModules(root)).some(module => module.package === '@openagt/scheduled-agents'), 'its page comes with it')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a project's own dependencies bring nothing: neither a copy of the distribution's package, nor a package of their own for a kind", async () => {
  const root = await scratch('own')
  try {
    const listed = join(root, 'node_modules', '@openagt', 'tickets')
    await mkdir(listed, { recursive: true })
    await writeFile(join(listed, 'package.json'), JSON.stringify({ name: '@openagt/tickets', version: '9.9.9', exports: { './dashboard': './d.js' } }))
    await writeFile(join(listed, 'd.js'), 'export default {}')
    const own = join(root, 'node_modules', 'my-logs')
    await mkdir(join(own, 'bin'), { recursive: true })
    await writeFile(join(own, 'package.json'), JSON.stringify({ name: 'my-logs', bin: { mine: 'bin/mine' }, openagent: { runs: 'mine' }, exports: { './dashboard': './d.js' } }))
    await writeFile(join(own, 'bin', 'mine'), '')
    await writeFile(join(own, 'd.js'), 'export default {}')
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'my-logs': '1.0.0' }, devDependencies: { '@openagt/tickets': '9.9.9' }, openagent: { runs: 'my-logs' } }))
    assert.equal((await providedCommand(root, 'runs'))?.package, '@openagt/logs', 'not what its package.json names')
    assert.ok(!(await readProjectModules(root)).some(module => module.package === 'my-logs' || module.package === '@openagt/tickets'), "listed and installed, with its plugin off: not the project's")

    await switchPlugin(root, 'tickets')
    const module = (await readProjectModules(root)).find(module => module.package === '@openagt/tickets')
    assert.ok(module && module.version !== '9.9.9' && !module.dir.startsWith(root), "its page is the distribution's copy, not the one in the project")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the git host is a project's only when the project's remote is on that host", async () => {
  const root = await scratch('host')
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    assert.equal(await providedGitHost()(root), undefined, 'no remote: no git host')
    execFileSync('git', ['remote', 'add', 'origin', 'git@gitlab.com:o/r.git'], { cwd: root })
    assert.equal(await providedGitHost()(root), undefined, 'a remote on another host: not its git host')
    execFileSync('git', ['remote', 'set-url', 'origin', 'git@github.com:o/r.git'], { cwd: root })
    const gitHost = await providedGitHost()(root)
    assert.deepEqual(await gitHost?.home(), { url: 'https://github.com/o/r', name: 'GitHub' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('two packages of the distribution that provide one kind provide it neither, and say why', async () => {
  const root = await scratch('two')
  try {
    await withPackages(
      [
        { entry: { package: 'one-host' }, fields: { openagent: { 'git-host': 'one-host' } } },
        { entry: { package: 'other-host' }, fields: { openagent: { 'git-host': 'other-host' } } },
      ],
      async () => assert.deepEqual(await lookupProvided(root, 'git-host'), { problem: '2 packages of the distribution provide git-host: one-host, other-host' }),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("every package of the distribution that declares a clean-up is asked, one the project does not have too; a refusal, a failure and an answer that is not one are each a line, and the rest still run", async () => {
  const root = await scratch('cleanup')
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    await withPackages(
      [
        { entry: { package: 'tidy' }, fields: { openagent: { cleanup: 'tidy' } }, script: `require('node:fs').writeFileSync('asked.txt', process.argv.slice(2).join(' ')); console.log(JSON.stringify({ ok: true, removed: ['.tidy'], kept: [{ path: '.tidy-notes', reason: 'yours' }] }))` },
        { entry: { package: 'busy' }, fields: { openagent: { cleanup: 'busy' } }, script: `console.log(JSON.stringify({ ok: false, reason: 'running' })); console.error('a run is still working here'); process.exit(1)` },
        { entry: { package: 'odd', for: 'computer' }, fields: { openagent: { cleanup: 'odd' } }, script: `console.log(JSON.stringify({ ok: true, removed: 'everything' }))` },
      ],
      async () => {
        assert.deepEqual(await runCleanups(root), {
          removed: ['.tidy'],
          kept: [{ path: '.tidy-notes', reason: 'yours' }],
          failed: ['busy: a run is still working here', 'odd: its clean-up answered something else than what it removed and kept'],
        })
        assert.equal(execFileSync('cat', ['asked.txt'], { cwd: root, encoding: 'utf8' }), 'cleanup', 'run in the project, with the one word')
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
