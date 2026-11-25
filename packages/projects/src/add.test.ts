import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectId } from './project-id.js'
import { readSharing, SHARE_SETTING, writeSharing } from '@openagt/store-filesystem'
import { PROJECTS, type ProjectRef } from '@openagt/hooks'
import { memorySettings } from '@openagt/hooks/testing'
import { addFolder, givenFolder } from './add.js'
import { addRepoFolder, listProject, MAX_REPO_FOLDERS, REPO_FOLDERS, removeRepoFolder, unlistProject } from './list.js'

// The list of projects, and a folder added to it: by Add project, and from the folder `openagent`
// was typed in. On real folders; the list in memory.

/** A new folder's first commit needs an author, and git reads the process's environment. */
for (const [key, value] of Object.entries({ GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' })) process.env[key] = value

async function folder(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)))
}

/** What the modules are told of the projects added, as `<id> <dir>`. */
function told(): { said: string[]; lifecycle: { added: (project: ProjectRef) => Promise<void> } } {
  const said: string[] = []
  return { said, lifecycle: { added: async project => void said.push(`${project.id} ${project.dir}`) } }
}

test('a folder is put on the list once, by its path; taken off by its id, and an id not there changes nothing', async () => {
  const settings = memorySettings()
  const first = await listProject(settings, '/repos/a/', '2026-11-01T00:00:00.000Z')
  assert.deepEqual(first, { record: { id: projectId('/repos/a'), path: '/repos/a', addedAt: '2026-11-01T00:00:00.000Z' }, added: true })
  assert.deepEqual(await listProject(settings, '/repos/a', '2026-11-02T00:00:00.000Z'), { record: first.record, added: false }, 'listed already: the record as it is')
  await Promise.all([listProject(settings, '/repos/b', 'b'), listProject(settings, '/repos/c', 'c')])
  assert.deepEqual((await settings.get(PROJECTS)).map(project => project.path), ['/repos/a', '/repos/b', '/repos/c'], 'two adds at once keep both')
  assert.equal(await unlistProject(settings, 'nope-1'), undefined)
  assert.deepEqual(await unlistProject(settings, first.record.id), first.record)
  assert.deepEqual((await settings.get(PROJECTS)).map(project => project.path), ['/repos/b', '/repos/c'])
})

test('the folders searched for repos: each once, by its absolute path, up to the cap; one taken off goes', async () => {
  const settings = memorySettings()
  await addRepoFolder(settings, '/work/clients/')
  await addRepoFolder(settings, '/work/clients')
  assert.deepEqual(await settings.get(REPO_FOLDERS), ['/work/clients'])
  await removeRepoFolder(settings, '/work/other')
  await removeRepoFolder(settings, '/work/clients')
  assert.deepEqual(await settings.get(REPO_FOLDERS), [])
  for (let i = 0; i < MAX_REPO_FOLDERS + 2; i++) await addRepoFolder(settings, `/f/${i}`)
  assert.equal((await settings.get(REPO_FOLDERS)).length, MAX_REPO_FOLDERS)
})

test('adding a folder makes it a project, an empty folder included, and tells the modules once, as it is put on the list', async () => {
  const dir = await folder('projects-add-')
  const settings = memorySettings()
  const { said, lifecycle } = told()
  try {
    assert.deepEqual(await addFolder({ settings, lifecycle }, dir, false), { ok: true, alreadyActivated: false })
    // The person's answer on the agents' records is written with the add: kept on this machine.
    assert.equal(await readSharing(dir), false)
    assert.deepEqual(said, [`${projectId(dir)} ${dir}`], 'the modules on in it start their work there')

    // A yes is to the remote that is there: this folder has none, so the records stay kept.
    assert.deepEqual(await addFolder({ settings, lifecycle }, dir, true), { ok: true, alreadyActivated: true, noRemote: true })
    assert.equal(await readSharing(dir), false)
    // With a remote, the same answer shares them from now on.
    execFileSync('git', ['remote', 'add', 'origin', join(dir, 'origin.git')], { cwd: dir })
    assert.deepEqual(await addFolder({ settings, lifecycle }, dir, true), { ok: true, alreadyActivated: true })
    assert.equal(await readSharing(dir), true)
    assert.equal(said.length, 1, 'added again, it was on the list already: the modules are not told twice')
    assert.deepEqual((await settings.get(PROJECTS)).map(project => project.path), [dir])

    const gone = join(dir, 'nope')
    assert.deepEqual(await addFolder({ settings, lifecycle }, gone), { ok: false, error: `path does not exist or is not a directory: ${gone}` })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("the folder openagent was typed in: the repository it is in is added, once, by its top folder, its answer on the records as it is; inside a listed project it is that one; outside a repository, none", async () => {
  const dir = await folder('projects-given-')
  const other = await folder('projects-given-other-')
  const outside = await folder('projects-given-outside-')
  const settings = memorySettings()
  try {
    // A clone whose person said yes before: its folder moved, so it is not on the list any more.
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', join(dir, 'origin.git')], { cwd: dir })
    await writeSharing(dir, true)
    await mkdir(join(dir, 'src'))
    const given = await givenFolder(settings, join(dir, 'src'))
    assert.equal(given?.added, true)
    assert.equal(given?.project.dir, dir)
    assert.equal(given?.project.id, projectId(dir))
    assert.equal(await readSharing(dir), true, 'the yes stays: starting there is no answer')
    assert.deepEqual(await givenFolder(settings, join(dir, 'src')), { project: given!.project, added: false })

    // A repository never asked stays unasked: it reads as kept, and nothing is written for it.
    execFileSync('git', ['init', '-q'], { cwd: other })
    assert.equal((await givenFolder(settings, other))?.added, true)
    assert.throws(() => execFileSync('git', ['config', '--local', '--get', SHARE_SETTING], { cwd: other, stdio: 'pipe' }))

    assert.equal(await givenFolder(settings, outside), undefined)
    assert.deepEqual((await settings.get(PROJECTS)).map(project => project.path), [dir, other])
  } finally {
    for (const one of [dir, other, outside]) await rm(one, { recursive: true, force: true })
  }
})
