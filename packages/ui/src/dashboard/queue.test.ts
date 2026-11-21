import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { collectQueue } from './queue.js'
import type { ProjectSummary } from './projects.js'
import type { QueueFor } from '../store/queue.js'

const project = (id: string, path: string): ProjectSummary => ({ id, path, name: id, activated: true, gitHost: false })

/** A queue reader off disk: a project's entries by path; a path with no list has no provider. */
const queueFor =
  (queues: Record<string, string[] | (() => Promise<string[]>)>): QueueFor =>
  async path => {
    const entries = queues[path]
    if (!entries) return undefined
    return { list: () => (typeof entries === 'function' ? entries() : Promise.resolve(entries)) }
  }

test('collectQueue lists every project with a queue provider, empty or not, most entries first, and leaves out the rest', async () => {
  const queues = await collectQueue(
    [project('a', '/a'), project('b', '/b'), project('c', '/c'), project('d', '/d')],
    queueFor({ '/a': ['one'], '/b': ['[b one](tickets/b1.md) — a note', 'two'], '/d': [] }),
  )
  assert.deepEqual(queues, [
    { projectId: 'b', projectName: 'b', entries: ['[b one](tickets/b1.md) — a note', 'two'] },
    { projectId: 'a', projectName: 'a', entries: ['one'] },
    { projectId: 'd', projectName: 'd', entries: [] },
  ])
})

test('collectQueue survives a provider lookup or a read that throws: that project has no entries', async () => {
  const boom: QueueFor = async path => {
    if (path === '/lookup') throw new Error('unreadable')
    return { list: () => (path === '/read' ? Promise.reject(new Error('boom')) : Promise.resolve(['fine'])) }
  }
  const queues = await collectQueue([project('lookup', '/lookup'), project('read', '/read'), project('ok', '/ok')], boom)
  assert.deepEqual(
    queues.map(q => [q.projectId, q.entries]),
    [
      ['ok', ['fine']],
      ['read', []],
    ],
  )
})
