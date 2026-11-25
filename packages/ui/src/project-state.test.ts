import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createHooks, defineModule, type AppAttention } from '@openagt/hooks'
import { memoryStore } from '@openagt/hooks/testing'
import { projectStateReader, readProjectState } from './project-state.js'
import { clearCache } from './dashboard/cache.js'

/** A distribution of one module that says `said` when asked about a project. */
function saying(said: AppAttention) {
  const hooks = createHooks([{ module: defineModule({ name: 'store-git-branch', hooks: { 'store.backend': memoryStore(), 'app.attention': said } }) }], { onError: () => {} })
  return async () => hooks
}

test("a project's errors are what the modules on in it say needs setting up, its notes what they note of it, in their words; what waits on the person is neither", async () => {
  const asked: string[] = []
  const state = await readProjectState(
    { id: 'shop-1', path: '/work/shop' },
    {
      hooks: saying(({ project }) => {
        asked.push(`${project?.id} at ${project?.dir}`)
        return [
          { kind: 'setup', scope: 'project', id: 'data-sync', words: 'Not syncing with the remote', detail: 'origin refused the push', since: '2026-11-20T10:00:00.000Z' },
          { kind: 'setup', scope: 'computer', words: 'No account to push as' },
          { kind: 'waiting', scope: 'run', run: 'r1', words: 'Needs answer' },
          { kind: 'note', scope: 'project', id: 'data-here', words: 'Records kept on this machine' },
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
    notes: [{ id: 'store-git-branch:data-here', words: 'Records kept on this machine' }],
  })
  // A module that cannot answer says nothing, and the project's page still opens.
  const broken = await readProjectState({ id: 'shop-1', path: '/work/shop' }, { hooks: async () => Promise.reject(new Error('no distribution')) })
  assert.deepEqual(broken, { errors: [], notes: [] })
})

test("the daemon's reader answers from what it read last, and reads again in the background once that is half a minute old", async () => {
  clearCache()
  let reads = 0
  let words = 'Not syncing with the remote'
  const reader = projectStateReader({ hooks: saying(() => (reads++, [{ kind: 'setup', scope: 'project', words }])) })
  const project = { id: 'p', path: '/work/cached' }
  assert.equal((await reader(project)).errors[0]?.title, 'Not syncing with the remote')
  words = 'Something else'
  assert.equal((await reader(project)).errors[0]?.title, 'Not syncing with the remote', 'within half a minute, the last read answers')
  assert.equal(reads, 1)
  clearCache()
})
