import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildActivity, activityKey } from './activity.js'
import type { ProjectSummary } from './projects.js'
import type { AgentMeta } from '../store/index.js'

const project = (id: string, path: string): ProjectSummary => ({ id, path, name: id, activated: true, gitHost: false })

const agent = (over: Partial<AgentMeta> = {}): AgentMeta => ({
  status: 'running',
  id: 'r1',
  startedAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T00:00:00Z',
  ...over,
})

test('buildActivity maps a running run to started and a terminal run to finished', async () => {
  const agentsByPath: Record<string, AgentMeta[]> = {
    '/a': [agent({ id: 'r1', status: 'running', intent: 'add cart', updatedAt: '2026-07-16T03:00:00Z' })],
    '/b': [agent({ id: 'r2', status: 'done', intent: 'fix login', updatedAt: '2026-07-16T01:00:00Z' })],
  }
  const readAgents = async ({ path }: ProjectSummary): Promise<AgentMeta[]> => agentsByPath[path] ?? []
  const { items } = await buildActivity([project('a', '/a'), project('b', '/b')], { readAgents })

  // Newest first.
  assert.deepEqual(
    items.map(i => ({ project: i.projectId, kind: i.kind, title: i.title, status: i.status })),
    [
      { project: 'a', kind: 'started', title: 'add cart', status: undefined },
      { project: 'b', kind: 'finished', title: 'fix login', status: 'done' },
    ],
  )
})

test('buildActivity carries the terminal status so a stop reads differently from a done', async () => {
  const readAgents = async (): Promise<AgentMeta[]> => [agent({ status: 'stopped', updatedAt: '2026-07-16T02:00:00Z' })]
  const { items } = await buildActivity([project('a', '/a')], { readAgents })
  assert.deepEqual({ kind: items[0]!.kind, status: items[0]!.status }, { kind: 'finished', status: 'stopped' })
})

test('buildActivity emits one item per run across a project history', async () => {
  const readAgents = async (): Promise<AgentMeta[]> => [
    agent({ id: 'live', status: 'running', updatedAt: '2026-07-16T05:00:00Z' }),
    agent({ id: 'old', status: 'done', updatedAt: '2026-07-15T00:00:00Z' }),
  ]
  const { items } = await buildActivity([project('a', '/a')], { readAgents })
  assert.deepEqual(items.map(i => [i.agentId, i.kind]), [['live', 'started'], ['old', 'finished']])
})

test('buildActivity caps each project to the most recent runs', async () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    agent({ id: `r${i}`, status: 'done', updatedAt: `2026-07-16T00:${String(i).padStart(2, '0')}:00Z` }),
  )
  const readAgents = async (): Promise<AgentMeta[]> => many
  const { items } = await buildActivity([project('a', '/a')], { readAgents })
  assert.equal(items.length, 20)
})

test('buildActivity skips a project whose run read throws, and does not call it read (#1623)', async () => {
  const readAgents = async ({ path }: ProjectSummary): Promise<AgentMeta[]> => {
    if (path === '/boom') throw new Error('disk exploded')
    return [agent({ id: 'ok', status: 'done' })]
  }
  const { items, whole } = await buildActivity([project('boom', '/boom'), project('ok', '/ok')], { readAgents })
  assert.deepEqual(items.map(i => i.projectId), ['ok'])
  assert.deepEqual(whole, ['ok'])
})

test('buildActivity calls a project read when it has no runs at all (#1623)', async () => {
  const readAgents = async (): Promise<AgentMeta[]> => []
  const { items, whole } = await buildActivity([project('fresh', '/fresh')], { readAgents })
  assert.deepEqual(items, [])
  assert.deepEqual(whole, ['fresh'])
})

test('activityKey separates a run start from its finish', () => {
  const base = { projectId: 'a', projectName: 'a', agentId: 'r1' } as const
  assert.equal(activityKey({ ...base, kind: 'started' }), 'started:a:r1')
  assert.equal(activityKey({ ...base, kind: 'finished' }), 'finished:a:r1')
})

