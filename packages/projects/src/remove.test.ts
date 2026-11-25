import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OPENAGENT_DIR, PROJECTS, type ProjectRemoval, type ProjectRef, type ProjectsLifecycle } from '@openagt/hooks'
import { memorySettings } from '@openagt/hooks/testing'
import { addFolder } from './add.js'
import { removeListed } from './remove.js'

// A project taken off the list, with what the app says of it: whether it may go, and what each
// module cleaned up. The modules are stand-ins; the folder is a real one.

for (const [key, value] of Object.entries({ GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' })) process.env[key] = value

/** The app's side of a removal: what it was asked, a refusal while `busy` says one, and what the modules answer. */
function app(answer: Awaited<ReturnType<ProjectsLifecycle['removed']>> = { removed: [], kept: [], failed: [] }) {
  const asked: string[] = []
  const state = { busy: undefined as string | undefined }
  const lifecycle: ProjectsLifecycle = {
    added: async () => {},
    refusal: async project => (asked.push(`refusal ${project.id}`), state.busy),
    removed: async (project: ProjectRef, removal: ProjectRemoval) => (asked.push(`removed ${project.id} ${project.dir}${removal.files ? ' with files' : ''}`), answer),
  }
  return { asked, state, lifecycle }
}

async function listed(settings = memorySettings()) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'projects-remove-')))
  assert.equal((await addFolder({ settings, lifecycle: { added: async () => {} } }, dir, false)).ok, true)
  const [record] = await settings.get(PROJECTS)
  return { dir, settings, id: record!.id }
}

test('removing a project takes it off the list, tells every module, and deletes nothing in its folder; an id not on the list is refused', async () => {
  const { dir, settings, id } = await listed()
  const { asked, lifecycle } = app()
  try {
    await writeFile(join(dir, 'mine.txt'), 'mine\n')
    await writeFile(join(dir, OPENAGENT_DIR, 'kept.txt'), 'kept\n')
    const commits = execFileSync('git', ['log', '--format=%H'], { cwd: dir, encoding: 'utf8' })

    assert.deepEqual(await removeListed({ settings, lifecycle }, 'nope-123', false), { ok: false, error: 'no project with that id is on the list' })
    assert.equal((await settings.get(PROJECTS)).length, 1)

    assert.deepEqual(await removeListed({ settings, lifecycle }, id, false), { ok: true })
    assert.deepEqual(await settings.get(PROJECTS), [])
    assert.deepEqual(asked, [`refusal ${id}`, `removed ${id} ${dir}`], 'asked first, then each module stops what it started there')
    // Nothing of the folder is deleted: the person's file, OpenAgent's directory, the commits.
    assert.equal(await readFile(join(dir, 'mine.txt'), 'utf8'), 'mine\n')
    assert.equal(await readFile(join(dir, OPENAGENT_DIR, 'kept.txt'), 'utf8'), 'kept\n')
    assert.equal(execFileSync('git', ['log', '--format=%H'], { cwd: dir, encoding: 'utf8' }), commits)

    assert.deepEqual(await removeListed({ settings, lifecycle }, id, false), { ok: false, error: 'no project with that id is on the list' }, 'removed twice: the second time there is none')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a project the app says may not go stays on the list, and no module is told; one whose folder is gone goes, no files asked of the modules', async () => {
  const { dir, settings, id } = await listed()
  const { asked, state, lifecycle } = app()
  try {
    state.busy = 'An agent is working in this project. Stop it, then remove the project.'
    assert.deepEqual(await removeListed({ settings, lifecycle }, id, true), { ok: false, error: state.busy })
    assert.equal((await settings.get(PROJECTS)).length, 1, 'still on the list')
    assert.deepEqual(asked, [`refusal ${id}`])

    await rm(dir, { recursive: true, force: true })
    assert.deepEqual(await removeListed({ settings, lifecycle }, id, true), { ok: true }, 'with nothing there, there is nothing to report')
    assert.deepEqual(await settings.get(PROJECTS), [])
    assert.deepEqual(asked, [`refusal ${id}`, `removed ${id} ${dir}`], 'a folder that is gone is asked nothing, and no module is asked for its files')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("with its files: the modules' report, then the dashboard's own directory; a module that failed keeps the records and the directory for it", async () => {
  const removed = await listed()
  const failing = await listed()
  try {
    const cleaned = app({ removed: ['.branches'], kept: [{ path: '.agent-runner/config.yml', reason: 'your settings for agent-runner' }], failed: [] })
    const outcome = await removeListed({ settings: removed.settings, lifecycle: cleaned.lifecycle }, removed.id, true)
    assert.deepEqual(cleaned.asked.at(-1), `removed ${removed.id} ${removed.dir} with files`)
    assert.ok(outcome.ok)
    assert.deepEqual(outcome.cleanup?.removed.slice(0, 1), ['.branches'], "the modules' own first")
    assert.ok(outcome.cleanup?.removed.includes(OPENAGENT_DIR), "the dashboard's own directory went")
    assert.deepEqual(outcome.cleanup?.kept, [{ path: '.agent-runner/config.yml', reason: 'your settings for agent-runner' }])

    const failed = app({ removed: [], kept: [], failed: ['agent-driver: a run is still working here (booting): stop it first'] })
    const kept = await removeListed({ settings: failing.settings, lifecycle: failed.lifecycle }, failing.id, true)
    assert.ok(kept.ok)
    assert.deepEqual(kept.cleanup?.failed, ['agent-driver: a run is still working here (booting): stop it first'])
    assert.deepEqual(kept.cleanup?.kept.find(entry => entry.path === OPENAGENT_DIR), { path: OPENAGENT_DIR, reason: 'a clean-up before it did not finish' })
    assert.equal(await readFile(join(failing.dir, OPENAGENT_DIR, '.gitignore'), 'utf8').then(() => true, () => false), true, "the dashboard's directory stays")
  } finally {
    await rm(removed.dir, { recursive: true, force: true })
    await rm(failing.dir, { recursive: true, force: true })
  }
})
