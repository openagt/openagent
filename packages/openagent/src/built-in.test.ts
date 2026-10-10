import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { BUILT_IN_PACKAGES, OWN_PACKAGE_NAMES, PICKED_PACKAGES, builtInBinDirs, builtInPackages, builtInPackagesOf, lookupProvided, providedCommand, runCleanups } from './built-in.js'
import { readProjectModules } from './project-modules.js'
import { providedGitHost } from './store/git-host.js'

test('every package OpenAgent brings is installed with it, and their commands have a directory each', async () => {
  assert.deepEqual((await builtInPackages()).map(pkg => pkg.name), [...OWN_PACKAGE_NAMES])
  assert.deepEqual([...OWN_PACKAGE_NAMES], [...BUILT_IN_PACKAGES, ...PICKED_PACKAGES])
  const dirs = await builtInBinDirs()
  assert.ok(dirs.length > 0 && dirs.every(dir => basename(dir) === 'bin'), JSON.stringify(dirs))
})

test('a project with nothing installed gets its runs, its branches and a repository to create from the built-in packages, and nothing it has no package for', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-built-in-')))
  try {
    assert.equal((await providedCommand(root, 'runs'))?.package, '@openagt/skill-logs')
    assert.equal((await providedCommand(root, 'branches'))?.package, '@openagt/skill-branches')
    assert.deepEqual(await lookupProvided(root, 'tickets'), {})
    assert.equal((await providedCommand(root, 'repository'))?.package, '@openagt/skill-github', 'the built-in package that can create its repository')
    assert.deepEqual((await builtInPackagesOf(root)).map(pkg => pkg.name), [...BUILT_IN_PACKAGES], 'none of the packages a project picks')
    assert.deepEqual((await readProjectModules(root)).map(module => module.package), ['@openagt/files', '@openagt/remote-access', '@openagt/skill-logs'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/** A skill's text in a project, as init writes it: the folder named after the skill, with its `SKILL.md`. */
async function skillText(root: string, dir: string, name: string): Promise<void> {
  await mkdir(join(root, dir, name), { recursive: true })
  await writeFile(join(root, dir, name, 'SKILL.md'), `---\nname: ${name}\n---\nThe ${name} skill.\n`)
}

test('a project has a skill\'s package, its data and its page once it holds the skill\'s text, in either folder, and no longer once the folder is deleted', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-built-in-text-')))
  const modules = async (): Promise<string[]> => (await readProjectModules(root)).map(module => module.package)
  try {
    assert.deepEqual(await lookupProvided(root, 'tickets'), {})
    await skillText(root, '.agents/skills', 'tickets')
    assert.equal((await providedCommand(root, 'tickets'))?.package, '@openagt/skill-tickets')
    assert.deepEqual(await lookupProvided(root, 'queue'), {}, 'a skill the project does not hold stays out')
    assert.deepEqual(await modules(), ['@openagt/files', '@openagt/remote-access', '@openagt/skill-logs', '@openagt/skill-tickets'])

    await skillText(root, '.claude/skills', 'queue')
    await skillText(root, '.claude/skills', 'orchestration')
    assert.equal((await providedCommand(root, 'queue'))?.package, '@openagt/skill-queue')
    assert.deepEqual(await modules(), ['@openagt/files', '@openagt/remote-access', '@openagt/skill-logs', '@openagt/skill-orchestration', '@openagt/skill-queue', '@openagt/skill-tickets'])

    // A folder with no text in it, and a text under another name, are no skill of ours.
    await rm(join(root, '.agents/skills/tickets/SKILL.md'))
    await skillText(root, '.claude/skills', 'my-tickets')
    assert.deepEqual(await lookupProvided(root, 'tickets'), {})
    await rm(join(root, '.claude/skills/queue'), { recursive: true })
    assert.deepEqual(await modules(), ['@openagt/files', '@openagt/remote-access', '@openagt/skill-logs', '@openagt/skill-orchestration'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the scheduler is a project\'s once one of the project\'s hook lines runs it, by its command or by its package\'s full name', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-built-in-tool-')))
  const has = async (): Promise<boolean> => (await builtInPackagesOf(root)).some(pkg => pkg.name === '@openagt/agent-scheduler')
  const hooks = async (text: string): Promise<void> => writeFile(join(root, '.openagent', 'hooks.yml'), text)
  try {
    await mkdir(join(root, '.openagent'))
    assert.equal(await has(), false, 'no hooks file')
    await hooks('start: npx agent-runner run --detach "$PROMPT"\n')
    assert.equal(await has(), false, 'no line runs it')
    await hooks('open:\n  - npx my-agent-scheduler-wrapper start\n  - echo agent-scheduler-is-not-here\n')
    assert.equal(await has(), false, 'its name inside another word is not it')
    await hooks('open:\n  - npx agent-scheduler start\nclose:\n  - npx agent-scheduler stop --unless-keep-alive\n')
    assert.equal(await has(), true)
    assert.ok((await readProjectModules(root)).some(module => module.package === '@openagt/agent-scheduler'), 'its page comes with it')
    await hooks('open:\n  - npx @openagt/agent-scheduler@0.1 start\n')
    assert.equal(await has(), true, 'the full name with a range')
    await hooks('open:\n  - agent-scheduler start\nclose:\n  - agent-scheduler stop --unless-keep-alive\n')
    assert.equal(await has(), true, 'the bare lines its own init writes')
    await hooks('open:\n  - FOO=1 ./node_modules/.bin/agent-scheduler start\n')
    assert.equal(await has(), true, 'by a path')
    await hooks('open: [')
    assert.equal(await has(), false, 'a hooks file that cannot be read runs nothing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('one of OpenAgent\'s own names among a project\'s dependencies is not read: only the skill\'s text gives the project the package, and OpenAgent\'s copy', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-built-in-reserved-')))
  try {
    const listed = join(root, 'node_modules', '@openagt', 'skill-tickets')
    await mkdir(join(listed, 'bin'), { recursive: true })
    await writeFile(join(listed, 'package.json'), JSON.stringify({ name: '@openagt/skill-tickets', version: '9.9.9', bin: { tickets: 'bin/tickets' }, openagent: { tickets: 'tickets' }, exports: { './dashboard': './d.js' } }))
    await writeFile(join(listed, 'bin', 'tickets'), '')
    await writeFile(join(listed, 'd.js'), 'export default {}')
    await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@openagt/skill-tickets': '9.9.9' } }))
    assert.deepEqual(await lookupProvided(root, 'tickets'), {}, 'listed and installed, with no text: not the project\'s')
    assert.ok(!(await readProjectModules(root)).some(module => module.package === '@openagt/skill-tickets'))

    await skillText(root, '.claude/skills', 'tickets')
    const command = await providedCommand(root, 'tickets')
    assert.equal(command?.package, '@openagt/skill-tickets')
    assert.ok(!command!.bin.startsWith(root), 'OpenAgent\'s copy runs, not the one in the project')
    const module = (await readProjectModules(root)).find(module => module.package === '@openagt/skill-tickets')
    assert.ok(module && module.version !== '9.9.9' && !module.dir.startsWith(root), 'its page is OpenAgent\'s copy too')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a project\'s own package for a kind wins over the built-in one', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-built-in-own-')))
  try {
    const own = join(root, 'node_modules', 'my-logs')
    await mkdir(join(own, 'bin'), { recursive: true })
    await writeFile(join(own, 'package.json'), JSON.stringify({ name: 'my-logs', bin: { mine: 'bin/mine' }, openagent: { runs: 'mine' } }))
    await writeFile(join(own, 'bin', 'mine'), '')
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'my-logs': '1.0.0' } }))
    assert.equal((await providedCommand(root, 'runs'))?.package, 'my-logs')
    assert.equal((await providedCommand(root, 'branches'))?.package, '@openagt/skill-branches', 'a kind the project has no package for still comes built in')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a built-in git host is a project\'s only when the project\'s remote is on that host', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-built-in-host-')))
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

test('every package that declares a clean-up is asked, the project\'s own first; a refusal, a failure and an answer that is not one are each a line, and the rest still run', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-built-in-cleanup-')))
  try {
    execFileSync('git', ['init', '-q'], { cwd: root })
    const tool = async (name: string, script: string): Promise<void> => {
      const dir = join(root, 'node_modules', name)
      await mkdir(join(dir, 'bin'), { recursive: true })
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name, bin: { [name]: `bin/${name}` }, openagent: { cleanup: name } }))
      await writeFile(join(dir, 'bin', name), script)
    }
    await tool('tidy', `require('node:fs').writeFileSync('asked.txt', process.argv.slice(2).join(' ')); console.log(JSON.stringify({ ok: true, removed: ['.tidy'], kept: [{ path: '.tidy-notes', reason: 'yours' }] }))`)
    await tool('busy', `console.log(JSON.stringify({ ok: false, reason: 'running' })); console.error('a run is still working here'); process.exit(1)`)
    await tool('odd', `console.log(JSON.stringify({ ok: true, removed: 'everything' }))`)
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { tidy: '1.0.0', busy: '1.0.0', odd: '1.0.0' } }))

    assert.deepEqual(await runCleanups(root), {
      removed: ['.tidy'],
      kept: [{ path: '.tidy-notes', reason: 'yours' }],
      failed: ['busy: a run is still working here', 'odd: its clean-up answered something else than what it removed and kept'],
    })
    assert.equal(execFileSync('cat', ['asked.txt'], { cwd: root, encoding: 'utf8' }), 'cleanup', 'run in the project, with the one word')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
