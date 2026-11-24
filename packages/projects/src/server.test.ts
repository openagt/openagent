import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECTS, type ProjectRef } from '@openagt/hooks'
import { computerRpcHost } from '@openagt/hooks/testing'
import { addFromAddress, addProject, cloneTargetFor, removeFolderToSearch, removeProject, repoFolders } from './server.js'
import { REPO_FOLDERS } from './list.js'

// The functions the module's UI calls, with this computer's host faked: its settings in memory,
// and the app's lifecycle a stand-in that writes down what it was told.

for (const [key, value] of Object.entries({ GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' })) process.env[key] = value

test('Add project adds the path, trimmed, tells the app, and refuses no path; Remove project takes it off by its id, refusing none', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'projects-server-')))
  const told: string[] = []
  const host = computerRpcHost({
    lifecycle: {
      added: async (project: ProjectRef) => void told.push(`added ${project.dir}`),
      refusal: async () => undefined,
      removed: async project => (told.push(`removed ${project.dir}`), { removed: [], kept: [], failed: [] }),
    },
  })
  try {
    assert.deepEqual(await addProject(host, { path: '  ' }), { ok: false, error: 'a project path is required' })
    assert.deepEqual(await addProject(host, { path: ` ${dir} ` }), { ok: true, alreadyActivated: false })
    const [record] = await host.settings.get(PROJECTS)
    assert.equal(record?.path, dir)
    assert.deepEqual(await removeProject(host, { projectId: '' }), { ok: false, error: 'a project id is required' })
    // Only a plain `true` deletes anything.
    assert.deepEqual(await removeProject(host, { projectId: record!.id, files: 'yes' as unknown as boolean }), { ok: true })
    assert.deepEqual(told, [`added ${dir}`, `removed ${dir}`])
    assert.deepEqual(await host.settings.get(PROJECTS), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('what is no repository address is said so before anything is cloned', async () => {
  const host = computerRpcHost({ gitAccess: async () => assert.fail('no account is asked for what is no address') })
  const refused = await cloneTargetFor(host, { address: 'not an address' })
  assert.equal(refused.ok, false)
  assert.deepEqual(await addFromAddress(host, { address: 'not an address' }), refused)
})

test('Settings › Repos reads the folders searched; a removal that names no folder is refused before the list is read', async () => {
  const host = computerRpcHost()
  await host.settings.set(REPO_FOLDERS, ['/work/clients', '/work/oss'])
  assert.deepEqual(await repoFolders(host, {}), { folders: ['/work/clients', '/work/oss'] })
  assert.deepEqual(await removeFolderToSearch(host, { folder: 7 as unknown as string }), { ok: false, error: 'no folder named' })
})
