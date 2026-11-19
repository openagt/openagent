import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DISTRIBUTION_ENV } from '@openagt/hooks'
import { computerPackages, distributionBinDirs, distributionPackages, lookupProvided, packagesOf, providedCommand, runCleanups, type DashboardPackage } from './distribution-packages.js'
import { readComputerModules, readProjectModules, readProjectPages } from './project-modules.js'
import { providedGitHost } from './store/git-host.js'
import TEST_DISTRIBUTION, { handDownTestDistribution } from './test-distribution.js'

handDownTestDistribution()

/** The packages the tests' distribution lists, by name, in its order. */
const LISTED = TEST_DISTRIBUTION.flatMap(item => ('package' in item ? [item.package] : []))

/** A throwaway folder, its path with symlinks resolved. */
const scratch = async (name: string): Promise<string> => realpath(await mkdtemp(join(tmpdir(), `openagent-${name}-`)))

/**
 * A distribution of packages of this test's own, in a folder of its own: each package under its
 * `node_modules`, with a command (`bin/<name>`) running `script` and the package.json `fields`.
 * Handed down for the time of `run`.
 */
async function withPackages(packages: { entry: DashboardPackage; fields?: Record<string, unknown>; script?: string; skill?: string }[], run: () => Promise<void>): Promise<void> {
  const dir = await scratch('distribution')
  const before = process.env[DISTRIBUTION_ENV]
  try {
    for (const { entry, fields = {}, script = '', skill } of packages) {
      const pkg = join(dir, 'node_modules', entry.package)
      await mkdir(join(pkg, 'bin'), { recursive: true })
      await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: entry.package, version: '1.0.0', bin: { [entry.package]: `bin/${entry.package}` }, ...fields }))
      await writeFile(join(pkg, 'bin', entry.package), script)
      if (skill !== undefined) await writeFile(join(pkg, 'SKILL.md'), `---\nname: ${skill}\n---\nThe ${skill} skill.\n`)
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

/** A skill's text in a project, as init writes it: the folder named after the skill, with its `SKILL.md`. */
async function skillText(root: string, dir: string, name: string): Promise<void> {
  await mkdir(join(root, dir, name), { recursive: true })
  await writeFile(join(root, dir, name, 'SKILL.md'), `---\nname: ${name}\n---\nThe ${name} skill.\n`)
}

test("every package the distribution lists is read from its install, in its order, and their commands have a directory each", async () => {
  assert.deepEqual((await distributionPackages()).map(pkg => pkg.name), LISTED)
  const dirs = await distributionBinDirs()
  assert.ok(dirs.length > 0 && dirs.every(dir => basename(dir) === 'bin'), JSON.stringify(dirs))
  assert.deepEqual(await distributionPackages({}), [], 'no distribution handed down: no package')
})

test("a project with nothing installed gets its runs, its branches and a repository to create from the distribution's packages, and nothing it has no package for", async () => {
  const root = await scratch('packages')
  try {
    assert.equal((await providedCommand(root, 'runs'))?.package, '@openagt/skill-logs')
    assert.equal((await providedCommand(root, 'branches'))?.package, '@openagt/skill-branches')
    assert.deepEqual(await lookupProvided(root, 'tickets'), {})
    assert.equal((await providedCommand(root, 'repository'))?.package, '@openagt/skill-github', 'the package that can create its repository')
    assert.deepEqual(
      (await packagesOf(root)).map(pkg => pkg.name),
      ['@openagt/store-filesystem', '@openagt/store-git-repository', '@openagt/skill-branches', '@openagt/skill-github', '@openagt/dashboard-changes', '@openagt/dashboard-files', '@openagt/skill-logs', '@openagt/skill-ask', '@openagt/agent-runner'],
      "every project's, and the picked skill every run gets; none of the other picks, none of the computer's",
    )
    assert.deepEqual((await readProjectModules(root)).map(module => module.package), ['@openagt/dashboard-changes', '@openagt/dashboard-files', '@openagt/skill-logs'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("every project keeps its runs' records through the logs package, and shows its Logs page only once it picked the logs skill", async () => {
  const root = await scratch('logs')
  const pages = async (): Promise<string[]> => (await readProjectPages(root)).map(module => module.package)
  try {
    assert.deepEqual(await pages(), ['@openagt/dashboard-changes', '@openagt/dashboard-files'])
    assert.ok((await readProjectModules(root)).some(module => module.package === '@openagt/skill-logs'), 'its commands still run there')
    await skillText(root, '.agents/skills', 'logs')
    assert.deepEqual(await pages(), ['@openagt/dashboard-changes', '@openagt/dashboard-files', '@openagt/skill-logs'])
    assert.equal((await providedCommand(root, 'runs'))?.package, '@openagt/skill-logs')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the person's profile, devices and account rotation are the computer's: their parts are there with no project, and no project has them", async () => {
  assert.deepEqual((await computerPackages()).map(pkg => pkg.name), ['@openagt/user-info', '@openagt/dashboard-devices', '@openagt/skill-account-rotation'])
  assert.deepEqual((await readComputerModules()).map(module => module.package), ['@openagt/dashboard-devices', '@openagt/skill-account-rotation', '@openagt/user-info'])
  assert.deepEqual((await readComputerModules()).map(module => Object.keys(module.bins)), [['devices'], ['account-rotation'], []])
})

test("a project has a skill's package, its data and its page once it holds the skill's text, in either folder, and no longer once the folder is deleted", async () => {
  const root = await scratch('text')
  const modules = async (): Promise<string[]> => (await readProjectModules(root)).map(module => module.package)
  try {
    assert.deepEqual(await lookupProvided(root, 'tickets'), {})
    await skillText(root, '.agents/skills', 'tickets')
    assert.equal((await providedCommand(root, 'tickets'))?.package, '@openagt/skill-tickets')
    assert.deepEqual(await lookupProvided(root, 'queue'), {}, 'a skill the project does not hold stays out')
    assert.deepEqual(await modules(), ['@openagt/dashboard-changes', '@openagt/dashboard-files', '@openagt/skill-logs', '@openagt/skill-tickets'])

    await skillText(root, '.claude/skills', 'queue')
    await skillText(root, '.claude/skills', 'scheduler')
    assert.equal((await providedCommand(root, 'queue'))?.package, '@openagt/skill-queue')
    assert.deepEqual(await modules(), ['@openagt/dashboard-changes', '@openagt/dashboard-files', '@openagt/skill-logs', '@openagt/skill-queue', '@openagt/skill-scheduler', '@openagt/skill-tickets'])

    // A folder with no text in it, and a text under another name, are no skill of ours.
    await rm(join(root, '.agents/skills/tickets/SKILL.md'))
    await skillText(root, '.claude/skills', 'my-tickets')
    assert.deepEqual(await lookupProvided(root, 'tickets'), {})
    await rm(join(root, '.claude/skills/queue'), { recursive: true })
    assert.deepEqual(await modules(), ['@openagt/dashboard-changes', '@openagt/dashboard-files', '@openagt/skill-logs', '@openagt/skill-scheduler'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a picked package whose skill every run gets is every project\'s, with no text in the project; a pick that is no such skill still needs its text', async () => {
  const root = await scratch('every-run')
  try {
    await withPackages(
      [
        { entry: { package: 'my-tickets', for: 'picked', skill: 'every run' }, fields: { openagent: { tickets: 'my-tickets' } }, skill: 'my-tickets' },
        { entry: { package: 'my-queue', for: 'picked' }, fields: { openagent: { queue: 'my-queue' } }, skill: 'my-queue' },
      ],
      async () => {
        assert.equal((await providedCommand(root, 'tickets'))?.package, 'my-tickets')
        assert.deepEqual(await lookupProvided(root, 'queue'), {})
        await skillText(root, '.claude/skills', 'my-queue')
        assert.equal((await providedCommand(root, 'queue'))?.package, 'my-queue')
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("the scheduler is a project's once it holds the scheduler's skill text, and not by a hook line that runs it", async () => {
  const root = await scratch('tool')
  const has = async (): Promise<boolean> => (await packagesOf(root)).some(pkg => pkg.name === '@openagt/skill-scheduler')
  try {
    await mkdir(join(root, '.openagent'))
    await writeFile(join(root, '.openagent', 'hooks.yml'), 'open:\n  - scheduler start\nclose:\n  - scheduler stop --unless-keep-alive\n')
    assert.equal(await has(), false, 'its lines alone')
    await skillText(root, '.agents/skills', 'scheduler')
    assert.equal(await has(), true)
    assert.ok((await readProjectModules(root)).some(module => module.package === '@openagt/skill-scheduler'), 'its page comes with it')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a project's own dependencies bring nothing: neither a copy of the distribution's package, nor a package of their own for a kind", async () => {
  const root = await scratch('own')
  try {
    const listed = join(root, 'node_modules', '@openagt', 'skill-tickets')
    await mkdir(join(listed, 'bin'), { recursive: true })
    await writeFile(join(listed, 'package.json'), JSON.stringify({ name: '@openagt/skill-tickets', version: '9.9.9', bin: { tickets: 'bin/tickets' }, openagent: { tickets: 'tickets' }, exports: { './dashboard': './d.js' } }))
    await writeFile(join(listed, 'bin', 'tickets'), '')
    await writeFile(join(listed, 'd.js'), 'export default {}')
    const own = join(root, 'node_modules', 'my-logs')
    await mkdir(join(own, 'bin'), { recursive: true })
    await writeFile(join(own, 'package.json'), JSON.stringify({ name: 'my-logs', bin: { mine: 'bin/mine' }, openagent: { runs: 'mine' }, exports: { './dashboard': './d.js' } }))
    await writeFile(join(own, 'bin', 'mine'), '')
    await writeFile(join(own, 'd.js'), 'export default {}')
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'my-logs': '1.0.0' }, devDependencies: { '@openagt/skill-tickets': '9.9.9' }, openagent: { runs: 'my-logs' } }))
    assert.deepEqual(await lookupProvided(root, 'tickets'), {}, 'listed and installed, with no text: not the project\'s')
    assert.equal((await providedCommand(root, 'runs'))?.package, '@openagt/skill-logs', 'nor what its package.json names')
    assert.ok(!(await readProjectModules(root)).some(module => module.package === 'my-logs' || module.package === '@openagt/skill-tickets'))

    await skillText(root, '.claude/skills', 'tickets')
    const command = await providedCommand(root, 'tickets')
    assert.equal(command?.package, '@openagt/skill-tickets')
    assert.ok(!command!.bin.startsWith(root), "the distribution's copy runs, not the one in the project")
    const module = (await readProjectModules(root)).find(module => module.package === '@openagt/skill-tickets')
    assert.ok(module && module.version !== '9.9.9' && !module.dir.startsWith(root), "its page is the distribution's copy too")
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
        { entry: { package: 'tidy', for: 'picked' }, fields: { openagent: { cleanup: 'tidy' } }, script: `require('node:fs').writeFileSync('asked.txt', process.argv.slice(2).join(' ')); console.log(JSON.stringify({ ok: true, removed: ['.tidy'], kept: [{ path: '.tidy-notes', reason: 'yours' }] }))` },
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
