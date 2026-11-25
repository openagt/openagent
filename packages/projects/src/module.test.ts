import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHooks, PROJECTS, RunOrder, type RunContext } from '@openagt/hooks'
import { fakeApp, memorySettings, memoryStore } from '@openagt/hooks/testing'
import { copiesLine, projectsModule } from './module.js'
import { gitignorePath, openagentGitignore } from './openagent-gitignore.js'

// The module's own steps of a run, its "No project yet", and the folder `openagent` was typed in
// as the app hands it over.

const module = projectsModule()
const step = (order: number) => module.hooks['run.step']!.find(one => one.order === order)!.run

/** A run's context as far as these steps read it. */
function run(over: Partial<RunContext>): RunContext {
  return { settings: memorySettings(), facts: {}, context: [], ...over } as unknown as RunContext
}

test("a run's project must hold its repository: one listed and not cloned yet says so, and a folder with none says it holds none", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'projects-clone-')))
  const settings = memorySettings()
  const cloned = step(RunOrder.CLONE)
  try {
    const project = { id: 'shop-1', name: 'shop', dir }
    await assert.rejects(async () => cloned(run({ project, settings })), { message: `${dir} holds no repository.` })
    await settings.set(PROJECTS, [{ id: 'shop-1', path: dir, addedAt: '2026-11-01T00:00:00.000Z' }])
    await assert.rejects(async () => cloned(run({ project, settings })), { message: `shop is not cloned on this computer yet: start the run once its clone has landed in ${dir}.` })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    await cloned(run({ project, settings }))
    await cloned(run({}))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("the agent is told where the copies of its repos made for this start are, in a project; with none made, or no project, nothing", async () => {
  const told = step(RunOrder.CONTEXT)
  const project = { id: 'app-1', name: 'app', dir: '/repos/app' }
  const made = [{ name: 'lib', from: '/repos/lib' }]
  const facts = (copied: typeof made) => ({ 'git-branches': { copies: { folder: '/sessions/s1', branch: 'agent-s1', made: copied } } }) as unknown as RunContext['facts']
  const ctx = run({ project, facts: facts(made) })
  await told(ctx)
  assert.deepEqual(ctx.context, ['Context: this session has its own copy of a repo, on the branch agent-s1: /sessions/s1/lib (copied from /repos/lib). Read and change it there, not in the folder copied from.'])
  for (const none of [run({ project, facts: facts([]) }), run({ facts: facts(made) }), run({ project })]) {
    await told(none)
    assert.deepEqual(none.context, [])
  }
  assert.match(copiesLine('/s', 'agent-x', [...made, { name: 'web', from: '/repos/web' }]), /copies of repos, on the branch agent-x: \/s\/lib \(copied from \/repos\/lib\), \/s\/web \(copied from \/repos\/web\)\. Read and change them there, not in the folders copied from\.$/)
})

test('"Add your first project" is asked about this computer while the list is empty, and not on a project\'s page', async () => {
  const app = fakeApp({ settings: memorySettings() })
  const attention = projectsModule().hooks['app.attention']!
  const [item, ...more] = await attention({}, app)
  assert.deepEqual(more, [])
  assert.equal(item?.id, 'no-project')
  assert.equal(item?.scope, 'computer')
  assert.deepEqual(item?.fix, { label: 'Add a project', action: 'add-project' })
  await app.settings.set(PROJECTS, [{ id: 'app-1', path: '/repos/app', addedAt: '2026-11-01T00:00:00.000Z' }])
  assert.deepEqual(await attention({}, app), [])
  await app.settings.set(PROJECTS, [])
  assert.ok(!(await attention({ project: { id: 'app-1', name: 'app', dir: '/repos/app' } }, app)).some(item => item.id === 'no-project'))
})

test("a listed project whose folder lacks the ignore file adding it writes is not activated, on its page; one that has it says nothing", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'projects-activated-')))
  try {
    const app = fakeApp({ settings: memorySettings() })
    const attention = projectsModule().hooks['app.attention']!
    const project = { id: 'app-1', name: 'app', dir }
    assert.deepEqual(await attention({ project }, app), [{ kind: 'setup', scope: 'project', id: 'not-activated', words: 'Not activated' }])
    await mkdir(join(dir, '.openagent'), { recursive: true })
    assert.equal((await attention({ project }, app)).length, 1, 'the directory alone is not the mark')
    await writeFile(gitignorePath(dir), openagentGitignore())
    assert.deepEqual(await attention({ project }, app), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the folder openagent was typed in is the module\'s to make a project, and the app tells the other modules of one it added', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'projects-typed-in-')))
  const added: string[] = []
  const hooks = createHooks([{ module: { name: 'test-store', hooks: { 'store.backend': memoryStore() } } }, { module: projectsModule() }, { module: { name: 'told', hooks: { 'app.lifecycle': { projectAdded: project => void added.push(project.dir) } } } }], { projects: async () => [] })
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first'], { cwd: dir })
    const given = await hooks.folderGiven(dir)
    assert.equal(given?.added, true)
    assert.deepEqual(added, [dir])
    assert.equal((await hooks.folderGiven(dir))?.added, false)
    assert.deepEqual(added, [dir], 'told once')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
