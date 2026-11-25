import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeSharing } from '@openagt/agent-data'
import { createHooks, defineModule, type AppAttention } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import { projectStateReader, readProjectState } from './project-state.js'
import { clearCache } from './dashboard/cache.js'

const git = promisify(execFile)

/** A distribution of one module that says `said` when asked about a project. */
function saying(said: AppAttention) {
  const hooks = createHooks([{ module: defineModule({ name: 'store-git-branch', hooks: { 'store.backend': memoryStore(), 'app.attention': said } }) }], { onError: () => {} })
  return async () => hooks
}

const nothingElse = { reach: async () => 'origin' as const }

test("a project's errors are what the modules on in it say needs setting up, in their words; what waits on the person is not one", async () => {
  const asked: string[] = []
  const state = await readProjectState(
    { id: 'shop-1', path: '/work/shop' },
    {
      ...nothingElse,
      hooks: saying(({ project }) => {
        asked.push(`${project?.id} at ${project?.dir}`)
        return [
          { kind: 'setup', scope: 'project', id: 'data-sync', words: 'Not syncing with the remote', detail: 'origin refused the push', since: '2026-11-20T10:00:00.000Z' },
          { kind: 'setup', scope: 'computer', words: 'No account to push as' },
          { kind: 'waiting', scope: 'run', run: 'r1', words: 'Needs answer' },
        ]
      }),
    },
  )
  assert.deepEqual(asked, ['shop-1 at /work/shop'])
  assert.deepEqual(state, {
    errors: [
      { id: 'store-git-branch:data-sync', title: 'Not syncing with the remote', message: 'origin refused the push', since: '2026-11-20T10:00:00.000Z' },
      { id: 'store-git-branch:No account to push as', title: 'No account to push as' },
    ],
  })
  // A module that cannot answer says nothing, and the project's page still opens.
  const broken = await readProjectState({ id: 'shop-1', path: '/work/shop' }, { ...nothingElse, hooks: async () => Promise.reject(new Error('no distribution')) })
  assert.deepEqual(broken, { errors: [] })
})

test("why a project's data stays here: its repository has no remote, or the person keeps it here; none once it is shared", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'openagent-reach-')))
  const project = join(base, 'project')
  try {
    await git('git', ['init', '-q', '-b', 'main', project])
    const read = async () => (await readProjectState({ id: 'p', path: project }, { hooks: saying(() => []) })).local
    assert.equal(await read(), 'no-remote')
    await git('git', ['remote', 'add', 'origin', join(base, 'remote.git')], { cwd: project })
    assert.equal(await read(), 'kept')
    await writeSharing(project, true)
    assert.equal(await read(), undefined)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test("the daemon's reader answers from what it read last, and reads again in the background once that is half a minute old", async () => {
  clearCache()
  let reads = 0
  let words = 'Not syncing with the remote'
  const reader = projectStateReader({ ...nothingElse, hooks: saying(() => (reads++, [{ kind: 'setup', scope: 'project', words }])) })
  const project = { id: 'p', path: '/work/cached' }
  assert.equal((await reader(project)).errors[0]?.title, 'Not syncing with the remote')
  words = 'Something else'
  assert.equal((await reader(project)).errors[0]?.title, 'Not syncing with the remote', 'within half a minute, the last read answers')
  assert.equal(reads, 1)
  clearCache()
})
