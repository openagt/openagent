import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { summarizeProject, defaultProjectsProvider, type SummarizeDeps } from './projects.js'
import type { ProjectRecord } from '../registry.js'
import { type AgentMeta } from '../store/index.js'

const RECORD: ProjectRecord = { id: 'app-a-1', path: '/repos/app-a', addedAt: '2026-07-11T00:00:00.000Z' }

function deps(over: SummarizeDeps): SummarizeDeps {
  return {
    isActivated: async () => true,
    readAgents: async () => [],
    gitHost: async () => undefined,
    ...over,
  }
}

const agent = (id: string, updatedAt: string): AgentMeta => ({
  status: 'stopped',
  id,
  startedAt: updatedAt,
  updatedAt,
})

test("summarizeProject names the project as its repository is named, and one with no repository by its folder", async () => {
  assert.equal((await summarizeProject(RECORD, deps({ name: async () => 'shop' }))).name, 'shop')
  assert.equal((await summarizeProject(RECORD, deps({ name: async () => Promise.reject(new Error('no git')) }))).name, 'app-a')
  const summary = await summarizeProject(RECORD, deps({}))
  assert.equal(summary.name, 'app-a')
  assert.equal(summary.id, 'app-a-1')
  assert.equal(summary.path, '/repos/app-a')
})

test('gitHost says whether a package provides the project a git host; a lookup that fails reads as none', async () => {
  assert.equal((await summarizeProject(RECORD, deps({}))).gitHost, false)
  const source = {} as NonNullable<Awaited<ReturnType<NonNullable<SummarizeDeps['gitHost']>>>>
  assert.equal((await summarizeProject(RECORD, deps({ gitHost: async () => source }))).gitHost, true)
  const failing = deps({
    gitHost: async () => {
      throw new Error('package.json unreadable')
    },
  })
  assert.equal((await summarizeProject(RECORD, failing)).gitHost, false)
})

test('lastActivityAt is the newest run (#645)', async () => {
  // The sessions are the history (B3). It used to be the newest of these and the latest LOGS.md
  // entry — a committed markdown re-narration of the same sessions, always the older of the two.
  const summary = await summarizeProject(
    RECORD,
    deps({ readAgents: async () => [agent('b', '2026-07-12T00:00:00.000Z'), agent('a', '2026-07-10T00:00:00.000Z')] }),
  )
  assert.equal(summary.lastActivityAt, '2026-07-12T00:00:00.000Z')
})

test('no runs means no lastActivityAt key at all', async () => {
  const summary = await summarizeProject(RECORD, deps({ readAgents: async () => [] }))
  assert.equal('lastActivityAt' in summary, false)
})

test('activation reflects the injected check', async () => {
  const summary = await summarizeProject(RECORD, deps({ isActivated: async () => false }))
  assert.equal(summary.activated, false)
})

test('a throwing reader is forgiving: inactive, no activity, never throws', async () => {
  const summary = await summarizeProject(
    RECORD,
    deps({
      isActivated: async () => {
        throw new Error('stat failed')
      },
      readAgents: async () => {
        throw new Error('read failed')
      },
    }),
  )
  assert.equal(summary.activated, false)
  assert.equal('lastActivityAt' in summary, false)
})

const RECORD_B: ProjectRecord = { id: 'app-b-2', path: '/repos/app-b', addedAt: '2026-07-11T00:00:00.000Z' }

/** A provider over two registered projects, of which only `present` are still on disk. */
function provider(present: string[]) {
  return defaultProjectsProvider({
    listRecords: async () => [RECORD, RECORD_B],
    isDirectory: async path => present.includes(path),
    summarize: async record => ({ id: record.id, path: record.path, name: record.path.split('/').pop()!, activated: true, gitHost: false }),
  })
}

test('a project whose directory is gone is not listed (#1140)', async () => {
  // Renamed or deleted on disk: it used to stay in the sidebar as a grey, file-less entry (#1142)
  // that nothing could remove. Now it is simply absent until the directory is back.
  const listed = await provider(['/repos/app-a']).list()
  assert.deepEqual(
    listed.map(p => p.id),
    ['app-a-1'],
  )
})

test('a project whose directory is gone does not resolve a path either (#1140)', async () => {
  assert.equal(await provider(['/repos/app-a']).resolvePath('app-b-2'), undefined)
  assert.equal(await provider(['/repos/app-a']).resolvePath('app-a-1'), '/repos/app-a')
})

test('a directory that comes back is a project again (#1140)', async () => {
  // The registry is skipped, not pruned: the record survives the absence.
  assert.deepEqual((await provider([]).list()).map(p => p.id), [])
  assert.deepEqual((await provider(['/repos/app-a', '/repos/app-b']).list()).map(p => p.id), ['app-a-1', 'app-b-2'])
})

test('a failing directory check reads as gone, never throws (#1140)', async () => {
  const listed = await defaultProjectsProvider({
    listRecords: async () => [RECORD],
    isDirectory: async () => {
      throw new Error('EACCES')
    },
    summarize: async record => ({ id: record.id, path: record.path, name: 'x', activated: true, gitHost: false }),
  }).list()
  assert.deepEqual(listed, [])
})
